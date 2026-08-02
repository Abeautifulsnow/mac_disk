use crate::index::{
    self, FlatPage, FlatQuery, Insights, KindFilter, ModifiedWindow, ScanCoverage,
    ScanIndexManager, SizeMode, SortKey,
};
use crate::scanner;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::command;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub path: String,
    #[serde(rename = "sizeLogical")]
    pub size_logical: u64,
    pub is_dir: bool,
    pub modified: Option<u64>,
    pub name: String,
    #[serde(rename = "sizeDisk")]
    pub size_disk: u64,
    #[serde(rename = "physicalUnique")]
    pub physical_unique: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub path: String,
    /// Deprecated: the display/result cap no longer exists. Kept for wire
    /// compatibility; ignored by the scanner.
    pub limit: Option<usize>,
    /// Deprecated as an index-pruning threshold. `minSize` now lives on the
    /// flat query and is a query/UI filter only. Kept for wire compatibility.
    pub min_size: Option<u64>,
    pub timeout_seconds: Option<u64>,
    pub size_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScanEvent {
    Progress {
        #[serde(rename = "scanId")]
        scan_id: String,
        processed: usize,
        #[serde(rename = "discovered")]
        discovered: Option<usize>,
        #[serde(rename = "totalEstimated")]
        total_estimated: Option<usize>,
        #[serde(rename = "currentPath")]
        current_path: String,
        #[serde(rename = "phase")]
        phase: Option<String>,
    },
    FileFound {
        #[serde(rename = "scanId")]
        scan_id: String,
        file: FileInfo,
    },
    DirectoryFound {
        #[serde(rename = "scanId")]
        scan_id: String,
        directory: FileInfo,
    },
    Completed {
        #[serde(rename = "scanId")]
        scan_id: String,
        #[serde(rename = "filesFound")]
        files_found: usize,
        #[serde(rename = "directoriesFound")]
        directories_found: usize,
        #[serde(rename = "totalSizeLogical")]
        total_size_logical: u64,
        #[serde(rename = "totalSizeDisk")]
        total_size_disk: u64,
        #[serde(rename = "physicalUniqueTotal")]
        physical_unique_total: u64,
        #[serde(rename = "scanCoverage")]
        scan_coverage: ScanCoverage,
        insights: Insights,
    },
    Cancelled {
        #[serde(rename = "scanId")]
        scan_id: String,
    },
    Timeout {
        #[serde(rename = "scanId")]
        scan_id: String,
    },
    Error {
        #[serde(rename = "scanId")]
        scan_id: String,
        message: String,
    },
}

