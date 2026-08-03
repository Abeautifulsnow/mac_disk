import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, File, Folder, Loader2, Search, X } from "lucide-react";
import { queryFlatFiles } from "../../scanApi";
import { getSizeValue, type SizeMode } from "../../scanInsights";
import { formatDate, formatFileSize } from "../../lib/format";
import { normalizePath } from "../../lib/path";
import type { FileInfo, FlatModifiedWindow, FlatSortMode } from "../../types";
import { useListKeyboardNav } from "../../hooks/useListKeyboardNav";
import ResultsToolbar, { type ViewMode } from "./ResultsToolbar";
import RowActions from "./RowActions";
import TypeBadge from "./TypeBadge";

const PAGE_SIZE = 200;
const MAX_BAR_WIDTH = 100;
const FLAT_ROW_HEIGHT = 76;
const FLAT_OVERSCAN = 8;
const LIST_PANEL_HEIGHT = "calc(100vh - 320px)";
const LIST_PANEL_MIN_HEIGHT = 420;

const SIZE_100_MB = 100 * 1024 * 1024;
const SIZE_1_GB = 1024 * 1024 * 1024;
const SIZE_10_GB = 10 * 1024 * 1024 * 1024;

const FLAT_SORT_MODE_STORAGE_KEY = "mac-disk-scanner.flat-sort-mode";
const FLAT_SIZE_FILTER_STORAGE_KEY = "mac-disk-scanner.flat-size-filter";
const FLAT_MODIFIED_FILTER_STORAGE_KEY = "mac-disk-scanner.flat-modified-filter";

type FlatSizeFilter = "all" | "100mb" | "1gb" | "10gb";
type FlatModifiedFilter = "all" | "30d" | "180d" | "365d";

function getStoredFlatSortMode(): FlatSortMode {
  if (typeof window === "undefined") return "size";
  const stored = window.localStorage.getItem(FLAT_SORT_MODE_STORAGE_KEY);
  if (stored === "modified" || stored === "name") return stored;
  return "size";
}

function getStoredFlatSizeFilter(): FlatSizeFilter {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(FLAT_SIZE_FILTER_STORAGE_KEY);
  if (stored === "100mb" || stored === "1gb" || stored === "10gb") return stored;
  return "all";
}

function getStoredFlatModifiedFilter(): FlatModifiedFilter {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(FLAT_MODIFIED_FILTER_STORAGE_KEY);
  if (stored === "30d" || stored === "180d" || stored === "365d") return stored;
  return "all";
}

function sizeFilterToMinSize(filter: FlatSizeFilter): number | null {
  if (filter === "100mb") return SIZE_100_MB;
  if (filter === "1gb") return SIZE_1_GB;
  if (filter === "10gb") return SIZE_10_GB;
  return null;
}

function modifiedFilterToWindow(filter: FlatModifiedFilter): FlatModifiedWindow {
  return filter;
}

interface FlatViewProps {
  scanId: string | null;
  sizeMode: SizeMode;
  isPreview: boolean;
  listVersion: number;
  activeTypeFilter: string | null;
  selectedPath: string | null;
  onSelectPath: (file: FileInfo) => void;
  onCacheFiles: (files: FileInfo[]) => void;
  onIndexStale: () => void;
  onEnterDirectory: (file: FileInfo) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onTypeFilterChange: (type: string | null) => void;
  onShowInFinder: (file: FileInfo) => void;
  onCopyPath: (file: FileInfo) => void;
  onRescanDirectory: (file: FileInfo) => void;
  onDelete: (file: FileInfo) => void;
}

interface FlatRow {
  file: FileInfo;
  hasChildren: boolean;
}

function isIndexNotFoundError(err: unknown): boolean {
  return String(err).includes("IndexNotFound");
}

