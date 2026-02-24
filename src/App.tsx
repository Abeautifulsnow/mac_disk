import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle,
  FolderOpen,
  HardDrive,
  Loader2,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "./components/ConfirmDialog";
import FileList from "./components/FileList";
import Scanner from "./components/Scanner";
import type { FileInfo, ScanEvent, ScanProgress } from "./types";

function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FileInfo | null>(null);
  const [currentScanId, setCurrentScanId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanStats, setScanStats] = useState<{
    filesFound: number;
    directoriesFound: number;
    totalSize: number;
  } | null>(null);
  const [terminalState, setTerminalState] = useState<"timeout" | null>(null);
  const [lastTimeoutSeconds, setLastTimeoutSeconds] = useState<number>(300);

  // 使用 ref 来跟踪最新的 currentScanId，避免闭包问题
  const currentScanIdRef = useRef<string | null>(null);
  const terminalStateRef = useRef<"timeout" | null>(null);

  // 同步 ref 和 state
  useEffect(() => {
    currentScanIdRef.current = currentScanId;
  }, [currentScanId]);
  useEffect(() => {
    terminalStateRef.current = terminalState;
  }, [terminalState]);

  // 监听扫描事件 - 使用 useRef 来获取最新的 currentScanId
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<ScanEvent>("scan-event", (event) => {
          const payload = event.payload;
          console.log("收到扫描事件:", payload.type, "scanId:", payload.scanId);

          switch (payload.type) {
            case "progress":
              console.log(
                "收到进度事件，scanId:",
                payload.scanId,
                "已处理:",
                payload.processed,
                "总数:",
                payload.totalEstimated,
              );
              setScanProgress({
                scanId: payload.scanId,
                processed: payload.processed,
                discovered: payload.discovered,
                totalEstimated: payload.totalEstimated,
                currentPath: payload.currentPath,
                phase: payload.phase,
                percentage:
                  payload.phase === "processing" && payload.totalEstimated
                    ? (payload.processed / payload.totalEstimated) * 100
                    : undefined,
              });
              break;

            case "fileFound":
              // 实时文件事件已禁用，改为在完成时一次性更新
              break;

            case "directoryFound":
              // 实时目录事件已禁用，改为在完成时一次性更新
              break;

            case "completed":
              console.log(
                "收到完成事件，scanId:",
                payload.scanId,
                "文件:",
                payload.filesFound,
                "目录:",
                payload.directoriesFound,
              );
              const resultsForStats = payload.results ?? [];
              const derivedFilesFound = resultsForStats.filter(
                (x) => !x.is_dir,
              ).length;
              const derivedDirectoriesFound = resultsForStats.filter(
                (x) => x.is_dir,
              ).length;
              const derivedTotalSize = resultsForStats
                .filter((x) => !x.is_dir)
                .reduce((s, x) => s + x.size, 0);
              setScanStats({
                filesFound: Number(
                  payload.filesFound ?? derivedFilesFound ?? 0,
                ),
                directoriesFound: Number(
                  payload.directoriesFound ?? derivedDirectoriesFound ?? 0,
                ),
                totalSize: Number(payload.totalSize ?? derivedTotalSize ?? 0),
              });
              // 一次性更新所有结果
              setFiles(payload.results);
              setLoading(false);
              setCancelPending(false);
              setCurrentScanId(null);
              setScanProgress(null);
              setTerminalState(null);
              break;

            case "cancelled":
              // 使用 ref 获取最新的 currentScanId，避免闭包问题
              const latestScanId = currentScanIdRef.current;
              console.log(
                "收到取消事件，scanId:",
                payload.scanId,
                "当前scanId:",
                latestScanId,
              );
              // 只有当事件的 scanId 匹配当前扫描时才处理
              if (payload.scanId === latestScanId || latestScanId === null) {
                if (terminalStateRef.current !== "timeout") {
                  setError(null);
                }
                setLoading(false);
                setCancelPending(false);
                setCurrentScanId(null);
                setScanProgress(null);
                setScanStats(null);
                setFiles([]);
              }
              break;

            case "timeout":
              const timeoutScanId = currentScanIdRef.current;
              console.log(
                "收到超时事件，scanId:",
                payload.scanId,
                "当前scanId:",
                timeoutScanId,
              );
              if (payload.scanId === timeoutScanId || timeoutScanId === null) {
                setError(
                  `扫描超时 (${lastTimeoutSeconds}秒)，请尝试扫描较小的目录或增加限制。`,
                );
                setLoading(false);
                setCancelPending(false);
                setCurrentScanId(null);
                setScanProgress(null);
                setTerminalState("timeout");
                setScanStats(null);
                setFiles([]);
              }
              break;

            case "error":
              console.log(
                "收到错误事件，scanId:",
                payload.scanId,
                "消息:",
                payload.message,
              );
              setError(payload.message);
              setLoading(false);
              setCancelPending(false);
              setCurrentScanId(null);
              setScanProgress(null);
              setTerminalState(null);
              setScanStats(null);
              setFiles([]);
              break;
          }
        });
      } catch (err) {
        console.error("监听扫描事件失败:", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleScan = async (
    path: string,
    limit: number,
    minSize: number,
    timeoutSeconds: number,
  ) => {
    console.log("开始扫描，路径:", path, "限制:", limit, "最小大小:", minSize);
    setLoading(true);
    setError(null);
    setCancelPending(false);
    setFiles([]); // 清空之前的结果
    setScanProgress(null);
    setScanStats(null);
    setTerminalState(null);
    setLastTimeoutSeconds(timeoutSeconds);
    try {
      // 使用新的带进度扫描命令
      const scanId = await invoke<string>("scan_directory_with_progress", {
        options: {
          path,
          limit: limit > 0 ? limit : null,
          minSize: minSize > 0 ? minSize * 1024 * 1024 : null, // 转换为字节
          timeoutSeconds: timeoutSeconds >= 0 ? timeoutSeconds : null,
        },
      });
      console.log("扫描已启动，scanId:", scanId);
      setCurrentScanId(scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动扫描失败");
      console.error("扫描错误:", err);
      setLoading(false);
      setCancelPending(false);
    }
  };

  const handleCancelScan = async () => {
    if (currentScanId && !cancelPending) {
      console.log("点击取消扫描按钮，scanId:", currentScanId);
      try {
        setCancelPending(true);
        const cancelled = await invoke<boolean>("cancel_scan", {
          scanId: currentScanId,
        });
        console.log("取消扫描结果:", cancelled);
        if (cancelled) {
          // 设置超时，如果5秒内没有收到取消事件，强制重置状态
          setTimeout(() => {
            console.log(
              "取消扫描超时，强制重置状态，当前scanId:",
              currentScanIdRef.current,
            );
            // 检查是否已经收到取消事件
            if (currentScanIdRef.current === null) {
              console.log("已收到取消事件，无需强制重置");
              return;
            }
            console.log("未收到取消事件，强制重置状态");
            setError(null);
            setCurrentScanId(null);
            setScanProgress(null);
            setLoading(false);
            setCancelPending(false);
          }, 5000);
        } else {
          setError("扫描已结束或无法取消");
          setCancelPending(false);
        }
      } catch (err) {
        console.error("取消扫描失败:", err);
        setError(
          err instanceof Error
            ? `取消扫描失败: ${err.message}`
            : "取消扫描失败",
        );
        setLoading(false);
        setCancelPending(false);
        setCurrentScanId(null);
        setScanProgress(null);
      }
    }
  };

  const handleDelete = async (file: FileInfo) => {
    setConfirmDelete(file);
  };

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;

    try {
      const result = await invoke<string>("delete_path", {
        path: confirmDelete.path,
      });
      // 先显示成功消息，再关闭确认框
      setSuccess(result);
      // 3秒后自动清除成功消息
      setTimeout(() => setSuccess(null), 3000);

      // 从列表中移除已删除的项目
      setFiles(files.filter((f) => f.path !== confirmDelete.path));
      // 最后关闭确认对话框
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      console.error("删除错误:", err);
      // 删除失败也要关闭确认对话框
      setConfirmDelete(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1000 && unitIndex < units.length - 1) {
      size /= 1000;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const displayedSize = files.reduce((sum, file) => sum + file.size, 0);
  const scannedTotalSize = scanStats?.totalSize ?? 0;
  const headerTotalSize =
    scanStats && scannedTotalSize > 0 ? scannedTotalSize : displayedSize;
  const totalItems =
    (scanStats?.filesFound ?? 0) + (scanStats?.directoriesFound ?? 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <HardDrive className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                macOS磁盘扫描工具
              </h1>
              <p className="text-gray-500 text-sm">扫描并管理磁盘空间</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-right max-w-[260px]">
            <div className="text-sm text-gray-500 leading-tight">
              总扫描大小:{" "}
              <span className="font-semibold">
                {formatFileSize(headerTotalSize)}
              </span>
            </div>
            {scanStats && (
              <div className="text-xs text-gray-400 leading-tight">
                当前列表合计: {formatFileSize(displayedSize)}
              </div>
            )}
            {scanStats && (
              <>
                <div className="text-xs text-gray-400 leading-tight">
                  文件: {scanStats.filesFound.toLocaleString()} | 目录:{" "}
                  {scanStats.directoriesFound.toLocaleString()}
                </div>
                <div className="text-xs text-gray-400 leading-tight">
                  总计: {totalItems.toLocaleString()} 个项目
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Scanner
              onScan={handleScan}
              onCancel={handleCancelScan}
              loading={loading}
              cancelPending={cancelPending}
              progress={scanProgress}
              canCancel={!!currentScanId}
            />
          </div>

          <div className="lg:col-span-2">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
                <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-red-800 text-sm">{error}</div>
              </div>
            )}

            {success && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-green-800 text-sm">{success}</div>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-600">正在扫描磁盘，请稍候...</p>
                <p className="text-sm text-gray-500 mt-2">
                  这可能需要一些时间，具体取决于目录大小
                </p>
              </div>
            ) : files.length > 0 ? (
              <FileList
                files={files}
                onDelete={handleDelete}
                formatFileSize={formatFileSize}
              />
            ) : (
              <div className="text-center py-12">
                <FolderOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  暂无扫描结果
                </h3>
                <p className="text-gray-500">选择一个目录开始扫描</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        file={confirmDelete}
        formatFileSize={formatFileSize}
      />
    </div>
  );
}

export default App;
