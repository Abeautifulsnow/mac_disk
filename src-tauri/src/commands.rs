use crate::scanner;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
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
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<u64>, // 时间戳
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub path: String,
    pub limit: Option<usize>,  // 限制返回的项目数量
    pub min_size: Option<u64>, // 最小文件大小（字节）
    pub timeout_seconds: Option<u64>,
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
        #[serde(rename = "totalSize")]
        total_size: u64,
        // 新增字段
        results: Vec<FileInfo>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scan_id: String,
    pub processed: usize,
    pub total_estimated: Option<usize>,
    pub current_path: String,
    pub percentage: Option<f32>,
}

/// 全局扫描状态管理器
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
            true // 如果扫描不存在，认为已取消
        }
    }
}

/// 扫描目录并返回占用空间大的文件和目录
#[command]
pub async fn scan_directory(options: ScanOptions) -> Result<Vec<FileInfo>, String> {
    let path = PathBuf::from(&options.path);

    if !path.exists() {
        return Err("路径不存在".to_string());
    }

    if !path.is_dir() {
        return Err("路径不是目录".to_string());
    }

    // 调用扫描逻辑
    let items = scanner::scan_directory(&path, options.limit, options.min_size)
        .map_err(|e| format!("扫描失败: {}", e))?;

    Ok(items)
}

/// 并行扫描目录（性能优化版）
/// 注意：此版本不发送增量结果，只在完成后返回所有结果
#[command]
pub async fn scan_directory_parallel(options: ScanOptions) -> Result<Vec<FileInfo>, String> {
    let path = PathBuf::from(&options.path);

    if !path.exists() {
        return Err("路径不存在".to_string());
    }

    if !path.is_dir() {
        return Err("路径不是目录".to_string());
    }

    // 调用并行扫描逻辑
    let items = scanner::scan_directory_parallel(&path, options.limit, options.min_size)
        .map_err(|e| format!("并行扫描失败: {}", e))?;

    Ok(items)
}

/// 删除文件或目录（需要前端二次确认）
#[command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("路径不存在".to_string());
    }

    // 安全检查：防止删除系统关键目录
    if is_sensitive_path(&path_buf) {
        return Err("不允许删除系统关键路径".to_string());
    }

    // 删除操作
    if path_buf.is_dir() {
        std::fs::remove_dir_all(&path_buf).map_err(|e| format!("删除目录失败: {}", e))?;
    } else {
        std::fs::remove_file(&path_buf).map_err(|e| format!("删除文件失败: {}", e))?;
    }

    Ok(())
}

/// 检查是否为敏感路径（系统关键目录）
fn is_sensitive_path(path: &PathBuf) -> bool {
    // 尝试获取规范化路径以处理符号链接等
    let path = std::fs::canonicalize(path).unwrap_or(path.clone());
    let path_str = path.to_string_lossy();

    // 根目录
    if path_str == "/" {
        return true;
    }

    // 系统目录列表（完全禁止修改）
    let system_dirs = [
        "/System",
        "/Library",
        "/bin",
        "/sbin",
        "/usr",
        "/etc",
        "/var",
        "/private",
        "/opt",
        "/net",
        "/home",
        "/cores",
        "/Applications",
        "/Volumes", // 外部挂载点根目录通常不建议直接删除
        "/dev",
        "/proc",
    ];

    for sys_dir in system_dirs {
        if path_str.starts_with(sys_dir) {
            // 特例：/var/folders 是临时文件，可能允许删除，但为了安全起见默认禁止
            // 如果需要允许，可以添加例外逻辑
            return true;
        }
    }

    // 检查 /Users 及其直接子目录（用户主目录）
    if path_str == "/Users" {
        return true;
    }

    if path_str.starts_with("/Users/") {
        let components: Vec<_> = path.components().collect();
        // /Users/username 是 3 个组件 (RootDir, Normal("Users"), Normal("username"))
        // 我们保护用户主目录本身，但允许删除其内容
        if components.len() <= 3 {
            return true;
        }
    }

    false
}

/// 发送扫描事件到前端
fn send_scan_event(app_handle: &AppHandle, event: ScanEvent) -> Result<(), String> {
    tracing::info!("发送扫描事件到前端: {:?}", event);
    app_handle
        .emit("scan-event", event)
        .map_err(|e| format!("发送事件失败: {}", e))
}