/// 全局扫描状态管理器（取消控制）
#[derive(Clone)]
pub struct ScanManager {
    active_scans: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl ScanManager {
    pub fn new() -> Self {
        Self {
            active_scans: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register_scan(&self, scan_id: String) -> Arc<AtomicBool> {
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let mut scans = self.active_scans.lock().unwrap();
        scans.insert(scan_id.clone(), cancel_flag.clone());
        cancel_flag
    }

    pub fn cancel_scan(&self, scan_id: &str) -> bool {
        let scans = self.active_scans.lock().unwrap();
        if let Some(cancel_flag) = scans.get(scan_id) {
            cancel_flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    pub fn remove_scan(&self, scan_id: &str) {
        let mut scans = self.active_scans.lock().unwrap();
        scans.remove(scan_id);
    }

    pub fn is_cancelled(&self, scan_id: &str) -> bool {
        let scans = self.active_scans.lock().unwrap();
        if let Some(cancel_flag) = scans.get(scan_id) {
            cancel_flag.load(Ordering::SeqCst)
        } else {
            true
        }
    }
}

/// 将文件或目录移到废纸篓（需要前端二次确认）
/// 成功后若该路径属于某个扫描索引，则同步移除子树并返回更新后的统计。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub message: String,
    pub updated: Option<index::IndexSummary>,
}

#[command]
pub async fn delete_path(
    index_manager: State<'_, ScanIndexManager>,
    path: String,
    scan_id: Option<String>,
) -> Result<DeleteResult, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("路径不存在".to_string());
    }

    if is_sensitive_path(&path_buf) {
        return Err("不允许删除系统关键路径".to_string());
    }

    let is_dir = path_buf.is_dir();
    let file_name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let script = r#"
on run argv
  tell application "Finder"
    delete POSIX file (item 1 of argv)
  end tell
end run
"#;
        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg(path_buf.to_string_lossy().to_string())
            .output()
            .map_err(|e| format!("无法调用 Finder: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                "移到废纸篓失败".to_string()
            } else {
                format!("移到废纸篓失败: {}", stderr)
            })
        }
    })
    .await
    .map_err(|e| format!("移到废纸篓任务执行失败: {}", e))?;

    match result {
        Ok(()) => {
            let item_type = if is_dir { "目录" } else { "文件" };
            let message = format!("{}: {} 已移到废纸篓（清空废纸篓后不可恢复）", item_type, file_name);

            // 保持索引一致：成功废纸篓后原子移除子树。
            let updated = scan_id
                .as_deref()
                .and_then(|sid| index_manager.get(sid))
                .and_then(|shared| {
                    let mut idx = shared.write().unwrap();
                    idx.delete_subtree(&path).map(|_| idx.summary())
                });

            Ok(DeleteResult { message, updated })
        }
        Err(e) => Err(e),
    }
}

/// 在 Finder 中显示文件或目录
#[command]
pub async fn show_in_finder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("路径不存在".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let status = Command::new("open")
            .arg("-R")
            .arg(path_buf)
            .status()
            .map_err(|e| format!("无法打开 Finder: {}", e))?;

        if status.success() {
            Ok(())
        } else {
            Err("Finder 打开失败".to_string())
        }
    })
    .await
    .map_err(|e| format!("Finder 任务执行失败: {}", e))?
}

/// 检查是否为敏感路径（系统关键目录）
fn is_sensitive_path(path: &std::path::Path) -> bool {
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let path_str = path.to_string_lossy();

    if path_str == "/" {
        return true;
    }

    let system_dirs = [
        "/System", "/Library", "/bin", "/sbin", "/usr", "/etc", "/var", "/private", "/opt",
        "/net", "/home", "/cores", "/Applications", "/Volumes", "/dev", "/proc",
    ];

    for sys_dir in system_dirs {
        if path_str.starts_with(sys_dir) {
            return true;
        }
    }

    if path_str == "/Users" {
        return true;
    }

    if path_str.starts_with("/Users/") {
        let components: Vec<_> = path.components().collect();
        if components.len() <= 3 {
            return true;
        }
    }

    false
}

/// 发送扫描事件到前端
fn send_scan_event(app_handle: &AppHandle, event: ScanEvent) -> Result<(), String> {
    app_handle
        .emit("scan-event", event)
        .map_err(|e| format!("发送事件失败: {}", e))
}

