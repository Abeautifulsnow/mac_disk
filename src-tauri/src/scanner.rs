use crate::commands::{FileInfo, ScanEvent};
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

    tracing::info!("[{}] 开始流式遍历目录...", scan_id);
    let mut dir_sizes: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    let mut selected_files: Vec<FileInfo> = Vec::new();
    let mut preview_files: Vec<FileInfo> = Vec::new();
    let mut preview_directories_sent: HashMap<String, (u64, u64)> = HashMap::new();
    let mut total_logical_size: u64 = 0;
    let mut total_disk_usage: u64 = 0;
    let use_disk_mode = size_mode == Some("disk");
    let mut matched_files_found = 0usize;
    let preview_limit = limit.unwrap_or(50).max(1);
    let dir_calc_start = Instant::now();
    let mut discovered_entries = 0usize;
    let mut last_progress_emit = Instant::now();

    for entry in WalkDir::new(root).follow_links(false).min_depth(1).into_iter() {
        if cancel_flag.load(Ordering::SeqCst) {
            progress_callback(ScanEvent::Cancelled {
                scan_id: scan_id.clone(),
            })?;
            return Err("扫描被取消".into());
        }
        let Ok(entry) = entry else {
            metrics.skipped_entries += 1;
            continue;
        };

        discovered_entries += 1;
        metrics.total_entries = discovered_entries;
        let current_path = entry.path().to_string_lossy().to_string();

        let metadata_start = Instant::now();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                metrics.metadata_read_time += metadata_start.elapsed().as_nanos();
                metrics.skipped_entries += 1;
                maybe_emit_progress(
                    &mut progress_callback,
                    &scan_id,
                    &mut last_progress_emit,
                    discovered_entries,
                    &current_path,
                )?;
                continue;
            }
        };
        metrics.metadata_read_time += metadata_start.elapsed().as_nanos();

        if metadata.is_dir() {
            metrics.dirs_processed += 1;
        } else if metadata.is_file() {
            metrics.files_processed += 1;

            let size = metadata.len();
            let disk_usage = compute_disk_usage(size, &metadata);
            total_logical_size = total_logical_size.saturating_add(size);
            total_disk_usage = total_disk_usage.saturating_add(disk_usage);

            accumulate_parent_sizes(root, entry.path(), size, disk_usage, &mut dir_sizes);

            let active_size = if use_disk_mode { disk_usage } else { size };
            if min_size.map_or(true, |min| active_size >= min) {
                matched_files_found += 1;
                if let Ok(info) =
                    create_file_info_from_metadata(entry.path(), size, false, &metadata)
                {
                    let preview_item = retain_top_files(
                        &mut preview_files,
                        info.clone(),
                        Some(preview_limit),
                        use_disk_mode,
                    );
                    retain_top_files(&mut selected_files, info, limit, use_disk_mode);
                    if let Some(file) = preview_item {
                        progress_callback(ScanEvent::FileFound {
                            scan_id: scan_id.clone(),
                            file,
                        })?;
                    }
                }
            }
        }

        let progress_emitted = maybe_emit_progress(
            &mut progress_callback,
            &scan_id,
            &mut last_progress_emit,
            discovered_entries,
            &current_path,
        )?;
        if progress_emitted {
            emit_directory_previews(
                root,
                &dir_sizes,
                min_size,
                use_disk_mode,
                preview_limit,
                &scan_id,
                &mut preview_directories_sent,
                &mut progress_callback,
            )?;
        }
    }

    metrics.dir_calc_time = dir_calc_start.elapsed().as_nanos();

    progress_callback(ScanEvent::Progress {
        scan_id: scan_id.clone(),
        processed: discovered_entries,
        discovered: Some(discovered_entries),
        total_estimated: Some(discovered_entries),
        current_path: root.to_string_lossy().to_string(),
        phase: Some("processing".to_string()),
    })?;
    emit_directory_previews(
        root,
        &dir_sizes,
        min_size,
        use_disk_mode,
        preview_limit,
        &scan_id,
        &mut preview_directories_sent,
        &mut progress_callback,
    )?;

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
    all_dirs.sort_by(|a, b| {
        active_tuple_size(b.1, b.2)
            .cmp(&active_tuple_size(a.1, a.2))
            .then_with(|| a.0.cmp(&b.0))
    });

    selected_files.sort_by(|a, b| compare_file_info(a, b, use_disk_mode));

    let total_files_found = matched_files_found;
    let total_directories_found = all_dirs.len();

    let mut final_files = selected_files;
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
    final_dirs.sort_by(|a, b| compare_file_info(a, b, use_disk_mode));
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
    results.sort_by(|a, b| compare_file_info(a, b, use_disk_mode));

    progress_callback(ScanEvent::Completed {
        scan_id: scan_id.clone(),
        files_found: total_files_found,
        directories_found: total_directories_found,
        result_count: results.len(),
        total_size,
        total_size_logical: total_logical_size,
        total_size_disk: total_disk_usage,
        results,
    })?;

    Ok((final_files, final_dirs, total_size))
}