/// 启动带进度跟踪的目录扫描
#[command]
pub async fn scan_directory_with_progress(
    app_handle: AppHandle,
    scan_manager: State<'_, ScanManager>,
    options: ScanOptions,
) -> Result<String, String> {
    let scan_id = Uuid::new_v4().to_string();
    tracing::info!("[{}] 开始扫描，路径: {}", scan_id, options.path);
    let cancel_flag = scan_manager.register_scan(scan_id.clone());
    tracing::info!("[{}] 扫描已注册到管理器", scan_id);

    let path = PathBuf::from(&options.path);

    if !path.exists() {
        scan_manager.remove_scan(&scan_id);
        return Err("路径不存在".to_string());
    }

    if !path.is_dir() {
        scan_manager.remove_scan(&scan_id);
        return Err("路径不是目录".to_string());
    }

    // 在后台线程执行扫描，避免阻塞命令响应
    let scan_id_clone = scan_id.clone();
    let path_clone = path.clone();
    let limit = options.limit;
    let min_size = options.min_size;

    // 创建通道用于从阻塞线程发送事件到异步任务
    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel::<ScanEvent>();

    // 后台任务：接收事件并通过Tauri发送到前端
    let app_handle_for_event = app_handle.clone();
    let scan_id_for_receiver = scan_id.clone();

    // 克隆 ScanManager 用于超时处理和清理
    let scan_manager_for_timeout = scan_manager.inner().clone();
    let scan_manager_for_cleanup = scan_manager.inner().clone();

    tauri::async_runtime::spawn(async move {
        tracing::info!("[{}] 事件接收任务启动", scan_id_for_receiver);
        while let Some(event) = event_rx.recv().await {
            tracing::info!(
                "[{}] 收到事件，准备发送到前端: {:?}",
                scan_id_for_receiver,
                event
            );
            let _ = send_scan_event(&app_handle_for_event, event);
        }
        tracing::info!("[{}] 事件接收任务结束，通道已关闭", scan_id_for_receiver);
        // 通道关闭后，从管理器中移除扫描
        scan_manager_for_cleanup.remove_scan(&scan_id_for_receiver);
        tracing::info!("[{}] 已从管理器移除扫描", scan_id_for_receiver);
    });

    // 超时监控任务
    let timeout_seconds = options.timeout_seconds.unwrap_or(300);
    let scan_id_for_timeout = scan_id.clone();
    let app_handle_for_timeout = app_handle.clone();
    let scan_manager_for_timeout_check = scan_manager.inner().clone();

    if timeout_seconds > 0 {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(timeout_seconds)).await;

            // 检查扫描是否仍在进行
            if !scan_manager_for_timeout_check.is_cancelled(&scan_id_for_timeout) {
                if scan_manager_for_timeout.cancel_scan(&scan_id_for_timeout) {
                    tracing::warn!("[{}] 扫描超时，强制取消", scan_id_for_timeout);
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

    // 在阻塞线程中执行扫描
    tauri::async_runtime::spawn_blocking(move || {
        let event_tx_clone = event_tx.clone();
        let scan_id_for_closure = scan_id_clone.clone();
        tracing::info!("[{}] 开始执行扫描任务", scan_id_clone);
        let result = scanner::scan_directory_with_progress(
            &path_clone,
            limit,
            min_size,
            cancel_flag,
            scan_id_clone.clone(),
            move |event| {
                // 通过通道发送事件
                tracing::debug!("[{}] 通过回调发送事件: {:?}", scan_id_for_closure, event);
                event_tx_clone
                    .send(event)
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
            },
        );

        // 扫描完成后，通过通道发送最终事件（如果有）
        match result {
            Ok((_files, _directories, _total_size)) => {}
            Err(e) => {
                // 检查是否是取消错误
                let error_message = e.to_string();
                if error_message.contains("扫描被取消") {
                    tracing::info!("[{}] 检测到取消错误", scan_id_clone);
                } else {
                    tracing::info!("[{}] 扫描出错，发送错误事件: {}", scan_id_clone, e);
                    let _ = event_tx.send(ScanEvent::Error {
                        scan_id: scan_id_clone.clone(),
                        message: format!("扫描失败: {}", e),
                    });
                }
            }
        }
        tracing::info!("[{}] 扫描任务结束，丢弃 event_tx", scan_id_clone);
        // event_tx 在这里被丢弃，导致通道关闭
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
    let scan_id = args.scan_id;
    tracing::info!("收到取消扫描请求，scan_id: {}", scan_id);
    let result = scan_manager.cancel_scan(&scan_id);
    tracing::info!("取消扫描结果: {}", result);

    // 如果取消成功，发送取消事件到前端
    if result {
        tracing::info!("准备发送取消事件到前端，scan_id: {}", scan_id);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_is_sensitive_path() {
        // 由于测试环境可能无法解析某些路径的 canonicalize，我们模拟一些情况
        // 注意：canonicalize 需要路径真实存在。
        // 对于不存在的路径，unwrap_or 会返回原路径。
        // 所以我们测试一些“假定存在”的路径或真实存在的路径。

        // 根目录
        assert!(is_sensitive_path(&PathBuf::from("/")));

        // 系统目录 (假设这些路径在 macOS 上存在，或者如果不存在，逻辑也会基于字符串前缀判断)
        // 注意：如果路径不存在，canonicalize 失败，使用原路径，逻辑仍然有效。
        assert!(is_sensitive_path(&PathBuf::from("/System")));
        assert!(is_sensitive_path(&PathBuf::from("/bin")));
        assert!(is_sensitive_path(&PathBuf::from("/usr")));

        // 用户目录保护
        assert!(is_sensitive_path(&PathBuf::from("/Users")));
        // 注意：在 CI/CD 环境中可能没有 /Users/dapeng，所以这可能会 fail 如果 canonicalize 失败但我们逻辑依赖它？
        // 我们的逻辑是：先 canonicalize，如果失败用原路径。
        // 然后检查字符串。
        // 所以只要字符串匹配，就应该返回 true。
        assert!(is_sensitive_path(&PathBuf::from("/Users/dapeng")));

        // 用户文件（应该允许）
        // 这里有一个微妙之处：如果 /Users/dapeng 不存在，那么 /Users/dapeng/Downloads 也不存在。
        // canonicalize 会失败。
        // path_str 保持原样。
        // starts_with("/Users/") -> true.
        // components.len(): /, Users, dapeng, Downloads -> 4.
        // <= 3 -> false.
        // return false. -> 允许删除。
        assert!(!is_sensitive_path(&PathBuf::from(
            "/Users/dapeng/Downloads"
        )));
        assert!(!is_sensitive_path(&PathBuf::from(
            "/Users/dapeng/Documents/test.txt"
        )));
    }
}
