import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { getSizeValue } from "../../scanInsights";
import { formatFileSize } from "../../lib/format";
import { buildPathSegments, getParentPath, normalizePath } from "../../lib/path";
import type { FileInfo } from "../../types";
import DetailAside from "./DetailAside";
import FlatView from "./FlatView";
import MapView from "./MapView";
import PreviewView from "./PreviewView";
import type { ViewMode } from "./ResultsToolbar";
import TreeView from "./TreeView";

const RESULT_VIEW_MODE_STORAGE_KEY = "mac-disk-scanner.result-view-mode";

interface FileListProps {
  scanId: string | null;
  scanRoot: string;
  isPreview: boolean;
  previewItems: FileInfo[];
  sizeMode: "logical" | "disk";
  activeTypeFilter: string | null;
  onTypeFilterChange: (type: string | null) => void;
  onDelete: (file: FileInfo) => void;
  onShowInFinder: (file: FileInfo) => void;
  onCopyPath: (file: FileInfo) => void;
  onRescanDirectory: (file: FileInfo) => void;
  onRescanRoot: () => void;
  onDeletePaths: (files: FileInfo[]) => void;
  focusedPath?: string | null;
  listVersion: number;
}

function getStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "tree";
  const stored = window.localStorage.getItem(RESULT_VIEW_MODE_STORAGE_KEY);
  if (stored === "flat" || stored === "map") return stored;
  return "tree";
}

/**
 * Result panel container: owns the current directory/view mode and selection
 * state, renders the active view component and the details aside. Query state
 * for each view lives inside TreeView / FlatView / MapView.
 */
