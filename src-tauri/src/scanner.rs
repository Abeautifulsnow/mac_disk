use crate::commands::{FileInfo, ScanEvent};
use crate::index::{normalize_path, ScanCoverage, ScanIndex, UnscannedRegion};
use std::collections::{HashMap, HashSet};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, UNIX_EPOCH};
use walkdir::WalkDir;

/// Upper bound on the number of live preview events emitted during a scan.
const PREVIEW_EVENT_CAP: usize = 200;
/// Only files at least this large are emitted as live previews (avoids flooding).
const PREVIEW_MIN_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

/// Build a complete scan index for `root`, emitting progress and bounded live
/// preview events through `progress_callback`. The `Completed` event is emitted
/// by the caller after the index is stored, so queries never race it.
pub fn scan_directory_with_progress<F>(
    root: &Path,
    cancel_flag: Arc<AtomicBool>,
    scan_id: String,
    mut progress_callback: F,
) -> Result<(ScanIndex, ScanCoverage), Box<dyn std::error::Error>>
where
    F: FnMut(ScanEvent) -> Result<(), Box<dyn std::error::Error>>,
{
    let mut index = ScanIndex::new(root);
    let mut unscanned_regions: Vec<UnscannedRegion> = Vec::new();
    let mut seen_inodes: HashSet<(u32, u64)> = HashSet::new();
    let mut dir_agg: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    let mut preview_dirs_sent: HashMap<String, (u64, u64)> = HashMap::new();
    let mut preview_events_emitted = 0usize;
    let mut scanned_entries = 0usize;
    let mut last_progress_emit = Instant::now();

    progress_callback(ScanEvent::Progress {
        scan_id: scan_id.clone(),
        processed: 0,
        discovered: None,
        total_estimated: None,
        current_path: root.to_string_lossy().to_string(),
        phase: Some("walking".to_string()),
    })?;

    for entry in WalkDir::new(root).follow_links(false).min_depth(1).into_iter() {
        if cancel_flag.load(Ordering::SeqCst) {
            progress_callback(ScanEvent::Cancelled {
                scan_id: scan_id.clone(),
            })?;
            return Err("扫描被取消".into());
        }

        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                scanned_entries += 1;
                let path = err.path().map(|p| p.to_string_lossy().to_string());
                record_region(
                    &mut unscanned_regions,
                    path,
                    reason_for_walkdir_error(&err),
                );
                continue;
            }
        };
        scanned_entries += 1;
        let current_path = entry.path().to_string_lossy().to_string();

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                record_region(&mut unscanned_regions, Some(current_path), "metadata-error");
                continue;
            }
        };

        if metadata.is_dir() {
            index.insert(entry.path(), true, 0, 0, 0, 0, 0, modified_of(&metadata));
        } else if metadata.is_file() {
            let size_logical = metadata.len();
            let size_disk = compute_disk_usage(&metadata);
            let dev = metadata.dev() as u32;
            let ino = metadata.ino();
            let physical_unique = if seen_inodes.insert((dev, ino)) { size_disk } else { 0 };
            let modified = modified_of(&metadata);

            index.insert(
                entry.path(),
                false,
                size_logical,
                size_disk,
                physical_unique,
                dev,
                ino,
                modified,
            );

            // Bounded live preview of large files.
            if preview_events_emitted < PREVIEW_EVENT_CAP && size_disk >= PREVIEW_MIN_SIZE {
                preview_events_emitted += 1;
                progress_callback(ScanEvent::FileFound {
                    scan_id: scan_id.clone(),
                    file: FileInfo {
                        path: current_path.clone(),
                        size_logical,
                        is_dir: false,
                        modified,
                        name: entry
                            .file_name()
                            .to_string_lossy()
                            .to_string(),
                        size_disk,
                        physical_unique,
                    },
                })?;
            }

            accumulate_parent_sizes(root, entry.path(), size_logical, size_disk, &mut dir_agg);
        }

        if maybe_emit_progress(
            &mut progress_callback,
            &scan_id,
            &mut last_progress_emit,
            scanned_entries,
            &current_path,
        )? {
            emit_dir_previews(
                root,
                &dir_agg,
                PREVIEW_EVENT_CAP - preview_events_emitted,
                &scan_id,
                &mut preview_dirs_sent,
                &mut preview_events_emitted,
                &mut progress_callback,
            )?;
        }
    }

    index.finish();

    progress_callback(ScanEvent::Progress {
        scan_id: scan_id.clone(),
        processed: scanned_entries,
        discovered: Some(scanned_entries),
        total_estimated: Some(scanned_entries),
        current_path: root.to_string_lossy().to_string(),
        phase: Some("processing".to_string()),
    })?;

    let partial = !unscanned_regions.is_empty();
    Ok((
        index,
        ScanCoverage {
            scanned_entries,
            unscanned_regions,
            partial,
        },
    ))
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