/// 启动带进度跟踪的目录扫描，构建完整索引
#[command]
pub async fn scan_directory_with_progress(
    app_handle: AppHandle,
    scan_manager: State<'_, ScanManager>,
    index_manager: State<'_, ScanIndexManager>,
    options: ScanOptions,
) -> Result<String, String> {
    let scan_id = Uuid::new_v4().to_string();
    let cancel_flag = scan_manager.register_scan(scan_id.clone());

    let path = PathBuf::from(&options.path);

    if !path.exists() {
        scan_manager.remove_scan(&scan_id);
        return Err("路径不存在".to_string());
    }

    if !path.is_dir() {
        scan_manager.remove_scan(&scan_id);
        return Err("路径不是目录".to_string());
    }

    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel::<ScanEvent>();

    let app_handle_for_event = app_handle.clone();
    let scan_id_for_receiver = scan_id.clone();
    let scan_manager_for_cleanup = scan_manager.inner().clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let _ = send_scan_event(&app_handle_for_event, event);
        }
        scan_manager_for_cleanup.remove_scan(&scan_id_for_receiver);
    });

    // 超时监控任务
    let timeout_seconds = options.timeout_seconds.unwrap_or(300);
    let scan_id_for_timeout = scan_id.clone();
    let app_handle_for_timeout = app_handle.clone();
    let scan_manager_for_timeout_check = scan_manager.inner().clone();

    if timeout_seconds > 0 {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(timeout_seconds)).await;
            if !scan_manager_for_timeout_check.is_cancelled(&scan_id_for_timeout) {
                if scan_manager_for_timeout_check.cancel_scan(&scan_id_for_timeout) {
                    let _ = send_scan_event(
                        &app_handle_for_timeout,
                        ScanEvent::Timeout {
                            scan_id: scan_id_for_timeout.clone(),
                        },
                    );
                }
            }
        });
    }

    let index_manager_for_scan = index_manager.inner().clone();
    let scan_id_clone = scan_id.clone();
    let path_clone = path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let event_tx_clone = event_tx.clone();
        let result = scanner::scan_directory_with_progress(
            &path_clone,
            cancel_flag,
            scan_id_clone.clone(),
            move |event| {
                event_tx_clone
                    .send(event)
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
            },
        );

        match result {
            Ok((index, coverage)) => {
                let summary = index.summary();
                // 先入库再发 Completed，避免前端查询竞态。
                index_manager_for_scan.insert(scan_id_clone.clone(), index);
                let _ = event_tx.send(ScanEvent::Completed {
                    scan_id: scan_id_clone.clone(),
                    files_found: summary.files_scanned,
                    directories_found: summary.directories_scanned,
                    total_size_logical: summary.total_size_logical,
                    total_size_disk: summary.total_size_disk,
                    physical_unique_total: summary.physical_unique_total,
                    scan_coverage: coverage,
                    insights: summary.insights,
                });
            }
            Err(e) => {
                let error_message = e.to_string();
                if !error_message.contains("扫描被取消") {
                    let _ = event_tx.send(ScanEvent::Error {
                        scan_id: scan_id_clone.clone(),
                        message: format!("扫描失败: {}", e),
                    });
                }
            }
        }
    });

    Ok(scan_id)
}

/// 取消正在进行的扫描
#[derive(Debug, Deserialize)]
pub struct CancelScanArgs {
    #[serde(rename = "scanId", alias = "scan_id")]
    scan_id: String,
}

#[command]
pub async fn cancel_scan(
    scan_manager: State<'_, ScanManager>,
    args: CancelScanArgs,
) -> Result<bool, String> {
    Ok(scan_manager.cancel_scan(&args.scan_id))
}

// ---------------------------------------------------------------------------
// Query commands (complete index, server-side filtering)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatQueryArgs {
    pub scan_id: String,
    pub min_size: Option<u64>,
    pub modified_window: Option<String>,
    pub search_query: Option<String>,
    pub kind: Option<String>,
    #[serde(rename = "type")]
    pub type_filter: Option<String>,
    pub sort: Option<String>,
    pub sort_desc: Option<bool>,
    pub size_mode: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[command]
