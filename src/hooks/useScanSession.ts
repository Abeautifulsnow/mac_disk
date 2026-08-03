import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { deletePath, deletePaths } from "../scanApi";
import type {
  FileInfo,
  IndexSummary,
  Insights,
  ScanCoverage,
  ScanEvent,
  ScanProgress,
} from "../types";

export type SizeMode = "logical" | "disk";

export interface ScanStats {
  filesFound: number;
  directoriesFound: number;
  totalSizeLogical: number;
  totalSizeDisk: number;
  physicalUniqueTotal: number;
}

function statsFromSummary(updated: IndexSummary): ScanStats {
  return {
    filesFound: updated.filesScanned,
    directoriesFound: updated.directoriesScanned,
    totalSizeLogical: updated.totalSizeLogical,
    totalSizeDisk: updated.totalSizeDisk,
    physicalUniqueTotal: updated.physicalUniqueTotal,
  };
}

/**
 * Owns the full scan lifecycle: starting/cancelling a scan, the streaming
 * `scan-event` listener (progress / live preview / completion / failure),
 * delete operations that keep the index consistent, and the transient
 * success/error feedback. Returns a single object the view layer renders.
 */
export function useScanSession() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanRoot, setScanRoot] = useState("/Users");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FileInfo | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<FileInfo[] | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanStats, setScanStats] = useState<ScanStats | null>(null);
  const [scanCoverage, setScanCoverage] = useState<ScanCoverage | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [previewItems, setPreviewItems] = useState<FileInfo[]>([]);
  const [terminalState, setTerminalState] = useState<"timeout" | null>(null);
  const [lastTimeoutSeconds, setLastTimeoutSeconds] = useState<number>(300);
  const [sizeMode, setSizeMode] = useState<SizeMode>("logical");
  const [focusedResultPath, setFocusedResultPath] = useState<string | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);

  const currentScanIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const terminalStateRef = useRef<"timeout" | null>(null);
  const lastTimeoutSecondsRef = useRef(300);
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
    lastTimeoutSecondsRef.current = lastTimeoutSeconds;
  }, [lastTimeoutSeconds]);

  useEffect(() => {
    return () => {
      if (previewFlushTimerRef.current !== null) {
        window.clearTimeout(previewFlushTimerRef.current);
        previewFlushTimerRef.current = null;
      }
    };
  }, []);

  const clearPreview = useCallback(() => {
    previewMapRef.current.clear();
    if (previewFlushTimerRef.current !== null) {
      window.clearTimeout(previewFlushTimerRef.current);
      previewFlushTimerRef.current = null;
    }
    setPreviewItems([]);
  }, []);

  const schedulePreviewFlush = useCallback(() => {
    if (previewFlushTimerRef.current !== null) return;
    previewFlushTimerRef.current = window.setTimeout(() => {
      previewFlushTimerRef.current = null;
      if (!loadingRef.current) return;
      setPreviewItems(Array.from(previewMapRef.current.values()));
    }, 150);
  }, []);

  const addPreviewItem = useCallback(
    (item: FileInfo) => {
      previewMapRef.current.set(item.path, item);
      schedulePreviewFlush();
    },
    [schedulePreviewFlush],
  );

  const isEventForActiveScan = useCallback((eventScanId: string) => {
    const activeScanId = currentScanIdRef.current;
    if (activeScanId) return eventScanId === activeScanId;
    return loadingRef.current;
  }, []);

  /** Clear the shared "scan is over" result state. */
  const resetScanResults = useCallback(() => {
    setScanProgress(null);
    setScanStats(null);
    setScanCoverage(null);
    setInsights(null);
    clearPreview();
  }, [clearPreview]);

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
                resetScanResults();
              }
              break;
            }

            case "timeout": {
              const timeoutScanId = currentScanIdRef.current;
              if (payload.scanId === timeoutScanId || timeoutScanId === null) {
                setError(
                  `扫描超时 (${lastTimeoutSecondsRef.current}秒)，请尝试扫描较小的目录或增加超时时间。`,
                );
                setLoading(false);
                setCancelPending(false);
                setScanId(null);
                currentScanIdRef.current = null;
                setTerminalState("timeout");
                resetScanResults();
              }
              break;
            }

            case "error":
              setError(payload.message);
              setLoading(false);
              setCancelPending(false);
              setScanId(null);
              currentScanIdRef.current = null;
              setTerminalState(null);
              resetScanResults();
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

  const handleScan = useCallback(
    async (path: string, timeoutSeconds: number) => {
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
    },
    [sizeMode, clearPreview],
  );

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

  /** Shared post-delete bookkeeping: refresh totals/insights and force the list to reload. */
  const applyDeleteResult = useCallback((updated: IndexSummary | null) => {
    if (updated) {
      setScanStats(statsFromSummary(updated));
      setInsights(updated.insights);
    }
    setListVersion((current) => current + 1);
  }, []);

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
      applyDeleteResult(result.updated);
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
      applyDeleteResult(result.updated);
      setFocusedResultPath((current) => (current === path ? null : current));
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
    void handleScan(file.path, lastTimeoutSecondsRef.current);
  };

  const handleRescanRoot = () => {
    void handleScan(scanRoot, lastTimeoutSecondsRef.current);
  };

  return {
    scanId,
    scanRoot,
    loading,
    error,
    success,
    cancelPending,
    confirmDelete,
    confirmDeleteBatch,
    scanProgress,
    scanStats,
    scanCoverage,
    insights,
    previewItems,
    sizeMode,
    setSizeMode,
    focusedResultPath,
    setFocusedResultPath,
    activeTypeFilter,
    setActiveTypeFilter,
    listVersion,
    currentScanId: currentScanIdRef.current,
    setConfirmDelete,
    setConfirmDeleteBatch,
    handleScan,
    handleCancelScan,
    confirmDeleteAction,
    confirmDeleteBatchAction,
    handleShowInFinder,
    handleCopyPath,
    handleRescanDirectory,
    handleRescanRoot,
  };
}