fn emit_dir_previews<F>(
    root: &Path,
    dir_agg: &HashMap<PathBuf, (u64, u64)>,
    budget: usize,
    scan_id: &str,
    preview_dirs_sent: &mut HashMap<String, (u64, u64)>,
    preview_events_emitted: &mut usize,
    progress_callback: &mut F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnMut(ScanEvent) -> Result<(), Box<dyn std::error::Error>>,
{
    if budget == 0 {
        return Ok(());
    }
    let mut top: Vec<(&PathBuf, u64, u64)> = dir_agg
        .iter()
        .filter(|(p, _)| *p != root)
        .map(|(p, (l, d))| (p, *l, *d))
        .collect();
    top.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(b.0)));
    for (path, l, d) in top.iter().take(budget) {
        let key = path.to_string_lossy().to_string();
        let next_sizes = (*l, *d);
        let should_emit = preview_dirs_sent
            .get(&key)
            .map(|sizes| *sizes != next_sizes)
            .unwrap_or(true);
        if should_emit {
            preview_dirs_sent.insert(key.clone(), next_sizes);
            *preview_events_emitted += 1;
            progress_callback(ScanEvent::DirectoryFound {
                scan_id: scan_id.to_string(),
                directory: FileInfo {
                    path: key.clone(),
                    size_logical: *l,
                    is_dir: true,
                    modified: None,
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| key.clone()),
                    size_disk: *d,
                    physical_unique: 0,
                },
            })?;
            if *preview_events_emitted >= PREVIEW_EVENT_CAP {
                return Ok(());
            }
        }
    }
    Ok(())
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

/// Blocks unavailable (0) means the file occupies no allocated blocks; we never
/// fall back to the logical size (that overstates sparse/empty files).
fn compute_disk_usage(metadata: &std::fs::Metadata) -> u64 {
    let blocks = metadata.blocks();
    if blocks == 0 {
        0
    } else {
        blocks * 512
    }
}

fn modified_of(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn reason_for_walkdir_error(err: &walkdir::Error) -> &'static str {
    if err.loop_ancestor().is_some() {
        "symlink-loop"
    } else if err
        .io_error()
        .map(|e| e.kind() == std::io::ErrorKind::PermissionDenied)
        .unwrap_or(false)
    {
        "permission-denied"
    } else {
        "io-error"
    }
}