pub async fn query_flat_files(
    state: State<'_, ScanIndexManager>,
    args: FlatQueryArgs,
) -> Result<FlatPage, String> {
    let limit = args.limit.unwrap_or(200);
    if limit == 0 || limit > index::MAX_PAGE_SIZE {
        return Err("InvalidPagination".to_string());
    }
    let shared = state.get(&args.scan_id).ok_or("IndexNotFound")?;
    let query = FlatQuery {
        min_size: args.min_size,
        modified_window: parse_modified_window(args.modified_window.as_deref()),
        search_query: args.search_query.filter(|s| !s.trim().is_empty()),
        kind: parse_kind(args.kind.as_deref()),
        type_filter: args.type_filter.filter(|t| !t.is_empty()),
        sort: parse_sort(args.sort.as_deref()),
        sort_desc: args.sort_desc.unwrap_or(true),
        size_mode: parse_size_mode(args.size_mode.as_deref()),
        offset: args.offset.unwrap_or(0),
        limit,
    };
    let idx = shared.read().unwrap();
    Ok(idx.query_flat(&query))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeQueryArgs {
    pub scan_id: String,
    pub path: String,
    pub size_mode: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[command]
pub async fn query_subtree(
    state: State<'_, ScanIndexManager>,
    args: SubtreeQueryArgs,
) -> Result<FlatPage, String> {
    let limit = args.limit.unwrap_or(200);
    if limit == 0 || limit > index::MAX_PAGE_SIZE {
        return Err("InvalidPagination".to_string());
    }
    let shared = state.get(&args.scan_id).ok_or("IndexNotFound")?;
    let idx = shared.read().unwrap();
    Ok(idx.query_subtree(
        &args.path,
        parse_size_mode(args.size_mode.as_deref()),
        args.offset.unwrap_or(0),
        limit,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSizeArgs {
    pub scan_id: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSize {
    pub size_logical: u64,
    pub size_disk: u64,
}

#[command]
pub async fn query_dir_size(
    state: State<'_, ScanIndexManager>,
    args: DirSizeArgs,
) -> Result<Option<DirSize>, String> {
    let shared = state.get(&args.scan_id).ok_or("IndexNotFound")?;
    let idx = shared.read().unwrap();
    Ok(idx
        .query_dir_size(&args.path)
        .map(|(l, d)| DirSize {
            size_logical: l,
            size_disk: d,
        }))
}

fn parse_size_mode(s: Option<&str>) -> SizeMode {
    match s {
        Some("disk") => SizeMode::Disk,
        _ => SizeMode::Logical,
    }
}

fn parse_kind(s: Option<&str>) -> KindFilter {
    match s {
        Some("files") => KindFilter::Files,
        Some("dirs") => KindFilter::Dirs,
        _ => KindFilter::All,
    }
}

fn parse_sort(s: Option<&str>) -> SortKey {
    match s {
        Some("modified") => SortKey::Modified,
        Some("name") => SortKey::Name,
        _ => SortKey::Size,
    }
}

fn parse_modified_window(s: Option<&str>) -> ModifiedWindow {
    match s {
        Some("30d") => ModifiedWindow::Days30,
        Some("180d") => ModifiedWindow::Days180,
        Some("365d") => ModifiedWindow::Days365,
        _ => ModifiedWindow::All,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialized_contract_matches_frontend_types() {
        let event = ScanEvent::Completed {
            scan_id: "s".into(),
            files_found: 1,
            directories_found: 2,
            total_size_logical: 3,
            total_size_disk: 4,
            physical_unique_total: 5,
            scan_coverage: ScanCoverage {
                scanned_entries: 7,
                unscanned_regions: vec![crate::index::UnscannedRegion {
                    path: "/locked".into(),
                    reason: "permission-denied".into(),
                }],
                partial: true,
            },
            insights: Insights::empty(),
        };
        let obj = serde_json::to_value(&event).unwrap().as_object().unwrap().clone();
        assert_eq!(obj["type"], "completed");
        assert!(obj.contains_key("filesFound"));
        assert!(obj.contains_key("directoriesFound"));
        assert!(obj.contains_key("totalSizeLogical"));
        assert!(obj.contains_key("totalSizeDisk"));
        assert!(obj.contains_key("physicalUniqueTotal"));
        assert!(obj.contains_key("scanCoverage"));
        assert!(obj.contains_key("insights"));
        assert!(!obj.contains_key("results"), "results must be removed");
        let coverage = obj["scanCoverage"].as_object().unwrap();
        assert!(coverage.contains_key("unscannedRegions"));
        assert!(coverage.contains_key("partial"));

        let fi = FileInfo {
            path: "/x".into(),
            size_logical: 1,
            is_dir: false,
            modified: None,
            name: "x".into(),
            size_disk: 2,
            physical_unique: 3,
        };
        let fij = serde_json::to_value(&fi).unwrap();
        assert_eq!(fij["sizeLogical"], 1);
        assert_eq!(fij["sizeDisk"], 2);
        assert_eq!(fij["physicalUnique"], 3);

        let insights = Insights {
            largest_directory: None,
            largest_file: Some(crate::index::InsightPick {
                path: "/x/big.mkv".into(),
                size_logical: 10,
                size_disk: 12,
            }),
            recent_large_file: None,
            stale_large_file: None,
            top_types: vec![crate::index::TypeBucketStat {
                label: "视频".into(),
                count: 1,
                total_logical: 10,
                total_disk: 12,
                sample_path: "/x/big.mkv".into(),
            }],
        };
        let ij = serde_json::to_value(&insights).unwrap();
        assert_eq!(ij["largestFile"]["sizeLogical"], 10);
        assert_eq!(ij["largestFile"]["sizeDisk"], 12);
        assert_eq!(ij["topTypes"][0]["totalLogical"], 10);
        assert_eq!(ij["topTypes"][0]["samplePath"], "/x/big.mkv");
    }

    #[test]
    fn test_is_sensitive_path() {
        assert!(is_sensitive_path(std::path::Path::new("/")));
        assert!(is_sensitive_path(std::path::Path::new("/System")));
        assert!(is_sensitive_path(std::path::Path::new("/bin")));
        assert!(is_sensitive_path(std::path::Path::new("/usr")));
        assert!(is_sensitive_path(std::path::Path::new("/Users")));
        assert!(is_sensitive_path(std::path::Path::new("/Users/dapeng")));
        assert!(!is_sensitive_path(std::path::Path::new(
            "/Users/dapeng/Downloads"
        )));
        assert!(!is_sensitive_path(std::path::Path::new(
            "/Users/dapeng/Documents/test.txt"
        )));
    }
}

/// Command-layer tests that drive the real Tauri command functions against
/// actual managed state and a real directory scan (JSON contract included).
#[cfg(test)]
mod command_tests {
    use super::*;
    use crate::index::ScanIndexManager;
    use crate::scanner;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tauri::Manager;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mac_disk_cmd_{}_{}_{}",
                name,
                std::process::id(),
                unique
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write_file(&self, relative_path: &str, size: usize) -> PathBuf {
            let path = self.path.join(relative_path);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, vec![b'x'; size]).unwrap();
            path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn app_with_scanned_index(
        root: &Path,
    ) -> (tauri::App<tauri::test::MockRuntime>, String) {
        let cancel = Arc::new(AtomicBool::new(false));
        let (index, _coverage) = scanner::scan_directory_with_progress(
            root,
            cancel,
            "cmd-test".to_string(),
            |_| Ok(()),
        )
        .unwrap();
        let scan_id = "cmd-test".to_string();
        let manager = ScanIndexManager::new();
        manager.insert(scan_id.clone(), index);
        let app = tauri::test::mock_builder()
            .manage(manager)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        (app, scan_id)
    }

    fn block<R>(fut: impl std::future::Future<Output = R>) -> R {
        tauri::async_runtime::block_on(fut)
    }

    #[test]
    fn query_flat_files_command_filters_and_paginates() {
        let dir = TestDir::new("flat_cmd");
        dir.write_file("small.bin", 8);
        dir.write_file("big.mkv", 4000);
        dir.write_file("mid.bin", 100);
        let (app, scan_id) = app_with_scanned_index(&dir.path);

        let page = block(query_flat_files(
            app.state(),
            FlatQueryArgs {
                scan_id: scan_id.clone(),
                min_size: Some(100),
                modified_window: None,
                search_query: None,
                kind: None,
                type_filter: None,
                sort: None,
                sort_desc: None,
                size_mode: Some("logical".to_string()),
                offset: Some(0),
                limit: Some(200),
            },
        ))
        .unwrap();
        assert_eq!(page.total, 2); // big.mkv + mid.bin, small.bin filtered out
        assert!(!page.has_more);

        // Type filter across the whole index.
        let video = block(query_flat_files(
            app.state(),
            FlatQueryArgs {
                scan_id,
                min_size: None,
                modified_window: None,
                search_query: None,
                kind: Some("files".to_string()),
                type_filter: Some("视频".to_string()),
                sort: None,
                sort_desc: None,
                size_mode: Some("logical".to_string()),
                offset: Some(0),
                limit: Some(200),
            },
        ))
        .unwrap();
        assert_eq!(video.total, 1);
        assert_eq!(video.items[0].name, "big.mkv");
    }

    #[test]
    fn query_flat_files_command_rejects_invalid_pagination() {
        let dir = TestDir::new("invalid_page");
        dir.write_file("a.bin", 10);
        let (app, scan_id) = app_with_scanned_index(&dir.path);

        let err = block(query_flat_files(
            app.state(),
            FlatQueryArgs {
                scan_id,
                min_size: None,
                modified_window: None,
                search_query: None,
                kind: None,
                type_filter: None,
                sort: None,
                sort_desc: None,
                size_mode: None,
                offset: Some(0),
                limit: Some(0), // invalid: outside [1, 500]
            },
        ))
        .unwrap_err();
        assert!(err.contains("InvalidPagination"), "got: {err}");
    }

    #[test]
    fn query_flat_files_command_reports_index_not_found() {
        let dir = TestDir::new("missing_index");
        dir.write_file("a.bin", 10);
        let (app, _scan_id) = app_with_scanned_index(&dir.path);

        let err = block(query_flat_files(
            app.state(),
            FlatQueryArgs {
                scan_id: "does-not-exist".to_string(),
                min_size: None,
                modified_window: None,
                search_query: None,
                kind: None,
                type_filter: None,
                sort: None,
                sort_desc: None,
                size_mode: None,
                offset: Some(0),
                limit: Some(200),
            },
        ))
        .unwrap_err();
        assert!(err.contains("IndexNotFound"), "got: {err}");
    }

    #[test]
    fn query_subtree_and_dir_size_commands_work() {
        let dir = TestDir::new("subtree_cmd");
        dir.write_file("big.bin", 64);
        dir.write_file("nested/inside.bin", 32);
        let (app, scan_id) = app_with_scanned_index(&dir.path);

        let subtree = block(query_subtree(
            app.state(),
            SubtreeQueryArgs {
                scan_id: scan_id.clone(),
                path: dir.path.to_string_lossy().to_string(),
                size_mode: Some("logical".to_string()),
                offset: Some(0),
                limit: Some(200),
            },
        ))
        .unwrap();
        assert_eq!(subtree.total, 2);
        assert_eq!(subtree.items[0].name, "big.bin");

        let dir_size = block(query_dir_size(
            app.state(),
            DirSizeArgs {
                scan_id,
                path: dir.path.join("nested").to_string_lossy().to_string(),
            },
        ))
        .unwrap();
        assert!(dir_size.is_some());
        assert_eq!(dir_size.unwrap().size_logical, 32);

        // Unknown path -> empty page, not an error.
        let missing = block(query_subtree(
            app.state(),
            SubtreeQueryArgs {
                scan_id: "cmd-test".to_string(),
                path: "/no/such/path".to_string(),
                size_mode: None,
                offset: Some(0),
                limit: Some(200),
            },
        ))
        .unwrap();
        assert_eq!(missing.total, 0);
        assert!(missing.items.is_empty());
    }
}
