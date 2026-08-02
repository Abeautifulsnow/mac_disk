import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle,
  HardDrive,
  Loader2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { deletePath, deletePaths } from "./scanApi";
import ConfirmDialog from "./components/ConfirmDialog";
import FileList from "./components/FileList";
import ScanInsights from "./components/ScanInsights";
import Scanner from "./components/Scanner";
import type {
  FileInfo,
  Insights,
  ScanCoverage,
  ScanEvent,
  ScanProgress,
} from "./types";

function App() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanRoot, setScanRoot] = useState("/Users");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FileInfo | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<FileInfo[] | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanStats, setScanStats] = useState<{
    filesFound: number;
    directoriesFound: number;
    totalSizeLogical: number;
    totalSizeDisk: number;
    physicalUniqueTotal: number;
  } | null>(null);
  const [scanCoverage, setScanCoverage] = useState<ScanCoverage | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [previewItems, setPreviewItems] = useState<FileInfo[]>([]);
  const [terminalState, setTerminalState] = useState<"timeout" | null>(null);
  const [lastTimeoutSeconds, setLastTimeoutSeconds] = useState<number>(300);
  const [sizeMode, setSizeMode] = useState<"logical" | "disk">("logical");
  const [focusedResultPath, setFocusedResultPath] = useState<string | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);

  const currentScanIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const terminalStateRef = useRef<"timeout" | null>(null);
  const previewMapRef = useRef<Map<string, FileInfo>>(new Map());
  const previewFlushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    currentScanIdRef.current = scanId;
  }, [scanId]);
  useEffect(() => {
    terminalStateRef.current = terminalState;
  }, [terminalState]);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    return () => {
      if (previewFlushTimerRef.current !== null) {
        window.clearTimeout(previewFlushTimerRef.current);
        previewFlushTimerRef.current = null;
      }
    };
  }, []);

  const clearPreview = () => {
    previewMapRef.current.clear();
    if (previewFlushTimerRef.current !== null) {
      window.clearTimeout(previewFlushTimerRef.current);
      previewFlushTimerRef.current = null;
    }
    setPreviewItems([]);
  };

  const schedulePreviewFlush = () => {
    if (previewFlushTimerRef.current !== null) return;
    previewFlushTimerRef.current = window.setTimeout(() => {
      previewFlushTimerRef.current = null;
      if (!loadingRef.current) return;
      setPreviewItems(Array.from(previewMapRef.current.values()));
    }, 150);
  };

  const addPreviewItem = (item: FileInfo) => {
    previewMapRef.current.set(item.path, item);
    schedulePreviewFlush();
  };

  const isEventForActiveScan = (eventScanId: string) => {
    const activeScanId = currentScanIdRef.current;
    if (activeScanId) return eventScanId === activeScanId;
    return loadingRef.current;
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<ScanEvent>("scan-event", (event) => {
          const payload = event.payload;
          if (!isEventForActiveScan(payload.scanId)) return;

          switch (payload.type) {
            case "progress":
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
              addPreviewItem(payload.file);
              break;

            case "directoryFound":
              addPreviewItem(payload.directory);
              break;

            case "completed":
              clearPreview();
              setScanStats({
                filesFound: Number(payload.filesFound ?? 0),
                directoriesFound: Number(payload.directoriesFound ?? 0),
                totalSizeLogical: Number(payload.totalSizeLogical ?? 0),
                totalSizeDisk: Number(payload.totalSizeDisk ?? 0),
                physicalUniqueTotal: Number(payload.physicalUniqueTotal ?? 0),
              });
              setScanCoverage(payload.scanCoverage);
              setInsights(payload.insights);
              setLoading(false);
              setCancelPending(false);
              setScanId(null);
              setScanProgress(null);
              setTerminalState(null);
              setListVersion((current) => current + 1);
              break;

            case "cancelled": {
              const latestScanId = currentScanIdRef.current;
              if (payload.scanId === latestScanId || latestScanId === null) {
                if (terminalStateRef.current !== "timeout") setError(null);
                setLoading(false);
                setCancelPending(false);
                setScanId(null);
                currentScanIdRef.current = null;
                setScanProgress(null);
                setScanStats(null);
                setScanCoverage(null);
                setInsights(null);
                clearPreview();
              }
              break;
            }

            case "timeout": {
              const timeoutScanId = currentScanIdRef.current;
              if (payload.scanId === timeoutScanId || timeoutScanId === null) {
                setError(
                  `扫描超时 (${lastTimeoutSeconds}秒)，请尝试扫描较小的目录或增加超时时间。`,
                );
                setLoading(false);
                setCancelPending(false);
                setScanId(null);
                currentScanIdRef.current = null;
                setScanProgress(null);
                setTerminalState("timeout");
                setScanStats(null);
                setScanCoverage(null);
                setInsights(null);
                clearPreview();
              }
              break;
            }

            case "error":
              setError(payload.message);
              setLoading(false);
              setCancelPending(false);
              setScanId(null);
              currentScanIdRef.current = null;
              setScanProgress(null);
              setTerminalState(null);
              setScanStats(null);
              setScanCoverage(null);
              setInsights(null);
              clearPreview();
              break;
          }
        });
      } catch (err) {
        console.error("监听扫描事件失败:", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = useCallback(async (path: string, timeoutSeconds: number) => {
    setLoading(true);
    setError(null);
    setCancelPending(false);
    setScanProgress(null);
    setScanStats(null);
    setScanCoverage(null);
    setInsights(null);
    setFocusedResultPath(null);
    setActiveTypeFilter(null);
    setLastTimeoutSeconds(timeoutSeconds);
    setScanRoot(path);
    setListVersion((current) => current + 1);
    clearPreview();
    try {
      const newScanId = await invoke<string>("scan_directory_with_progress", {
        options: { path, timeoutSeconds, sizeMode },
      });
      setScanId(newScanId);
      currentScanIdRef.current = newScanId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动扫描失败");
      console.error("扫描错误:", err);
      setLoading(false);
      setCancelPending(false);
      clearPreview();
    }
  }, [sizeMode]);

  const handleCancelScan = async () => {
    const activeScanId = currentScanIdRef.current;
    if (!activeScanId || cancelPending) return;
    try {
      setCancelPending(true);
      await invoke<boolean>("cancel_scan", { scanId: activeScanId });
      setTimeout(() => {
        if (currentScanIdRef.current === null) return;
        setError(null);
        setScanId(null);
        currentScanIdRef.current = null;
        setScanProgress(null);
        setLoading(false);
        setCancelPending(false);
        clearPreview();
      }, 5000);
    } catch (err) {
      console.error("取消扫描失败:", err);
      setError(err instanceof Error ? `取消扫描失败: ${err.message}` : "取消扫描失败");
      setLoading(false);
      setCancelPending(false);
      setScanId(null);
      currentScanIdRef.current = null;
      setScanProgress(null);
      clearPreview();
    }
  };

  const handleDelete = (file: FileInfo) => {
    setConfirmDelete(file);
  };

  const handleDeletePaths = (files: FileInfo[]) => {
    setConfirmDeleteBatch(files);
  };

  const confirmDeleteBatchAction = async () => {
    if (!confirmDeleteBatch || confirmDeleteBatch.length === 0) return;
    const paths = confirmDeleteBatch.map((f) => f.path);
    try {
      const result = await deletePaths(paths, scanId);
      setSuccess(result.message);
      if (result.failedPaths.length > 0) {
        setError(`以下项目未能移入废纸篓：${result.failedPaths.join("；")}`);
      }
      setTimeout(() => setSuccess(null), 3000);
      if (result.updated) {
        setScanStats({
          filesFound: result.updated.filesScanned,
          directoriesFound: result.updated.directoriesScanned,
          totalSizeLogical: result.updated.totalSizeLogical,
          totalSizeDisk: result.updated.totalSizeDisk,
          physicalUniqueTotal: result.updated.physicalUniqueTotal,
        });
        setInsights(result.updated.insights);
      }
      setListVersion((current) => current + 1);
      setConfirmDeleteBatch(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量删除失败");
      console.error("批量删除错误:", err);
      setConfirmDeleteBatch(null);
    }
  };

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    const path = confirmDelete.path;
    try {
      const result = await deletePath(path, scanId);
      setSuccess(result.message);
      setTimeout(() => setSuccess(null), 3000);
      if (result.updated) {
        setScanStats({
          filesFound: result.updated.filesScanned,
          directoriesFound: result.updated.directoriesScanned,
          totalSizeLogical: result.updated.totalSizeLogical,
          totalSizeDisk: result.updated.totalSizeDisk,
          physicalUniqueTotal: result.updated.physicalUniqueTotal,
        });
        setInsights(result.updated.insights);
      }
      setFocusedResultPath((current) => (current === path ? null : current));
      // Force the list to reload from the backend so removed items don't reappear.
      setListVersion((current) => current + 1);
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      console.error("删除错误:", err);
      setConfirmDelete(null);
    }
  };

  const handleShowInFinder = async (file: FileInfo) => {
    try {
      await invoke("show_in_finder", { path: file.path });
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法在 Finder 中显示");
    }
  };

  const handleCopyPath = async (file: FileInfo) => {
    try {
      await navigator.clipboard.writeText(file.path);
      setSuccess("路径已复制");
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制路径失败");
    }
  };

  const handleRescanDirectory = (file: FileInfo) => {
    if (!file.is_dir) return;
    void handleScan(file.path, lastTimeoutSeconds);
  };

  const handleRescanRoot = () => {
    void handleScan(scanRoot, lastTimeoutSeconds);
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

  const headerTotalSize =
    scanStats && (sizeMode === "disk" ? scanStats.totalSizeDisk : scanStats.totalSizeLogical);
  const isPreviewResults = loading && previewItems.length > 0;

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
            {scanStats ? (
              <>
                <div className="text-sm text-gray-500 leading-tight">
                  已扫描总大小:{" "}
                  <span className="font-semibold">{formatFileSize(headerTotalSize ?? 0)}</span>
                </div>
                <div className="text-xs text-gray-400 leading-tight">
                  统计口径: {sizeMode === "disk" ? "磁盘使用量" : "逻辑大小"}
                </div>
                <div className="text-xs text-gray-400 leading-tight">
                  文件 {scanStats.filesFound.toLocaleString()} | 目录{" "}
                  {scanStats.directoriesFound.toLocaleString()}
                </div>
                {scanCoverage?.partial && (
                  <div className="flex items-center gap-1 text-xs text-amber-700 leading-tight font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    部分扫描完成（{scanCoverage.unscannedRegions.length} 个区域不可访问）
                  </div>
                )}
              </>
            ) : isPreviewResults ? (
              <>
                <div className="text-sm text-amber-700 leading-tight font-medium">
                  扫描中预览: {previewItems.length.toLocaleString()} 个项目
                </div>
                <div className="text-xs text-amber-600 leading-tight">
                  列表仍在变化，完成后切换为完整结果
                </div>
              </>
            ) : (
              <div className="text-xs text-gray-400 leading-tight">等待扫描</div>
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
              canCancel={!!currentScanIdRef.current}
              sizeMode={sizeMode}
              onSizeModeChange={setSizeMode}
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

            {scanCoverage?.partial && scanStats && !loading && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-amber-800 text-sm">
                    <div className="font-medium">部分扫描完成</div>
                    <div className="mt-1">
                      {scanCoverage.unscannedRegions.length} 个区域因权限或 I/O 错误未完整扫描，
                      统计与洞察仅覆盖可访问的部分。
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-amber-700 hover:text-amber-900">
                        查看不可访问区域
                      </summary>
                      <ul className="mt-2 max-h-40 overflow-auto space-y-1 font-mono text-xs">
                        {scanCoverage.unscannedRegions.map((region) => (
                          <li key={region.path} className="truncate">
                            {region.path} <span className="text-amber-600">[{region.reason}]</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                </div>
              </div>
            )}

            {insights && scanStats && !loading && (
              <ScanInsights
                insights={insights}
                sizeMode={sizeMode}
                formatFileSize={formatFileSize}
                onFocusPath={setFocusedResultPath}
                activeTypeFilter={activeTypeFilter}
                onTypeFilterChange={setActiveTypeFilter}
              />
            )}

            {loading && previewItems.length === 0 && !scanStats ? (
              <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl border border-gray-200">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-600">正在扫描磁盘，请稍候...</p>
                <p className="text-sm text-gray-500 mt-2">
                  这会保留全部文件记录，可能需要一些时间
                </p>
              </div>
            ) : (
              <FileList
                scanId={scanId}
                scanRoot={scanRoot}
                isPreview={isPreviewResults}
                previewItems={previewItems}
                sizeMode={sizeMode}
                activeTypeFilter={activeTypeFilter}
                onTypeFilterChange={setActiveTypeFilter}
                onDelete={handleDelete}
                onShowInFinder={handleShowInFinder}
                onCopyPath={handleCopyPath}
                onRescanDirectory={handleRescanDirectory}
                onRescanRoot={handleRescanRoot}
                onDeletePaths={handleDeletePaths}
                formatFileSize={formatFileSize}
                focusedPath={focusedResultPath}
                listVersion={listVersion}
              />
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        isOpen={!!confirmDelete || !!confirmDeleteBatch}
        onClose={() => {
          setConfirmDelete(null);
          setConfirmDeleteBatch(null);
        }}
        onConfirm={
          confirmDeleteBatch && confirmDeleteBatch.length > 0
            ? confirmDeleteBatchAction
            : confirmDeleteAction
        }
        file={confirmDelete}
        batchFiles={confirmDeleteBatch}
        formatFileSize={formatFileSize}
        sizeMode={sizeMode}
      />
    </div>
  );
}

export default App;
