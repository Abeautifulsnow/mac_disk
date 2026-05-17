use crate::commands::{FileInfo, ScanEvent};
use rayon::prelude::*;
use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, UNIX_EPOCH};
use walkdir::WalkDir;

/// 性能指标收集结构
#[derive(Debug, Default)]
struct PerformanceMetrics {
    start_time: Option<Instant>,
    end_time: Option<Instant>,
    total_entries: usize,
    files_processed: usize,
    dirs_processed: usize,
    skipped_entries: usize,
    metadata_read_time: u128, // 纳秒
    dir_calc_time: u128,      // 纳秒
    sorting_time: u128,       // 纳秒
}

impl PerformanceMetrics {
    fn new() -> Self {
        Self {
            start_time: Some(Instant::now()),
            ..Default::default()
        }
    }

    fn finish(&mut self) {
        self.end_time = Some(Instant::now());
    }

    fn log_summary(&self) {
        if let (Some(start), Some(end)) = (self.start_time, self.end_time) {
            let total_time = end.duration_since(start).as_millis();
            tracing::info!(
                "性能指标 - 总耗时: {}ms, 处理条目: {}, 文件: {}, 目录: {}, 跳过: {}, 元数据读取: {}ms, 目录计算: {}ms, 排序: {}ms",
                total_time,
                self.total_entries,
                self.files_processed,
                self.dirs_processed,
                self.skipped_entries,
                self.metadata_read_time / 1_000_000,
                self.dir_calc_time / 1_000_000,
                self.sorting_time / 1_000_000
            );
        }
    }
}

/// 扫描目录并返回占用空间最大的文件和目录
/// 这是一个简单的包装器，用于非Tauri环境或不需要进度的场景
pub fn scan_directory(
    root: &Path,
    limit: Option<usize>,
    min_size: Option<u64>,
    size_mode: Option<&str>,
) -> Result<Vec<FileInfo>, Box<dyn std::error::Error>> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let (files, dirs, _) = scan_directory_with_progress(
        root,
        limit,
        min_size,
        cancel_flag,
        "internal".to_string(),
        size_mode,
        |_| Ok(()),
    )?;

    let mut result = files;
    result.extend(dirs);
    // 这里不再重新排序，因为 scan_directory_with_progress 已经排好了
    // 但合并后可能需要再次截断，这里简单处理直接返回
    Ok(result)
}

/// 并行扫描目录（保留接口兼容性）
pub fn scan_directory_parallel(
    root: &Path,
    limit: Option<usize>,
    min_size: Option<u64>,
    size_mode: Option<&str>,
) -> Result<Vec<FileInfo>, Box<dyn std::error::Error>> {
    scan_directory(root, limit, min_size, size_mode)
}