/// Record a region as unscanned, keeping only top-level failing paths.
fn record_region(regions: &mut Vec<UnscannedRegion>, path: Option<String>, reason: &str) {
    let Some(path) = path else { return };
    let path = normalize_path(&path);
    if regions
        .iter()
        .any(|r| path == r.path || path.starts_with(&format!("{}/", r.path)))
    {
        return;
    }
    regions.retain(|r| !r.path.starts_with(&format!("{}/", path)));
    regions.push(UnscannedRegion {
        path,
        reason: reason.to_string(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{FlatQuery, KindFilter, ModifiedWindow, SizeMode, SortKey};
    use std::fs;
    use std::sync::atomic::AtomicBool;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let unique = std::time::SystemTime::now()
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

    fn scan(dir: &Path) -> ScanIndex {
        let cancel = Arc::new(AtomicBool::new(false));
        scan_directory_with_progress(dir, cancel, "test".to_string(), |_| Ok(()))
            .unwrap()
            .0
    }

    fn flat_files(index: &ScanIndex, min_size: Option<u64>) -> Vec<FileInfo> {
        let q = FlatQuery {
            min_size,
            modified_window: ModifiedWindow::All,
            search_query: None,
            kind: KindFilter::Files,
            type_filter: None,
            sort: SortKey::Size,
            sort_desc: true,
            size_mode: SizeMode::Logical,
            offset: 0,
            limit: crate::index::MAX_PAGE_SIZE,
        };
        index.query_flat(&q).items
    }

    #[test]
    fn scan_keeps_all_files_beyond_old_display_cap() {
        let dir = TestDir::new("all_files");
        let mut expected: Vec<PathBuf> = Vec::new();
        for i in 0..250 {
            expected.push(dir.write_file(&format!("f{:03}.bin", i), 10 + (i % 5)));
        }
        let index = scan(&dir.path);
        let files = flat_files(&index, None);
        assert_eq!(files.len(), 250);
        for path in &expected {
            assert!(files.iter().any(|f| f.path == path.to_string_lossy()), "missing {}", path.display());
        }
    }

    #[test]
    fn directory_aggregates_are_complete_regardless_of_filter() {
        let dir = TestDir::new("agg_complete");
        dir.write_file("a.bin", 12);
        dir.write_file("nested/b.bin", 30);
        dir.write_file("nested/deep/c.bin", 58);
        let index = scan(&dir.path);

        let (nested_l, _nested_d) = index
            .query_dir_size(&dir.path.join("nested").to_string_lossy())
            .unwrap();
        assert_eq!(nested_l, 88);

        let (root_l, _) = index.query_dir_size(&dir.path.to_string_lossy()).unwrap();
        assert_eq!(root_l, 100);

        // minSize filter on query does not change aggregates.
        let _ = flat_files(&index, Some(50));
        let (root_l2, _) = index.query_dir_size(&dir.path.to_string_lossy()).unwrap();
        assert_eq!(root_l2, 100);
    }

    #[test]
    fn min_size_is_query_filter_only_and_mode_independent() {
        let dir = TestDir::new("mode_indep");
        // sparse-like: small disk, large logical is hard to simulate; use normal files.
        dir.write_file("big.bin", 100);
        dir.write_file("small.bin", 8);
        let index = scan(&dir.path);

        // Logical-mode filter of 20 should find big.bin only.
        let q = FlatQuery {
            min_size: Some(20),
            modified_window: ModifiedWindow::All,
            search_query: None,
            kind: KindFilter::Files,
            type_filter: None,
            sort: SortKey::Size,
            sort_desc: true,
            size_mode: SizeMode::Logical,
            offset: 0,
            limit: crate::index::MAX_PAGE_SIZE,
        };
        let items = index.query_flat(&q).items;
        assert_eq!(items.len(), 1);
        assert!(items[0].name == "big.bin");

        // Disk-mode filter of 20 must still find big.bin (no scan-time pruning).
        let q2 = FlatQuery { size_mode: SizeMode::Disk, ..q };
        let items2 = index.query_flat(&q2).items;
        assert!(items2.iter().any(|f| f.name == "big.bin"));
    }

    #[test]
    fn subtree_returns_children_sorted_and_paginated() {
        let dir = TestDir::new("subtree");
        dir.write_file("small.bin", 8);
        dir.write_file("big.bin", 64);
        dir.write_file("mid.bin", 32);
        let index = scan(&dir.path);

        let page = index.query_subtree(&dir.path.to_string_lossy(), SizeMode::Logical, 0, 2);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.total, 3);
        assert!(page.has_more);
        assert_eq!(page.items[0].name, "big.bin");
        assert_eq!(page.items[1].name, "mid.bin");

        let page2 = index.query_subtree(&dir.path.to_string_lossy(), SizeMode::Logical, 2, 2);
        assert_eq!(page2.items.len(), 1);
        assert!(!page2.has_more);
    }

    #[test]
    fn delete_removes_subtree_and_recomputes_totals() {
        let dir = TestDir::new("delete_consist");
        dir.write_file("a.bin", 10);
        dir.write_file("keep.bin", 50);
        dir.write_file("gone/deep/removed.bin", 40);
        let mut index = scan(&dir.path);

        let root_before = index.query_dir_size(&dir.path.to_string_lossy()).unwrap().0;
        assert_eq!(root_before, 100);

        let removed = index.delete_subtree(&dir.path.join("gone").to_string_lossy()).unwrap();
        assert_eq!(removed.0, 40); // removed logical size

        let root_after = index.query_dir_size(&dir.path.to_string_lossy()).unwrap().0;
        assert_eq!(root_after, 60);

        // Deleted subtree no longer reachable.
        let gone_children = index.query_subtree(&dir.path.to_string_lossy(), SizeMode::Logical, 0, 500);
        assert!(gone_children.items.iter().all(|f| !f.path.contains("gone")));
        assert!(index.query_dir_size(&dir.path.join("gone").to_string_lossy()).is_none());

        // Insights recomputed.
        let summary = index.summary();
        assert_eq!(summary.total_size_logical, 60);
        assert_eq!(summary.files_scanned, 2);
    }

    #[test]
    fn pagination_is_stable_for_equal_sized_files() {
        let dir = TestDir::new("stable_page");
        for i in 0..30 {
            dir.write_file(&format!("f{:02}.bin", i), 100);
        }
        let index = scan(&dir.path);

        let mut seen: HashSet<String> = HashSet::new();
        let mut offset = 0usize;
        loop {
            let page = index.query_flat(&FlatQuery {
                min_size: None,
                modified_window: ModifiedWindow::All,
                search_query: None,
                kind: KindFilter::Files,
                type_filter: None,
                sort: SortKey::Size,
                sort_desc: true,
                size_mode: SizeMode::Logical,
                offset,
                limit: 7,
            });
            for item in &page.items {
                assert!(seen.insert(item.path.clone()), "duplicate across pages: {}", item.path);
            }
            if !page.has_more {
                break;
            }
            offset += 7;
        }
        assert_eq!(seen.len(), 30);
    }

    #[test]
    fn type_filter_applies_across_all_pages() {
        let dir = TestDir::new("type_filter");
        dir.write_file("video.mp4", 40);
        dir.write_file("photo.jpg", 20);
        dir.write_file("audio.mp3", 30);
        let index = scan(&dir.path);

        let q = FlatQuery {
            min_size: None,
            modified_window: ModifiedWindow::All,
            search_query: None,
            kind: KindFilter::Files,
            type_filter: Some("视频".to_string()),
            sort: SortKey::Size,
            sort_desc: true,
            size_mode: SizeMode::Logical,
            offset: 0,
            limit: crate::index::MAX_PAGE_SIZE,
        };
        let items = index.query_flat(&q).items;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "video.mp4");
    }

    fn scan_with_coverage(dir: &Path) -> (ScanIndex, ScanCoverage) {
        let cancel = Arc::new(AtomicBool::new(false));
        scan_directory_with_progress(dir, cancel, "test".to_string(), |_| Ok(())).unwrap()
    }

    #[test]
    fn physical_unique_dedupes_hardlinks() {
        let dir = TestDir::new("hardlink");
        let original = dir.write_file("orig.bin", 64);
        let link = dir.path.join("link.bin");
        fs::hard_link(&original, &link).unwrap();

        let index = scan(&dir.path);
        let files = flat_files(&index, None);
        assert_eq!(files.len(), 2);

        let summary = index.summary();
        // Allocated disk counts both links; the deduplicated total counts one inode.
        assert!(summary.total_size_disk > 0);
        assert!(summary.physical_unique_total > 0);
        assert!(summary.physical_unique_total < summary.total_size_disk);
        // Per-file dedup: one path carries the bytes, the other zero.
        let nonzero = files
            .iter()
            .filter(|f| f.physical_unique > 0)
            .count();
        assert_eq!(nonzero, 1);
    }

    #[test]
    fn permission_denied_dirs_are_recorded_as_unscanned() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new("coverage");
        dir.write_file("ok.bin", 10);
        let locked = dir.path.join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::write(locked.join("hidden.bin"), vec![0u8; 16]).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

        let (_index, coverage) = scan_with_coverage(&dir.path);
        // Restore permissions so the temp dir can be cleaned up.
        let _ = fs::set_permissions(&locked, fs::Permissions::from_mode(0o755));

        assert!(coverage.partial);
        assert!(coverage.unscanned_regions.iter().any(|r| {
            r.path.ends_with("locked") && r.reason == "permission-denied"
        }));
    }

    #[test]
    fn rust_category_matches_frontend_taxonomy() {
        // Mirrors the bucket set in src/scanInsights.ts categorizeFile.
        let file_cases = [
            ("video.mp4", "视频"),
            ("photo.JPG", "图片"),
            ("song.mp3", "音频"),
            ("doc.pdf", "文档"),
            ("archive.tar.gz", "归档文件"),
            ("installer.dmg", "应用"),
            ("db.sqlite", "数据库"),
            ("design.psd", "设计文件"),
            ("disk.iso", "磁盘镜像"),
            ("random.bin", "其他文件"),
        ];
        for (name, expected) in file_cases {
            assert_eq!(
                crate::index::categorize_file(name, "/x/placeholder", false).as_deref(),
                Some(expected),
                "file {name}"
            );
        }
        assert_eq!(
            crate::index::categorize_file("Foo.app", "/x/Foo.app", true).as_deref(),
            Some("应用")
        );
        assert_eq!(
            crate::index::categorize_file("node_modules", "/x/node_modules", true).as_deref(),
            Some("Node 模块")
        );
        assert_eq!(
            crate::index::categorize_file("caches", "/x/caches", true).as_deref(),
            Some("缓存目录")
        );
        assert_eq!(
            crate::index::categorize_file("Anything", "/x/Library/Caches/foo", true).as_deref(),
            Some("缓存目录")
        );
        assert_eq!(
            crate::index::categorize_file("DerivedData", "/x/DerivedData/sub", true).as_deref(),
            Some("Xcode 缓存")
        );
        assert_eq!(crate::index::categorize_file("src", "/x/src", true), None);
    }

    #[test]
    fn insights_reflect_complete_index() {
        let dir = TestDir::new("insights");
        dir.write_file("small.txt", 10);
        dir.write_file("big.mkv", 5000);
        dir.write_file("photo.jpg", 300);
        let index = scan(&dir.path);

        let s = index.summary();
        assert_eq!(s.files_scanned, 3);
        let largest = s.insights.largest_file.unwrap();
        assert!(largest.path.ends_with("big.mkv"));
        let top = s.insights.top_types.iter().next().unwrap();
        assert_eq!(top.label, "视频");
        assert_eq!(top.count, 1);
    }
}