fn maybe_emit_progress<F>(
    progress_callback: &mut F,
    scan_id: &str,
    last_progress_emit: &mut Instant,
    processed: usize,
    current_path: &str,
) -> Result<bool, Box<dyn std::error::Error>>
where
    F: FnMut(ScanEvent) -> Result<(), Box<dyn std::error::Error>>,
{
    if processed % 500 == 0 || last_progress_emit.elapsed().as_millis() >= 300 {
        *last_progress_emit = Instant::now();
        progress_callback(ScanEvent::Progress {
            scan_id: scan_id.to_string(),
            processed,
            discovered: Some(processed),
            total_estimated: None,
            current_path: current_path.to_string(),
            phase: Some("walking".to_string()),
        })?;
        return Ok(true);
    }

    Ok(false)
}

fn accumulate_parent_sizes(
    root: &Path,
    path: &Path,
    size: u64,
    disk_usage: u64,
    dir_sizes: &mut HashMap<PathBuf, (u64, u64)>,
) {
    let mut current = path.parent();
    while let Some(parent) = current {
        if !parent.starts_with(root) {
            break;
        }
        let entry = dir_sizes.entry(parent.to_path_buf()).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(size);
        entry.1 = entry.1.saturating_add(disk_usage);
        if parent == root {
            break;
        }
        current = parent.parent();
    }
}

fn compute_disk_usage(size: u64, metadata: &std::fs::Metadata) -> u64 {
    let blocks = metadata.blocks();
    if blocks == 0 {
        size
    } else {
        blocks * 512
    }
}

fn compare_file_info(a: &FileInfo, b: &FileInfo, use_disk_mode: bool) -> std::cmp::Ordering {
    let a_size = if use_disk_mode {
        a.size_disk
    } else {
        a.size_logical
    };
    let b_size = if use_disk_mode {
        b.size_disk
    } else {
        b.size_logical
    };

    b_size.cmp(&a_size).then_with(|| a.path.cmp(&b.path))
}

fn retain_top_files(
    selected_files: &mut Vec<FileInfo>,
    candidate: FileInfo,
    limit: Option<usize>,
    use_disk_mode: bool,
) -> Option<FileInfo> {
    let Some(limit) = limit else {
        selected_files.push(candidate);
        return selected_files.last().cloned();
    };

    if limit == 0 {
        return None;
    }

    if selected_files.len() < limit {
        selected_files.push(candidate);
        return selected_files.last().cloned();
    }

    let weakest_index = selected_files
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let a_size = if use_disk_mode {
                a.size_disk
            } else {
                a.size_logical
            };
            let b_size = if use_disk_mode {
                b.size_disk
            } else {
                b.size_logical
            };

            a_size.cmp(&b_size).then_with(|| b.path.cmp(&a.path))
        })
        .map(|(index, _)| index);

    if let Some(index) = weakest_index {
        if compare_file_info(&candidate, &selected_files[index], use_disk_mode)
            == std::cmp::Ordering::Less
        {
            selected_files[index] = candidate;
            return Some(selected_files[index].clone());
        }
    }

    None
}