/// 带进度跟踪和取消支持的目录扫描（高性能重构版）
pub fn scan_directory_with_progress<F>(
    root: &Path,
    limit: Option<usize>,
    min_size: Option<u64>,
    cancel_flag: Arc<AtomicBool>,
    scan_id: String,
    size_mode: Option<&str>,
    mut progress_callback: F,
) -> Result<(Vec<FileInfo>, Vec<FileInfo>, u64), Box<dyn std::error::Error>>
where
    F: FnMut(ScanEvent) -> Result<(), Box<dyn std::error::Error>>,
{
    let mut metrics = PerformanceMetrics::new();
    tracing::info!("[{}] 开始高性能扫描: {}", scan_id, root.display());

    progress_callback(ScanEvent::Progress {
        scan_id: scan_id.clone(),
        processed: 0,
        discovered: None,
        total_estimated: None,
        current_path: root.to_string_lossy().to_string(),
        phase: Some("walking".to_string()),
    })?;

    if cancel_flag.load(Ordering::SeqCst) {
        return Err("扫描被取消".into());
    }

    tracing::info!("[{}] 正在收集文件列表...", scan_id);
    let mut entries: Vec<walkdir::DirEntry> = Vec::new();
    let mut last_progress_emit = Instant::now();
    for (i, entry) in WalkDir::new(root)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .enumerate()
    {
        if cancel_flag.load(Ordering::SeqCst) {
            progress_callback(ScanEvent::Cancelled {
                scan_id: scan_id.clone(),
            })?;
            return Err("扫描被取消".into());
        }
        let Ok(entry) = entry else { continue };
        entries.push(entry);
        if i % 500 == 0 || last_progress_emit.elapsed().as_millis() >= 300 {
            last_progress_emit = Instant::now();
            let current_path = entries
                .last()
                .map(|e| e.path().to_string_lossy().to_string())
                .unwrap_or_else(|| root.to_string_lossy().to_string());
            let _ = progress_callback(ScanEvent::Progress {
                scan_id: scan_id.clone(),
                processed: 0,
                discovered: Some(entries.len()),
                total_estimated: None,
                current_path,
                phase: Some("walking".to_string()),
            });
        }
    }

    let total_entries = entries.len();
    metrics.total_entries = total_entries;

    progress_callback(ScanEvent::Progress {
        scan_id: scan_id.clone(),
        processed: 0,
        discovered: Some(total_entries),
        total_estimated: Some(total_entries),
        current_path: root.to_string_lossy().to_string(),
        phase: Some("processing".to_string()),
    })?;

    let mut dir_sizes: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    let mut large_files: Vec<FileInfo> = Vec::new();
    let mut total_logical_size: u64 = 0;
    let mut total_disk_usage: u64 = 0;
    let use_disk_mode = size_mode == Some("disk");

    let dir_calc_start = Instant::now();
    let mut processed = 0usize;
    const CHUNK_SIZE: usize = 10_000;

    for chunk in entries.chunks(CHUNK_SIZE) {
        if cancel_flag.load(Ordering::SeqCst) {
            progress_callback(ScanEvent::Cancelled {
                scan_id: scan_id.clone(),
            })?;
            return Err("扫描被取消".into());
        }

        #[derive(Default)]
        struct ChunkAcc {
            files: Vec<FileInfo>,
            dirs: HashMap<PathBuf, (u64, u64)>,
            total_logical_size: u64,
            total_disk_usage: u64,
            skipped: usize,
        }

        #[derive(Debug)]
        struct CancelledError;
        impl std::fmt::Display for CancelledError {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "扫描被取消")
            }
        }
        impl std::error::Error for CancelledError {}

        let chunk_result: Result<ChunkAcc, CancelledError> = chunk
            .par_iter()
            .try_fold(ChunkAcc::default, |mut acc, entry| {
                if cancel_flag.load(Ordering::Relaxed) {
                    return Err(CancelledError);
                }

                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => {
                        acc.skipped += 1;
                        return Ok(acc);
                    }
                };

                if !metadata.is_file() {
                    return Ok(acc);
                }

                let size = metadata.len();
                let disk_usage = {
                    let blocks = metadata.blocks();
                    if blocks == 0 {
                        size
                    } else {
                        blocks * 512
                    }
                };
                acc.total_logical_size = acc.total_logical_size.saturating_add(size);
                acc.total_disk_usage = acc.total_disk_usage.saturating_add(disk_usage);

                let mut current = entry.path().parent();
                while let Some(parent) = current {
                    if !parent.starts_with(root) {
                        break;
                    }
                    let key = parent.to_path_buf();
                    let v = acc.dirs.entry(key).or_insert((0, 0));
                    v.0 = v.0.saturating_add(size);
                    v.1 = v.1.saturating_add(disk_usage);
                    if parent == root {
                        break;
                    }
                    current = parent.parent();
                }

                let active_size = if use_disk_mode { disk_usage } else { size };
                if min_size.map_or(true, |min| active_size >= min) {
                    if let Ok(info) =
                        create_file_info_from_metadata(entry.path(), size, false, &metadata)
                    {
                        acc.files.push(info);
                    }
                }

                Ok(acc)
            })
            .try_reduce(ChunkAcc::default, |mut a, mut b| {
                a.files.append(&mut b.files);
                a.total_logical_size = a.total_logical_size.saturating_add(b.total_logical_size);
                a.total_disk_usage = a.total_disk_usage.saturating_add(b.total_disk_usage);
                a.skipped += b.skipped;
                for (k, v) in b.dirs {
                    let e = a.dirs.entry(k).or_insert((0, 0));
                    e.0 = e.0.saturating_add(v.0);
                    e.1 = e.1.saturating_add(v.1);
                }
                Ok(a)
            });

        match chunk_result {
            Ok(acc) => {
                large_files.extend(acc.files);
                total_logical_size = total_logical_size.saturating_add(acc.total_logical_size);
                total_disk_usage = total_disk_usage.saturating_add(acc.total_disk_usage);
                metrics.skipped_entries += acc.skipped;
                for (k, v) in acc.dirs {
                    let entry = dir_sizes.entry(k).or_insert((0, 0));
                    entry.0 = entry.0.saturating_add(v.0);
                    entry.1 = entry.1.saturating_add(v.1);
                }
            }
            Err(_) => {
                progress_callback(ScanEvent::Cancelled {
                    scan_id: scan_id.clone(),
                })?;
                return Err("扫描被取消".into());
            }
        }

        processed += chunk.len();
        let current_path = chunk
            .last()
            .map(|e| e.path().to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string());
        let _ = progress_callback(ScanEvent::Progress {
            scan_id: scan_id.clone(),
            processed,
            discovered: Some(total_entries),
            total_estimated: Some(total_entries),
            current_path,
            phase: Some("processing".to_string()),
        });
    }

    metrics.dir_calc_time = dir_calc_start.elapsed().as_nanos();
    metrics.files_processed = large_files.len();

    // 收集符合大小要求的目录。前端现在会构建可展开树形表格，
    // 因此不能再过滤掉已选父目录下面的子项。
    let mut all_dirs: Vec<(PathBuf, u64, u64)> = dir_sizes
        .iter()
        .filter(|(path, _sizes)| *path != root)
        .filter(|(_path, sizes)| {
            if let Some(min) = min_size {
                if use_disk_mode {
                    sizes.1 >= min
                } else {
                    sizes.0 >= min
                }
            } else {
                true
            }
        })
        .map(|(path, sizes)| (path.clone(), sizes.0, sizes.1))
        .collect::<Vec<_>>();

    let sort_start = Instant::now();
    let active_tuple_size = |logical: u64, disk: u64| if use_disk_mode { disk } else { logical };
    let active_file_size = |file: &FileInfo| {
        if use_disk_mode {
            file.size_disk
        } else {
            file.size_logical
        }
    };

    all_dirs.sort_by(|a, b| {
        active_tuple_size(b.1, b.2)
            .cmp(&active_tuple_size(a.1, a.2))
            .then_with(|| a.0.cmp(&b.0))
    });

    large_files.sort_by(|a, b| {
        active_file_size(b)
            .cmp(&active_file_size(a))
            .then_with(|| a.path.cmp(&b.path))
    });

    let total_files_found = large_files.len();
    let total_directories_found = all_dirs.len();

    let mut final_files = large_files;
    if let Some(l) = limit {
        final_files.truncate(l);
    }

    let selected_dir_entries = if let Some(l) = limit {
        all_dirs.into_iter().take(l).collect::<Vec<_>>()
    } else {
        all_dirs
    };

    let mut final_dirs: Vec<FileInfo> = selected_dir_entries
        .into_iter()
        .filter_map(|(path, size, disk_usage)| {
            create_file_info_with_sizes(&path, size, disk_usage, true).ok()
        })
        .collect();

    let mut result_by_path: HashMap<String, FileInfo> = HashMap::new();

    for dir in &final_dirs {
        result_by_path.insert(dir.path.clone(), dir.clone());
        add_ancestor_dirs(Path::new(&dir.path), root, &dir_sizes, &mut result_by_path);
    }

    for file in &final_files {
        result_by_path.insert(file.path.clone(), file.clone());
        add_ancestor_dirs(Path::new(&file.path), root, &dir_sizes, &mut result_by_path);
    }

    final_dirs = result_by_path
        .values()
        .filter(|item| item.is_dir)
        .cloned()
        .collect();
    final_dirs.sort_by(|a, b| {
        active_file_size(b)
            .cmp(&active_file_size(a))
            .then_with(|| a.path.cmp(&b.path))
    });
    metrics.sorting_time = sort_start.elapsed().as_nanos();

    metrics.finish();
    metrics.log_summary();

    let total_size = if size_mode == Some("disk") {
        total_disk_usage
    } else {
        total_logical_size
    };

    let mut results = final_files.clone();
    results.extend(final_dirs.clone());
    results.sort_by(|a, b| {
        active_file_size(b)
            .cmp(&active_file_size(a))
            .then_with(|| a.path.cmp(&b.path))
    });

    progress_callback(ScanEvent::Completed {
        scan_id: scan_id.clone(),
        files_found: total_files_found,
        directories_found: total_directories_found,
        total_size,
        total_size_logical: total_logical_size,
        total_size_disk: total_disk_usage,
        results,
    })?;

    Ok((final_files, final_dirs, total_size))
}

