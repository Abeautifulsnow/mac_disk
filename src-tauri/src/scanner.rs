use crate::commands::{FileInfo, ScanEvent};
use rayon::prelude::*;
use std::collections::HashMap;
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
) -> Result<Vec<FileInfo>, Box<dyn std::error::Error>> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let (files, dirs, _) = scan_directory_with_progress(
        root,
        limit,
        min_size,
        cancel_flag,
        "internal".to_string(),
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
) -> Result<Vec<FileInfo>, Box<dyn std::error::Error>> {
    scan_directory(root, limit, min_size)
}

/// 带进度跟踪和取消支持的目录扫描（高性能重构版）
pub fn scan_directory_with_progress<F>(
    root: &Path,
    limit: Option<usize>,
    min_size: Option<u64>,
    cancel_flag: Arc<AtomicBool>,
    scan_id: String,
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

    let mut dir_sizes: HashMap<PathBuf, u64> = HashMap::new();
    let mut large_files: Vec<FileInfo> = Vec::new();
    let mut total_size: u64 = 0;

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
            dirs: HashMap<PathBuf, u64>,
            total_size: u64,
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
                acc.total_size = acc.total_size.saturating_add(size);

                let mut current = entry.path().parent();
                while let Some(parent) = current {
                    if !parent.starts_with(root) {
                        break;
                    }
                    let key = parent.to_path_buf();
                    let v = acc.dirs.entry(key).or_insert(0);
                    *v = v.saturating_add(size);
                    if parent == root {
                        break;
                    }
                    current = parent.parent();
                }

                if min_size.map_or(true, |min| size >= min) {
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
                a.total_size = a.total_size.saturating_add(b.total_size);
                a.skipped += b.skipped;
                for (k, v) in b.dirs {
                    let e = a.dirs.entry(k).or_insert(0);
                    *e = e.saturating_add(v);
                }
                Ok(a)
            });

        match chunk_result {
            Ok(acc) => {
                large_files.extend(acc.files);
                total_size = total_size.saturating_add(acc.total_size);
                metrics.skipped_entries += acc.skipped;
                for (k, v) in acc.dirs {
                    let entry = dir_sizes.entry(k).or_insert(0);
                    *entry = entry.saturating_add(v);
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

    // 使用层级贪心算法避免父级目录和子级目录同时出现
    // 算法思路：按深度排序（从浅到深），对于每个目录，检查它的父目录是否已经在结果中
    // 如果父目录已经在结果中，则跳过这个目录
    // 如果这个目录本身在结果中，则它的所有子目录都会被跳过

    // 首先收集所有符合大小要求的目录
    let mut all_dirs: Vec<(PathBuf, u64)> = dir_sizes
        .into_iter()
        .filter(|(path, _size)| *path != root)
        .filter(|(_path, size)| {
            if let Some(min) = min_size {
                *size >= min
            } else {
                true
            }
        })
        .collect::<Vec<_>>();

    // 按深度排序（从浅到深），然后按大小排序
    // 深度使用路径组件数量来估计
    all_dirs.sort_by(|a, b| {
        let depth_a = a.0.components().count();
        let depth_b = b.0.components().count();
        // 先按深度升序（更浅的先处理）
        match depth_a.cmp(&depth_b) {
            std::cmp::Ordering::Equal => b.1.cmp(&a.1), // 深度相同按大小降序
            other => other,
        }
    });

    // 使用 HashSet 记录已选择的目录路径
    let mut selected_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut large_dirs: Vec<FileInfo> = Vec::new();

    for (path, size) in all_dirs {
        let path_str = path.to_string_lossy().to_string();

        // 检查这个目录是否在某个已选择目录的子目录下
        // 即：检查是否有已选择的目录是当前目录的父目录
        let is_child_of_selected = selected_paths.iter().any(|selected| {
            // 确保路径分隔符匹配，避免误判
            // 例如：避免将 "/UserA" 误认为是 "/User" 的子目录
            let selected_with_sep = if selected.ends_with('/') {
                selected.clone()
            } else {
                format!("{}/", selected)
            };
            path_str.starts_with(&selected_with_sep)
        });

        if !is_child_of_selected {
            // 这个目录不在任何已选择目录之下，选择它
            if let Ok(info) = create_file_info(&path, size, true) {
                large_dirs.push(info);
                selected_paths.insert(path_str);
            }
        }
        // 否则，这个目录在已选择目录之下，跳过
    }

    // 过滤大文件：只保留不在已选择目录下的文件
    let filtered_large_files: Vec<FileInfo> = large_files
        .into_iter()
        .filter(|file| {
            let file_path = &file.path;

            // 检查文件路径是否在已选择的目录下
            !selected_paths.iter().any(|selected| {
                file_path.starts_with(selected)
            })
        })
        .collect();

    let sort_start = Instant::now();
    let mut final_files = filtered_large_files;
    let mut final_dirs = large_dirs;
    let total_files_found = final_files.len();
    let total_directories_found = final_dirs.len();

    final_files.sort_by(|a, b| b.size.cmp(&a.size));
    final_dirs.sort_by(|a, b| b.size.cmp(&a.size));

    if let Some(l) = limit {
        if final_files.len() > l {
            final_files.truncate(l);
        }
        if final_dirs.len() > l {
            final_dirs.truncate(l);
        }
    }
    metrics.sorting_time = sort_start.elapsed().as_nanos();

    metrics.finish();
    metrics.log_summary();

    let mut results = final_files.clone();
    results.extend(final_dirs.clone());
    results.sort_by(|a, b| b.size.cmp(&a.size));

    progress_callback(ScanEvent::Completed {
        scan_id: scan_id.clone(),
        files_found: total_files_found,
        directories_found: total_directories_found,
        total_size,
        results,
    })?;

    Ok((final_files, final_dirs, total_size))
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

    Ok(FileInfo {
        path: path.to_string_lossy().to_string(),
        size,
        is_dir,
        modified,
        name,
    })
}

fn create_file_info(
    path: &Path,
    size: u64,
    is_dir: bool,
) -> Result<FileInfo, Box<dyn std::error::Error>> {
    // 这里我们可能无法再次获取 metadata 如果文件被删除了，或者为了性能我们不应该再次获取。
    // 但对于目录，我们没有保留原始 metadata。
    // 重新获取 metadata 是可以接受的，因为目录数量远少于文件。
    match std::fs::metadata(path) {
        Ok(metadata) => create_file_info_from_metadata(path, size, is_dir, &metadata),
        Err(_) => {
            // 如果无法读取元数据，手动构造一个基本信息
            Ok(FileInfo {
                path: path.to_string_lossy().to_string(),
                size,
                is_dir,
                modified: None,
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            })
        }
    }
}