/** Flat result list: server-side filters/sort/search + virtualized pagination. */
export default function FlatView({
  scanId,
  sizeMode,
  isPreview,
  listVersion,
  activeTypeFilter,
  selectedPath,
  onSelectPath,
  onCacheFiles,
  onIndexStale,
  onEnterDirectory,
  onViewModeChange,
  onTypeFilterChange,
  onShowInFinder,
  onCopyPath,
  onRescanDirectory,
  onDelete,
}: FlatViewProps) {
  const [flatSizeFilter, setFlatSizeFilter] = useState<FlatSizeFilter>(getStoredFlatSizeFilter);
  const [flatModifiedFilter, setFlatModifiedFilter] = useState<FlatModifiedFilter>(getStoredFlatModifiedFilter);
  const [flatSortMode, setFlatSortMode] = useState<FlatSortMode>(getStoredFlatSortMode);
  const [flatSearchQuery, setFlatSearchQuery] = useState("");
  const [flatItems, setFlatItems] = useState<FileInfo[]>([]);
  const [flatTotal, setFlatTotal] = useState(0);
  const [flatHasMore, setFlatHasMore] = useState(false);
  const [flatLoading, setFlatLoading] = useState(false);
  const [flatScrollTop, setFlatScrollTop] = useState(0);
  const [flatViewportHeight, setFlatViewportHeight] = useState(LIST_PANEL_MIN_HEIGHT);
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);

  const flatContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedRowRef = useRef<HTMLElement | null>(null);

  // Persist filter preferences.
  useEffect(() => {
    window.localStorage.setItem(FLAT_SORT_MODE_STORAGE_KEY, flatSortMode);
  }, [flatSortMode]);
  useEffect(() => {
    window.localStorage.setItem(FLAT_SIZE_FILTER_STORAGE_KEY, flatSizeFilter);
  }, [flatSizeFilter]);
  useEffect(() => {
    window.localStorage.setItem(FLAT_MODIFIED_FILTER_STORAGE_KEY, flatModifiedFilter);
  }, [flatModifiedFilter]);

  // Reset results when the scan changes.
  useEffect(() => {
    setFlatItems([]);
    setFlatTotal(0);
    setFlatHasMore(false);
  }, [scanId, listVersion]);

  const loadFlatPage = useCallback(
    async (offset: number) => {
      if (!scanId) return;
      setFlatLoading(true);
      try {
        const page = await queryFlatFiles({
          scanId,
          minSize: sizeFilterToMinSize(flatSizeFilter),
          modifiedWindow: modifiedFilterToWindow(flatModifiedFilter),
          searchQuery: flatSearchQuery.trim() || undefined,
          type: activeTypeFilter,
          sort: flatSortMode,
          sortDesc: flatSortMode !== "name",
          sizeMode,
          offset,
          limit: PAGE_SIZE,
        });
        setFlatItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setFlatTotal(page.total);
        setFlatHasMore(page.hasMore);
        onCacheFiles(page.items);
      } catch (err) {
        if (isIndexNotFoundError(err)) onIndexStale();
      } finally {
        setFlatLoading(false);
      }
    },
    [scanId, flatSizeFilter, flatModifiedFilter, flatSearchQuery, activeTypeFilter, flatSortMode, sizeMode, onCacheFiles, onIndexStale],
  );

  // (Re)load the first page when the scan, filters, sort, or size mode change.
  useEffect(() => {
    if (!scanId || isPreview) return;
    void loadFlatPage(0);
  }, [scanId, flatSizeFilter, flatModifiedFilter, flatSortMode, flatSearchQuery, activeTypeFilter, sizeMode, isPreview, listVersion, loadFlatPage]);

  // Measure the flat viewport for virtualization.
  useEffect(() => {
    const measure = () => {
      const nextHeight = flatContainerRef.current?.clientHeight;
      if (!nextHeight) return;
      setFlatViewportHeight(nextHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const flatTotalSize = useMemo(
    () => flatItems.reduce((sum, file) => sum + getSizeValue(file, sizeMode), 0),
    [flatItems, sizeMode],
  );

  const flatRows = useMemo<FlatRow[]>(
    () => flatItems.map((file) => ({ file, hasChildren: file.is_dir })),
    [flatItems],
  );

  const handleSelectPath = (file: FileInfo) => {
    setOpenMenuPath(null);
    onSelectPath(file);
    flatContainerRef.current?.focus();
  };

  // Scroll the selected row into view.
  useEffect(() => {
    if (!selectedPath || !selectedRowRef.current) return;
    selectedRowRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedPath, flatItems.length]);

  const keyboardHandler = useListKeyboardNav<FlatRow>({
    items: flatRows,
    selectedPath,
    isPreview,
    onSelectPath: handleSelectPath,
    onEnterDirectory,
    onOpen: onShowInFinder,
    onDelete,
    onToggleMenu: (file) => setOpenMenuPath((open) => (open === file.path ? null : file.path)),
    onArrowRight: (current) => onEnterDirectory(current.file),
  });

  const flatStartIndex = Math.max(
    0,
    Math.floor(flatScrollTop / FLAT_ROW_HEIGHT) - FLAT_OVERSCAN,
  );
  const flatEndIndex = Math.min(
    flatItems.length,
    Math.ceil((flatScrollTop + flatViewportHeight) / FLAT_ROW_HEIGHT) + FLAT_OVERSCAN,
  );
  const visibleFlatItems = flatItems.slice(flatStartIndex, flatEndIndex);
  const flatOffsetTop = flatStartIndex * FLAT_ROW_HEIGHT;
  const flatTotalHeight = flatItems.length * FLAT_ROW_HEIGHT;

  const hasActiveFlatFilters =
    flatSizeFilter !== "all" ||
    flatModifiedFilter !== "all" ||
    flatSearchQuery.trim().length > 0 ||
    !!activeTypeFilter;

  const clearAllFilters = () => {
    setFlatSearchQuery("");
    setFlatSizeFilter("all");
    setFlatModifiedFilter("all");
    onTypeFilterChange(null);
  };

  return (
    <div>
      <ResultsToolbar
        viewMode="flat"
        onViewModeChange={onViewModeChange}
        meta={
          <>
            共 {flatTotal.toLocaleString()} 项 · 已加载 {flatItems.length.toLocaleString()} 项
          </>
        }
      />

      <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
              <input
                type="text"
                value={flatSearchQuery}
                onChange={(event) => setFlatSearchQuery(event.target.value)}
                placeholder="搜索名称或路径（完整索引）"
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
              {flatSearchQuery && (
                <button
                  type="button"
                  onClick={() => setFlatSearchQuery("")}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="清空搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setFlatSortMode("size")}
                className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSortMode === "size" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
              >
                按大小
              </button>
              <button
                type="button"
                onClick={() => setFlatSortMode("modified")}
                className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSortMode === "modified" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
              >
                按时间
              </button>
              <button
                type="button"
                onClick={() => setFlatSortMode("name")}
                className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSortMode === "name" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
              >
                按名称
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-500">{flatTotal.toLocaleString()} 项</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
            {(["all", "100mb", "1gb", "10gb"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFlatSizeFilter(key)}
                className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSizeFilter === key ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {key === "all" ? "全部体积" : `≥ ${key === "100mb" ? "100 MB" : key === "1gb" ? "1 GB" : "10 GB"}`}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
            {(["all", "30d", "180d", "365d"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFlatModifiedFilter(key)}
                className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatModifiedFilter === key ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {key === "all" ? "全部时间" : key === "30d" ? "近 30 天" : key === "180d" ? "近半年" : "近 1 年"}
              </button>
            ))}
          </div>
          {hasActiveFlatFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              清空筛选
            </button>
          )}
        </div>
      </div>

      <div
        ref={flatContainerRef}
        tabIndex={0}
        className="overflow-auto bg-white"
        onKeyDown={keyboardHandler}
        style={{ height: LIST_PANEL_HEIGHT, minHeight: `${LIST_PANEL_MIN_HEIGHT}px` }}
        onScroll={(event) => setFlatScrollTop(event.currentTarget.scrollTop)}
      >
        {flatItems.length === 0 && !flatLoading ? (
          <div className="flex h-full min-h-[360px] items-center justify-center px-8">
            <div className="text-center">
              <div className="text-sm font-medium text-gray-900">
                {hasActiveFlatFilters ? "没有匹配当前筛选条件的结果" : "当前没有可展示项"}
              </div>
              <div className="mt-1 text-sm text-gray-500">放宽筛选条件后再试</div>
            </div>
          </div>
        ) : (
          <div style={{ height: `${flatTotalHeight}px`, position: "relative" }}>
            <div style={{ transform: `translateY(${flatOffsetTop}px)` }}>
              {visibleFlatItems.map((file) => {
                const itemSize = getSizeValue(file, sizeMode);
                const ratio =
                  flatTotalSize > 0 ? Math.min((itemSize / flatTotalSize) * MAX_BAR_WIDTH, MAX_BAR_WIDTH) : 0;
                const isSelected = normalizePath(selectedPath ?? "") === normalizePath(file.path);
                return (
                  <div
                    key={file.path}
                    ref={(node) => {
                      if (isSelected) selectedRowRef.current = node;
                    }}
                    className={`grid grid-cols-[minmax(0,1.7fr)_120px_180px_170px_56px] items-center gap-4 border-b border-gray-100 px-6 py-3 transition-colors ${isSelected ? "bg-blue-50/80" : "hover:bg-gray-50"}`}
                    style={{ height: `${FLAT_ROW_HEIGHT}px` }}
                  >
                    <button type="button" onClick={() => handleSelectPath(file)} className="min-w-0 text-left">
                      <div className="flex min-w-0 items-center gap-2">
                        {file.is_dir ? <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" /> : <File className="h-4 w-4 flex-shrink-0 text-gray-500" />}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
                          <div className="truncate text-xs text-gray-500">{file.path}</div>
                        </div>
                      </div>
                    </button>
                    <div>
                      <TypeBadge isDir={file.is_dir} />
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-sm font-semibold text-gray-900">{formatFileSize(itemSize)}</div>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div className="h-2 rounded-full bg-blue-500 transition-[width] duration-300" style={{ width: `${ratio}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      {formatDate(file.modified)}
                    </div>
                    <div className="relative flex justify-end">
                      <RowActions
                        item={file}
                        hasChildren={file.is_dir}
                        isPreview={isPreview}
                        open={openMenuPath === file.path}
                        onToggle={() => setOpenMenuPath((open) => (open === file.path ? null : file.path))}
                        onShowInFinder={onShowInFinder}
                        onCopyPath={onCopyPath}
                        onEnterDirectory={onEnterDirectory}
                        onRescanDirectory={onRescanDirectory}
                        onDelete={onDelete}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {flatLoading && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            加载中...
          </div>
        )}
        {flatHasMore && !flatLoading && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={() => void loadFlatPage(flatItems.length)}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              加载更多（已加载 {flatItems.length} / {flatTotal}）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