fn add_ancestor_dirs(
    item_path: &Path,
    root: &Path,
    dir_sizes: &HashMap<PathBuf, (u64, u64)>,
    result_by_path: &mut HashMap<String, FileInfo>,
) {
    let mut current = item_path.parent();

    while let Some(parent) = current {
        if parent == root || !parent.starts_with(root) {
            break;
        }

        if let Some((size_logical, size_disk)) = dir_sizes.get(parent) {
            if let Ok(info) = create_file_info_with_sizes(parent, *size_logical, *size_disk, true)
            {
                result_by_path.entry(info.path.clone()).or_insert(info);
            }
        }

        current = parent.parent();
    }
}

/// 辅助函数：创建 FileInfo
fn create_file_info_from_metadata(
    path: &Path,
    size: u64,
    is_dir: bool,
    metadata: &std::fs::Metadata,
) -> Result<FileInfo, Box<dyn std::error::Error>> {
    let modified = metadata
        .modified()
        .ok()
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap().as_secs());

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let disk_usage = {
        let blocks = metadata.blocks();
        if blocks == 0 {
            size
        } else {
            blocks * 512
        }
    };

    Ok(FileInfo {
        path: path.to_string_lossy().to_string(),
        size_logical: size,
        is_dir,
        modified,
        name,
        size_disk: disk_usage,
    })
}

fn create_file_info_with_sizes(
    path: &Path,
    size_logical: u64,
    size_disk: u64,
    is_dir: bool,
) -> Result<FileInfo, Box<dyn std::error::Error>> {
    match std::fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata
                .modified()
                .ok()
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap().as_secs());
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string());
            Ok(FileInfo {
                path: path.to_string_lossy().to_string(),
                size_logical,
                is_dir,
                modified,
                name,
                size_disk,
            })
        }
        Err(_) => Ok(FileInfo {
            path: path.to_string_lossy().to_string(),
            size_logical,
            is_dir,
            modified: None,
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            size_disk,
        }),
    }
}