fn emit_directory_previews<F>(
    root: &Path,
    dir_sizes: &HashMap<PathBuf, (u64, u64)>,
    min_size: Option<u64>,
    use_disk_mode: bool,
    preview_limit: usize,
    scan_id: &str,
    preview_directories_sent: &mut HashMap<String, (u64, u64)>,
    progress_callback: &mut F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnMut(ScanEvent) -> Result<(), Box<dyn std::error::Error>>,
{
    let preview_dirs = collect_preview_directories(
        root,
        dir_sizes,
        min_size,
        use_disk_mode,
        preview_limit,
    );

    for directory in preview_dirs {
        let next_sizes = (directory.size_logical, directory.size_disk);
        let should_emit = preview_directories_sent
            .get(&directory.path)
            .map(|sizes| *sizes != next_sizes)
            .unwrap_or(true);
        if should_emit {
            preview_directories_sent.insert(directory.path.clone(), next_sizes);
            progress_callback(ScanEvent::DirectoryFound {
                scan_id: scan_id.to_string(),
                directory,
            })?;
        }
    }

    Ok(())
}

fn collect_preview_directories(
    root: &Path,
    dir_sizes: &HashMap<PathBuf, (u64, u64)>,
    min_size: Option<u64>,
    use_disk_mode: bool,
    preview_limit: usize,
) -> Vec<FileInfo> {
    let mut preview_dirs = dir_sizes
        .iter()
        .filter(|(path, _)| *path != root)
        .filter(|(_, sizes)| {
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
        .filter_map(|(path, sizes)| {
            create_file_info_with_sizes(path, sizes.0, sizes.1, true).ok()
        })
        .collect::<Vec<_>>();

    preview_dirs.sort_by(|a, b| compare_file_info(a, b, use_disk_mode));
    preview_dirs.truncate(preview_limit);
    preview_dirs
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

    let disk_usage = compute_disk_usage(size, metadata);

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mac_disk_scanner_{}_{}_{}",
                name,
                std::process::id(),
                unique
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write_file(&self, relative_path: &str, size: usize) -> PathBuf {
            let path = self.path.join(relative_path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, vec![b'x'; size]).unwrap();
            path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn find_item<'a>(items: &'a [FileInfo], path: &Path) -> &'a FileInfo {
        let path = path.to_string_lossy();
        items
            .iter()
            .find(|item| item.path == path)
            .unwrap_or_else(|| panic!("missing item: {}", path))
    }

    #[test]
    fn scan_returns_files_directories_and_total_logical_size() {
        let dir = TestDir::new("totals");
        let file_a = dir.write_file("alpha.bin", 12);
        let nested_file = dir.write_file("nested/beta.bin", 30);
        let nested_dir = dir.path.join("nested");

        let results = scan_directory(&dir.path, None, None, Some("logical")).unwrap();

        let alpha = find_item(&results, &file_a);
        assert!(!alpha.is_dir);
        assert_eq!(alpha.size_logical, 12);
        assert!(alpha.size_disk >= alpha.size_logical);

        let beta = find_item(&results, &nested_file);
        assert!(!beta.is_dir);
        assert_eq!(beta.size_logical, 30);

        let nested = find_item(&results, &nested_dir);
        assert!(nested.is_dir);
        assert_eq!(nested.size_logical, 30);
        assert!(nested.size_disk >= nested.size_logical);
    }

    #[test]
    fn min_size_filter_uses_selected_size_mode_for_files_and_dirs() {
        let dir = TestDir::new("min_size");
        let small_file = dir.write_file("small.bin", 8);
        let large_file = dir.write_file("folder/large.bin", 64);
        let folder = dir.path.join("folder");

        let results = scan_directory(&dir.path, None, Some(32), Some("logical")).unwrap();

        assert!(results
            .iter()
            .all(|item| item.path != small_file.to_string_lossy()));
        assert!(results
            .iter()
            .any(|item| item.path == large_file.to_string_lossy()));
        assert!(results
            .iter()
            .any(|item| item.path == folder.to_string_lossy()));
    }

    #[test]
    fn limited_results_include_ancestors_for_tree_rendering() {
        let dir = TestDir::new("ancestors");
        let large_file = dir.write_file("a/b/c/large.bin", 128);
        let small_file = dir.write_file("z/small.bin", 1);
        let ancestor_a = dir.path.join("a");
        let ancestor_b = dir.path.join("a/b");
        let ancestor_c = dir.path.join("a/b/c");

        let results = scan_directory(&dir.path, Some(1), Some(2), Some("logical")).unwrap();

        assert!(results
            .iter()
            .any(|item| item.path == large_file.to_string_lossy()));
        assert!(!results
            .iter()
            .any(|item| item.path == small_file.to_string_lossy()));
        assert!(results
            .iter()
            .any(|item| item.path == ancestor_a.to_string_lossy()));
        assert!(results
            .iter()
            .any(|item| item.path == ancestor_b.to_string_lossy()));
        assert!(results
            .iter()
            .any(|item| item.path == ancestor_c.to_string_lossy()));
    }

    #[test]
    fn file_limit_keeps_largest_matching_files() {
        let dir = TestDir::new("topk");
        let _small = dir.write_file("small.bin", 8);
        let medium = dir.write_file("medium.bin", 64);
        let large = dir.write_file("large.bin", 128);

        let results = scan_directory(&dir.path, Some(2), None, Some("logical")).unwrap();
        let file_paths = results
            .iter()
            .filter(|item| !item.is_dir)
            .map(|item| item.path.clone())
            .collect::<Vec<_>>();

        assert_eq!(file_paths.len(), 2);
        assert!(file_paths.contains(&medium.to_string_lossy().to_string()));
        assert!(file_paths.contains(&large.to_string_lossy().to_string()));
    }

    #[test]
    fn progress_scan_emits_preview_events_before_completion() {
        let dir = TestDir::new("preview_events");
        dir.write_file("alpha.bin", 64);
        dir.write_file("nested/beta.bin", 96);

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let mut events = Vec::new();

        let result = scan_directory_with_progress(
            &dir.path,
            Some(5),
            None,
            cancel_flag,
            "test-scan".to_string(),
            Some("logical"),
            |event| {
                events.push(event);
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert!(events.iter().any(|event| matches!(event, ScanEvent::FileFound { .. })));
        assert!(events
            .iter()
            .any(|event| matches!(event, ScanEvent::DirectoryFound { .. })));

        let completed_index = events
            .iter()
            .position(|event| matches!(event, ScanEvent::Completed { .. }))
            .expect("completed event missing");
        let preview_index = events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    ScanEvent::FileFound { .. } | ScanEvent::DirectoryFound { .. }
                )
            })
            .expect("preview event missing");

        assert!(preview_index < completed_index);
    }
}