export default function FileList({
  scanId,
  scanRoot,
  isPreview,
  previewItems,
  sizeMode,
  activeTypeFilter,
  onTypeFilterChange,
  onDelete,
  onShowInFinder,
  onCopyPath,
  onRescanDirectory,
  onRescanRoot,
  onDeletePaths,
  focusedPath,
  listVersion,
}: FileListProps) {
  const normalizedRoot = useMemo(() => normalizePath(scanRoot), [scanRoot]);

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [viewPath, setViewPath] = useState(normalizedRoot);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Map<string, FileInfo>>(new Map());
  const [fileCache, setFileCache] = useState<Map<string, FileInfo>>(new Map());
  const [indexStale, setIndexStale] = useState(false);

  // Persist the view mode preference.
  useEffect(() => {
    window.localStorage.setItem(RESULT_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  // Reset all view state when the scan changes.
  useEffect(() => {
    setViewPath(normalizedRoot);
    setSelectedPath(null);
    setSelectedFiles(new Map());
    setFileCache(new Map());
    setIndexStale(false);
  }, [scanId, normalizedRoot, listVersion]);

  // Navigate to a focused path (from insights).
  useEffect(() => {
    if (!focusedPath || !scanId) return;
    const focused = normalizePath(focusedPath);
    const parent = getParentPath(focused);
    setViewPath(parent ?? normalizedRoot);
    setSelectedPath(focused);
  }, [focusedPath, scanId, normalizedRoot]);

  /** Merge loaded file records so the details aside can resolve any selection. */
  const cacheFiles = useCallback((files: FileInfo[]) => {
    if (files.length === 0) return;
    setFileCache((prev) => {
      let next: Map<string, FileInfo> | null = null;
      for (const f of files) {
        const key = normalizePath(f.path);
        if (prev.get(key) !== f) {
          if (!next) next = new Map(prev);
          next.set(key, f);
        }
      }
      return next ?? prev;
    });
  }, []);

  const handleSelectPath = useCallback((file: FileInfo) => {
    setSelectedPath(file.path);
    setFileCache((prev) => {
      const key = normalizePath(file.path);
      if (prev.get(key) === file) return prev;
      const next = new Map(prev);
      next.set(key, file);
      return next;
    });
  }, []);

  const selectedFile = useMemo(() => {
    if (!selectedPath) return null;
    return fileCache.get(normalizePath(selectedPath)) ?? null;
  }, [selectedPath, fileCache]);

  const handleIndexStale = useCallback(() => setIndexStale(true), []);

  const toggleSelect = useCallback((file: FileInfo) => {
    setSelectedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(file.path)) next.delete(file.path);
      else next.set(file.path, file);
      return next;
    });
  }, []);
  const selectOnly = useCallback((file: FileInfo) => {
    setSelectedFiles(new Map([[file.path, file]]));
  }, []);
  const clearSelection = useCallback(() => setSelectedFiles(new Map()), []);

  const selectedPaths = useMemo(() => new Set(selectedFiles.keys()), [selectedFiles]);
  const selectedTotal = useMemo(
    () => Array.from(selectedFiles.values()).reduce((s, f) => s + getSizeValue(f, sizeMode), 0),
    [selectedFiles, sizeMode],
  );

  const drillIntoMap = useCallback(
    (path: string) => {
      clearSelection();
      setViewPath(path);
    },
    [clearSelection],
  );

  const enterDirectory = useCallback((file: FileInfo) => {
    if (!file.is_dir) return;
    setViewPath(file.path);
  }, []);

  const goUp = useCallback(() => {
    setViewPath((current) => getParentPath(current) ?? normalizedRoot);
  }, [normalizedRoot]);

  const goRoot = useCallback(() => setViewPath(normalizedRoot), [normalizedRoot]);

  const pathSegments = useMemo(
    () => buildPathSegments(normalizedRoot, viewPath),
    [normalizedRoot, viewPath],
  );
  const canGoUp = viewPath !== normalizedRoot;
  const currentLevelLabel =
    viewMode === "flat" ? "全部结果" : viewPath === normalizedRoot ? "根目录" : viewPath;

  // ---- empty / stale states ----

  if (indexStale) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-gray-200 bg-white px-8">
        <div className="text-center">
          <div className="text-sm font-medium text-gray-900">扫描结果已失效</div>
          <div className="mt-1 text-sm text-gray-500">索引已被回收，请重新扫描以继续查看。</div>
          <button
            type="button"
            onClick={onRescanRoot}
            className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            重新扫描
          </button>
        </div>
      </div>
    );
  }

  if (!scanId && !isPreview) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-gray-200 bg-white">
        <div className="text-center">
          <FolderOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">暂无扫描结果</h3>
          <p className="text-gray-500">选择一个目录开始扫描</p>
        </div>
      </div>
    );
  }

  // ---- preview state: read-only live view from streaming events ----

  if (isPreview) {
    return (
      <PreviewView
        viewMode={viewMode}
        previewItems={previewItems}
        sizeMode={sizeMode}
        selectedPaths={selectedPaths}
        onSelect={selectOnly}
        onToggleSelect={toggleSelect}
        onDrill={drillIntoMap}
      />
    );
  }

  // ---- final: query-driven view ----

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">扫描结果</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              {pathSegments.map((segment, index) => (
                <div key={segment.path} className="flex items-center gap-2">
                  {index > 0 && <span className="text-gray-300">/</span>}
                  <button
                    type="button"
                    onClick={() => setViewPath(segment.path)}
                    className={`transition-colors ${
                      segment.path === normalizePath(viewPath)
                        ? "font-medium text-gray-900"
                        : "hover:text-blue-600"
                    }`}
                  >
                    {segment.label}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="text-right text-sm text-gray-500">
            <div>
              {viewMode === "tree"
                ? "树形视图按目录展开，逐层加载"
                : "平铺视图基于完整索引分页加载"}
            </div>
            <div className="mt-1 text-xs text-gray-400">当前层级: {currentLevelLabel}</div>
          </div>
        </div>

        {activeTypeFilter && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              当前平铺视图仅显示类型: {activeTypeFilter}
            </div>
            <button
              type="button"
              onClick={() => onTypeFilterChange(null)}
              className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
            >
              清除筛选
            </button>
          </div>
        )}

        {viewMode === "map" && selectedFiles.size > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              已选 <span className="font-semibold">{selectedFiles.size}</span> 项 ·{" "}
              <span className="font-semibold">{formatFileSize(selectedTotal)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                清除选择
              </button>
              <button
                type="button"
                onClick={() => onDeletePaths(Array.from(selectedFiles.values()))}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                移到废纸篓
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border-r border-gray-200">
          {viewMode === "tree" ? (
            <TreeView
              scanId={scanId}
              viewPath={viewPath}
              sizeMode={sizeMode}
              isPreview={isPreview}
              listVersion={listVersion}
              selectedPath={selectedPath}
              canGoUp={canGoUp}
              onSelectPath={handleSelectPath}
              onCacheFiles={cacheFiles}
              onIndexStale={handleIndexStale}
              onEnterDirectory={enterDirectory}
              onGoUp={goUp}
              onGoRoot={goRoot}
              onViewModeChange={setViewMode}
              onShowInFinder={onShowInFinder}
              onCopyPath={onCopyPath}
              onRescanDirectory={onRescanDirectory}
              onDelete={onDelete}
            />
          ) : viewMode === "flat" ? (
            <FlatView
              scanId={scanId}
              sizeMode={sizeMode}
              isPreview={isPreview}
              listVersion={listVersion}
              activeTypeFilter={activeTypeFilter}
              selectedPath={selectedPath}
              onSelectPath={handleSelectPath}
              onCacheFiles={cacheFiles}
              onIndexStale={handleIndexStale}
              onEnterDirectory={enterDirectory}
              onViewModeChange={setViewMode}
              onTypeFilterChange={onTypeFilterChange}
              onShowInFinder={onShowInFinder}
              onCopyPath={onCopyPath}
              onRescanDirectory={onRescanDirectory}
              onDelete={onDelete}
            />
          ) : (
            <MapView
              scanId={scanId}
              viewPath={viewPath}
              sizeMode={sizeMode}
              isPreview={isPreview}
              previewItems={previewItems}
              selectedPaths={selectedPaths}
              onSelect={selectOnly}
              onToggleSelect={toggleSelect}
              onDrill={drillIntoMap}
              onIndexStale={handleIndexStale}
              onViewModeChange={setViewMode}
            />
          )}
        </div>
        <DetailAside selectedFile={selectedFile} sizeMode={sizeMode} />
      </div>
    </div>
  );
}
