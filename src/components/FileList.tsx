import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  Folder,
  FolderOpen,
  List,
  ListTree,
  Loader2,
  MapIcon,
  MoreHorizontal,
  RotateCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { queryFlatFiles, querySubtree } from "../scanApi";
import { getSizeValue } from "../scanInsights";
import type { FileInfo, FlatModifiedWindow, FlatSortMode } from "../types";
import TreemapView from "./TreemapView";

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
  formatFileSize: (bytes: number) => string;
  focusedPath?: string | null;
  listVersion: number;
}

interface TreeRow {
  file: FileInfo;
  depth: number;
  hasChildren: boolean;
}

const PAGE_SIZE = 200;
const MAX_BAR_WIDTH = 100;
const LIST_PANEL_HEIGHT = "calc(100vh - 320px)";
const LIST_PANEL_MIN_HEIGHT = 420;
const FLAT_ROW_HEIGHT = 76;
const FLAT_OVERSCAN = 8;
const RESULT_VIEW_MODE_STORAGE_KEY = "mac-disk-scanner.result-view-mode";
const FLAT_SORT_MODE_STORAGE_KEY = "mac-disk-scanner.flat-sort-mode";
const FLAT_SIZE_FILTER_STORAGE_KEY = "mac-disk-scanner.flat-size-filter";
const FLAT_MODIFIED_FILTER_STORAGE_KEY = "mac-disk-scanner.flat-modified-filter";

const SIZE_100_MB = 100 * 1024 * 1024;
const SIZE_1_GB = 1024 * 1024 * 1024;
const SIZE_10_GB = 10 * 1024 * 1024 * 1024;

function normalizePath(path: string): string {
  if (path === "/") return "/";
  return path.replace(/\/+$/, "");
}

function getParentPath(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized === "/") return null;
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "未知";
  const date = new Date(timestamp * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function buildPathSegments(scanRoot: string, currentPath: string) {
  const normalizedRoot = normalizePath(scanRoot);
  const normalizedPath = normalizePath(currentPath);

  if (normalizedPath === normalizedRoot) {
    return [{ label: "扫描根目录", path: normalizedRoot }];
  }

  const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
  const parts = relative.split("/").filter(Boolean);
  const segments = [{ label: "扫描根目录", path: normalizedRoot }];

  let current = normalizedRoot;
  for (const part of parts) {
    current = current === "/" ? `/${part}` : `${current}/${part}`;
    segments.push({ label: part, path: current });
  }

  return segments;
}

function getStoredViewMode(): "tree" | "flat" | "map" {
  if (typeof window === "undefined") return "tree";
  const stored = window.localStorage.getItem(RESULT_VIEW_MODE_STORAGE_KEY);
  if (stored === "flat" || stored === "map") return stored;
  return "tree";
}

function getStoredFlatSortMode(): FlatSortMode {
  if (typeof window === "undefined") return "size";
  const stored = window.localStorage.getItem(FLAT_SORT_MODE_STORAGE_KEY);
  if (stored === "modified" || stored === "name") return stored;
  return "size";
}

function getStoredFlatSizeFilter(): "all" | "100mb" | "1gb" | "10gb" {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(FLAT_SIZE_FILTER_STORAGE_KEY);
  if (stored === "100mb" || stored === "1gb" || stored === "10gb") return stored;
  return "all";
}

function getStoredFlatModifiedFilter(): "all" | "30d" | "180d" | "365d" {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(FLAT_MODIFIED_FILTER_STORAGE_KEY);
  if (stored === "30d" || stored === "180d" || stored === "365d") return stored;
  return "all";
}

function sizeFilterToMinSize(filter: "all" | "100mb" | "1gb" | "10gb"): number | null {
  if (filter === "100mb") return SIZE_100_MB;
  if (filter === "1gb") return SIZE_1_GB;
  if (filter === "10gb") return SIZE_10_GB;
  return null;
}

function modifiedFilterToWindow(filter: "all" | "30d" | "180d" | "365d"): FlatModifiedWindow {
  return filter;
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function clampIndex(index: number, maxIndex: number) {
  return Math.min(Math.max(index, 0), maxIndex);
}

function isIndexNotFoundError(err: unknown): boolean {
  return String(err).includes("IndexNotFound");
}

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
  formatFileSize,
  focusedPath,
  listVersion,
}: FileListProps) {
  const normalizedRoot = useMemo(() => normalizePath(scanRoot), [scanRoot]);

  const [viewMode, setViewMode] = useState<"tree" | "flat" | "map">(getStoredViewMode);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [indexStale, setIndexStale] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Map<string, FileInfo>>(new Map());

  // Tree state (query-driven).
  const [viewPath, setViewPath] = useState(normalizedRoot);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileInfo[]>>(new Map());
  const [childTotalByPath, setChildTotalByPath] = useState<Map<string, number>>(new Map());
  const [treeLoadingPath, setTreeLoadingPath] = useState<string | null>(null);

  // Flat state (query-driven).
  const [flatSizeFilter, setFlatSizeFilter] = useState<
    "all" | "100mb" | "1gb" | "10gb"
  >(getStoredFlatSizeFilter);
  const [flatModifiedFilter, setFlatModifiedFilter] = useState<
    "all" | "30d" | "180d" | "365d"
  >(getStoredFlatModifiedFilter);
  const [flatSortMode, setFlatSortMode] = useState<FlatSortMode>(
    getStoredFlatSortMode,
  );
  const [flatSearchQuery, setFlatSearchQuery] = useState("");
  const [flatItems, setFlatItems] = useState<FileInfo[]>([]);
  const [flatTotal, setFlatTotal] = useState(0);
  const [flatHasMore, setFlatHasMore] = useState(false);
  const [flatLoading, setFlatLoading] = useState(false);

  const selectedRowRef = useRef<HTMLElement | null>(null);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const flatContainerRef = useRef<HTMLDivElement | null>(null);
  const [flatScrollTop, setFlatScrollTop] = useState(0);
  const [flatViewportHeight, setFlatViewportHeight] = useState(LIST_PANEL_MIN_HEIGHT);

  // Persist preferences.
  useEffect(() => {
    window.localStorage.setItem(RESULT_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);
  useEffect(() => {
    window.localStorage.setItem(FLAT_SORT_MODE_STORAGE_KEY, flatSortMode);
  }, [flatSortMode]);
  useEffect(() => {
    window.localStorage.setItem(FLAT_SIZE_FILTER_STORAGE_KEY, flatSizeFilter);
  }, [flatSizeFilter]);
  useEffect(() => {
    window.localStorage.setItem(FLAT_MODIFIED_FILTER_STORAGE_KEY, flatModifiedFilter);
  }, [flatModifiedFilter]);

  // Reset all view state when the scan changes.
  useEffect(() => {
    setViewPath(normalizedRoot);
    setExpandedPaths(new Set());
    setChildrenByPath(new Map());
    setChildTotalByPath(new Map());
    setSelectedPath(null);
    setOpenMenuPath(null);
    setFlatItems([]);
    setFlatTotal(0);
    setFlatHasMore(false);
    setIndexStale(false);
    setSelectedFiles(new Map());
  }, [scanId, normalizedRoot, listVersion]);

  // Load the current tree directory's children.
  const loadTreeChildren = useCallback(
    async (path: string, offset: number) => {
      if (!scanId) return;
      setTreeLoadingPath(path);
      try {
        const page = await querySubtree(scanId, path, sizeMode, offset, PAGE_SIZE);
        setChildrenByPath((prev) => {
          const existing = prev.get(path) ?? [];
          const merged = offset === 0 ? page.items : [...existing, ...page.items];
          return new Map(prev).set(path, merged);
        });
        setChildTotalByPath((prev) => new Map(prev).set(path, page.total));
      } catch (err) {
        if (isIndexNotFoundError(err)) setIndexStale(true);
      } finally {
        setTreeLoadingPath((current) => (current === path ? null : current));
      }
    },
    [scanId, sizeMode],
  );

  // Load the flat view page (offset 0 = fresh query).
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
      } catch (err) {
        if (isIndexNotFoundError(err)) setIndexStale(true);
      } finally {
        setFlatLoading(false);
      }
    },
    [scanId, flatSizeFilter, flatModifiedFilter, flatSearchQuery, activeTypeFilter, flatSortMode, sizeMode],
  );

  // (Re)load flat view when filters, scan, mode, or version change.
  useEffect(() => {
    if (!scanId || isPreview) return;
    void loadFlatPage(0);
  }, [scanId, flatSizeFilter, flatModifiedFilter, flatSortMode, flatSearchQuery, activeTypeFilter, sizeMode, isPreview, listVersion]);

  // Load the tree root when the scan completes; reload when size mode toggles.
  useEffect(() => {
    if (!scanId || isPreview) return;
    void loadTreeChildren(viewPath, 0);
  }, [scanId, viewPath, sizeMode, isPreview, listVersion]);

  // Keep selection valid.
  useEffect(() => {
    setSelectedPath((current) => {
      if (!current) return null;
      return current;
    });
  }, [flatItems, viewPath]);

  // Navigate to a focused path (from insights).
  useEffect(() => {
    if (!focusedPath || !scanId) return;
    const focused = normalizePath(focusedPath);
    setOpenMenuPath(null);
    // Find whether focused exists in any loaded cache; otherwise navigate to parent.
    const parent = getParentPath(focused);
    const target = parent ?? normalizedRoot;
    setViewPath(target);
    setSelectedPath(focused);
  }, [focusedPath, scanId, normalizedRoot]);

  // Scroll selected row into view.
  useEffect(() => {
    if (!selectedPath || !selectedRowRef.current) return;
    selectedRowRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedPath, viewMode, viewPath, expandedPaths, flatItems.length]);

  // Measure flat viewport height.
  useEffect(() => {
    if (viewMode !== "flat") return;
    const measure = () => {
      const nextHeight = flatContainerRef.current?.clientHeight;
      if (!nextHeight) return;
      setFlatViewportHeight(nextHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [viewMode]);

  // ---- derived data ----

  const pathSegments = useMemo(
    () => buildPathSegments(normalizedRoot, viewPath),
    [normalizedRoot, viewPath],
  );
  const canGoUp = viewPath !== normalizedRoot;

  const treeRows = useMemo<TreeRow[]>(() => {
    const rows: TreeRow[] = [];
    const walk = (files: FileInfo[], depth: number) => {
      for (const file of files) {
        const hasChildren = file.is_dir;
        rows.push({ file, depth, hasChildren });
        if (file.is_dir && expandedPaths.has(file.path)) {
          const kids = childrenByPath.get(file.path);
          if (kids) walk(kids, depth + 1);
        }
      }
    };
    walk(childrenByPath.get(viewPath) ?? [], 0);
    return rows;
  }, [viewPath, expandedPaths, childrenByPath]);

  const treeViewChildren = childrenByPath.get(viewPath) ?? [];
  const treeChildrenTotal = childTotalByPath.get(viewPath) ?? 0;
  const currentListSize = treeViewChildren.reduce(
    (sum, file) => sum + getSizeValue(file, sizeMode),
    0,
  );

  const flatTotalSize = useMemo(
    () => flatItems.reduce((sum, file) => sum + getSizeValue(file, sizeMode), 0),
    [flatItems, sizeMode],
  );

  const selectedFile = useMemo(() => {
    if (!selectedPath) return null;
    const findIn = (list: FileInfo[]) =>
      list.find((f) => normalizePath(f.path) === normalizePath(selectedPath));
    return (
      findIn(flatItems) ??
      treeRows.map((r) => r.file).find((f) => normalizePath(f.path) === normalizePath(selectedPath)) ??
      null
    );
  }, [selectedPath, flatItems, treeRows]);

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
  const drillIntoMap = useCallback((path: string) => {
    clearSelection();
    setViewPath(path);
  }, [clearSelection]);
  const selectedPaths = useMemo(() => new Set(selectedFiles.keys()), [selectedFiles]);
  const selectedTotal = useMemo(
    () => Array.from(selectedFiles.values()).reduce((s, f) => s + getSizeValue(f, sizeMode), 0),
    [selectedFiles, sizeMode],
  );

  const previewSorted = useMemo(
    () =>
      [...previewItems].sort((a, b) => {
        const delta = getSizeValue(b, sizeMode) - getSizeValue(a, sizeMode);
        return delta !== 0 ? delta : a.path.localeCompare(b.path);
      }),
    [previewItems, sizeMode],
  );

  const navigableItems: TreeRow[] = useMemo(() => {
    if (viewMode === "flat") {
      return flatItems.map((file) => ({ file, depth: 0, hasChildren: file.is_dir }));
    }
    return treeRows;
  }, [viewMode, flatItems, treeRows]);

  const selectedIndex = navigableItems.findIndex(
    (row) => normalizePath(row.file.path) === normalizePath(selectedPath ?? ""),
  );
  const selectedNavigableItem =
    selectedIndex >= 0 ? navigableItems[selectedIndex] : null;

  const selectNavigableIndex = (index: number) => {
    if (navigableItems.length === 0) return;
    const nextItem = navigableItems[clampIndex(index, navigableItems.length - 1)];
    setSelectedPath(nextItem.file.path);
    setOpenMenuPath(null);
  };

  const enterDirectory = (item: FileInfo) => {
    if (!item.is_dir) return false;
    setViewPath(item.path);
    setOpenMenuPath(null);
    return true;
  };

  const toggleExpand = async (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    if (!childrenByPath.has(path)) {
      await loadTreeChildren(path, 0);
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      isTextEntryTarget(event.target) ||
      navigableItems.length === 0 ||
      isPreview
    ) {
      return;
    }

    const indexForMovement = selectedIndex >= 0 ? selectedIndex : 0;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectNavigableIndex(indexForMovement + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectNavigableIndex(indexForMovement - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectNavigableIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      selectNavigableIndex(navigableItems.length - 1);
      return;
    }
    const current = selectedNavigableItem ?? navigableItems[0];
    if (event.key === "ArrowRight" && current.hasChildren) {
      event.preventDefault();
      if (viewMode === "tree" && !expandedPaths.has(current.file.path)) {
        void toggleExpand(current.file.path);
        return;
      }
      enterDirectory(current.file);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (viewMode === "tree" && current.hasChildren && expandedPaths.has(current.file.path)) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(current.file.path);
          return next;
        });
        return;
      }
      if (viewMode === "tree" && canGoUp) {
        setViewPath(getParentPath(viewPath) ?? normalizedRoot);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!enterDirectory(current.file)) {
        onShowInFinder(current.file);
      }
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setOpenMenuPath((open) =>
        open === current.file.path ? null : current.file.path,
      );
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete(current.file);
    }
  };

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

  // ---- render helpers ----

  const renderRow = (
    file: FileInfo,
    depth: number,
    hasChildren: boolean,
    key: string,
  ) => {
    const itemSize = getSizeValue(file, sizeMode);
    const ratio =
      currentListSize > 0
        ? Math.min((itemSize / currentListSize) * MAX_BAR_WIDTH, MAX_BAR_WIDTH)
        : 0;
    const isSelected = normalizePath(selectedPath ?? "") === normalizePath(file.path);
    return (
      <tr
        key={key}
        ref={(node) => {
          if (isSelected) selectedRowRef.current = node;
        }}
        className={`border-b border-gray-100 transition-colors ${
          isSelected ? "bg-blue-50/80" : "hover:bg-gray-50"
        }`}
      >
        <td className="px-6 py-3">
          <div
            className="flex min-w-0 items-center gap-2"
            style={{ paddingLeft: `${depth * 20}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => void toggleExpand(file.path)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                title={expandedPaths.has(file.path) ? "折叠目录" : "展开目录"}
              >
                {expandedPaths.has(file.path) ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="block h-6 w-6" />
            )}
            {file.is_dir ? (
              <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
            ) : (
              <File className="h-4 w-4 flex-shrink-0 text-gray-500" />
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedPath(file.path);
                treeContainerRef.current?.focus();
              }}
              className="min-w-0 text-left"
            >
              <div className="truncate text-sm font-medium text-gray-900">
                {file.name}
              </div>
              <div className="truncate text-xs text-gray-500">{file.path}</div>
            </button>
          </div>
        </td>
        <td className="px-4 py-3 align-middle">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              file.is_dir ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
            }`}
          >
            {file.is_dir ? "目录" : "文件"}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-gray-900">
              {formatFileSize(itemSize)}
            </div>
            <div className="h-2 rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-blue-500 transition-[width] duration-300"
                style={{ width: `${ratio}%` }}
              />
            </div>
            <div className="text-xs text-gray-500">
              占当前视图{" "}
              {currentListSize > 0
                ? ((itemSize / currentListSize) * 100).toFixed(1)
                : "0.0"}
              %
            </div>
          </div>
        </td>
        <td className="px-4 py-3 align-middle text-sm text-gray-500">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <Calendar className="h-4 w-4 text-gray-400" />
            {formatDate(file.modified)}
          </div>
        </td>
        <td className="px-4 py-3 align-middle">
          {renderItemActions(file, hasChildren)}
        </td>
      </tr>
    );
  };

  const renderItemActions = (item: FileInfo, hasChildren: boolean) => (
    <div className="relative flex justify-end">
      <button
        type="button"
        onClick={() =>
          setOpenMenuPath((current) => (current === item.path ? null : item.path))
        }
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
        title="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {openMenuPath === item.path && (
        <div className="absolute right-0 top-9 z-20 w-44 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {item.is_dir && hasChildren && (
            <button
              type="button"
              onClick={() => {
                setOpenMenuPath(null);
                setViewPath(item.path);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen className="h-4 w-4 text-gray-500" />
              进入目录
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setOpenMenuPath(null);
              onShowInFinder(item);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          >
            <FolderOpen className="h-4 w-4 text-gray-500" />
            在 Finder 中显示
          </button>

          <button
            type="button"
            onClick={() => {
              setOpenMenuPath(null);
              onCopyPath(item);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          >
            <Copy className="h-4 w-4 text-gray-500" />
            复制路径
          </button>

          {item.is_dir && (
            <button
              type="button"
              onClick={() => {
                setOpenMenuPath(null);
                onRescanDirectory(item);
              }}
              disabled={isPreview}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              <RotateCw className="h-4 w-4 text-gray-500" />
              {isPreview ? "扫描中暂不可重扫" : "重新扫描此目录"}
            </button>
          )}

          <div className="my-1 h-px bg-gray-100" />

          <button
            type="button"
            onClick={() => {
              setOpenMenuPath(null);
              onDelete(item);
            }}
            disabled={isPreview}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-white"
          >
            <Trash2 className="h-4 w-4" />
            {isPreview ? "扫描中暂不可删除" : "移到废纸篓"}
          </button>
        </div>
      )}
    </div>
  );

  // ---- empty / stale states ----

  if (indexStale) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-gray-200 bg-white px-8">
        <div className="text-center">
          <div className="text-sm font-medium text-gray-900">扫描结果已失效</div>
          <div className="mt-1 text-sm text-gray-500">
            索引已被回收，请重新扫描以继续查看。
          </div>
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

  // ---- preview state: read-only flat list from streaming events ----

  if (isPreview) {
    if (viewMode === "map") {
      return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">扫描中地图预览</h2>
            <p className="mt-1 text-sm text-gray-500">
              已发现的大文件实时地图，完成后切换为精确结果。
            </p>
          </div>
          <div style={{ height: "60vh", minHeight: "360px" }}>
            <TreemapView
              scanId={null}
              viewPath={viewPath}
              sizeMode={sizeMode}
              formatFileSize={formatFileSize}
              isPreview
              previewItems={previewSorted}
              selectedPaths={selectedPaths}
              onSelect={selectOnly}
              onToggleSelect={toggleSelect}
              onDrill={drillIntoMap}
              onQueryError={() => setIndexStale(true)}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                扫描中预览 ({previewSorted.length} 项)
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                正在扫描，已发现的大文件将在这里实时展示；扫描完成后切换为完整结果。
              </p>
            </div>
            <div className="text-xs text-gray-400">
              当前口径: {sizeMode === "disk" ? "磁盘使用量" : "逻辑大小"}
            </div>
          </div>
          <div className="mt-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            列表仍在变化，最终结果将在扫描完成后基于完整索引展示。
          </div>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="min-w-[920px] w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th className="w-[40%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">名称</th>
                <th className="w-[12%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">类型</th>
                <th className="w-[22%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">大小</th>
                <th className="w-[18%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">修改时间</th>
                <th className="w-[8%] px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {previewSorted.map((file) => (
                <tr key={file.path} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {file.is_dir ? (
                        <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
                      ) : (
                        <File className="h-4 w-4 flex-shrink-0 text-gray-500" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
                        <div className="truncate text-xs text-gray-500">{file.path}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${file.is_dir ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                      {file.is_dir ? "目录" : "文件"}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle text-sm font-semibold text-gray-900">
                    {formatFileSize(getSizeValue(file, sizeMode))}
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-gray-500">
                    {formatDate(file.modified)}
                  </td>
                  <td className="px-4 py-3 align-middle" />
                </tr>
              ))}
            </tbody>
          </table>
          {previewSorted.length === 0 && (
            <div className="flex h-full min-h-[360px] items-center justify-center px-8 text-sm text-gray-500">
              正在发现大文件...
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- final: query-driven tree + flat ----

  const currentLevelLabel =
    viewMode === "flat" ? "全部结果" : viewPath === normalizedRoot ? "根目录" : viewPath;

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
            <div>{viewMode === "tree" ? "树形视图按目录展开，逐层加载" : "平铺视图基于完整索引分页加载"}</div>
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
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
            <div className="text-sm text-gray-500">
              {viewMode === "tree" ? (
                <>当前目录合计: <span className="font-semibold text-gray-900">{formatFileSize(currentListSize)}</span></>
              ) : (
                <>共 {flatTotal.toLocaleString()} 项 · 已加载 {flatItems.length.toLocaleString()} 项</>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("tree")}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                    viewMode === "tree" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <ListTree className="h-3.5 w-3.5" />
                  树形
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("flat")}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                    viewMode === "flat" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  平铺
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("map")}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                    viewMode === "map" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <MapIcon className="h-3.5 w-3.5" />
                  地图
                </button>
              </div>
              {viewMode === "tree" && (
                <>
                  <button
                    type="button"
                    onClick={() => setViewPath(normalizedRoot)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    回到根目录
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (canGoUp) setViewPath(getParentPath(viewPath) ?? normalizedRoot);
                    }}
                    disabled={!canGoUp}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    返回上一级
                  </button>
                </>
              )}
            </div>
          </div>

          {viewMode === "flat" && (
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
                    <button type="button" onClick={() => setFlatSortMode("size")}
                      className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSortMode === "size" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}>按大小</button>
                    <button type="button" onClick={() => setFlatSortMode("modified")}
                      className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSortMode === "modified" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}>按时间</button>
                    <button type="button" onClick={() => setFlatSortMode("name")}
                      className={`rounded px-2.5 py-1.5 text-xs font-medium ${flatSortMode === "name" ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}>按名称</button>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {flatTotal.toLocaleString()} 项
                </div>
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
                    onClick={() => {
                      setFlatSearchQuery("");
                      setFlatSizeFilter("all");
                      setFlatModifiedFilter("all");
                      onTypeFilterChange(null);
                    }}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    清空筛选
                  </button>
                )}
              </div>
            </div>
          )}

          {viewMode === "map" ? (
            <div style={{ height: LIST_PANEL_HEIGHT, minHeight: `${LIST_PANEL_MIN_HEIGHT}px` }}>
              <TreemapView
                scanId={scanId}
                viewPath={viewPath}
                sizeMode={sizeMode}
                formatFileSize={formatFileSize}
                isPreview={isPreview}
                previewItems={previewSorted}
                selectedPaths={selectedPaths}
                onSelect={selectOnly}
                onToggleSelect={toggleSelect}
                onDrill={drillIntoMap}
                onQueryError={() => setIndexStale(true)}
              />
            </div>
          ) : viewMode === "tree" ? (
            <div
              ref={treeContainerRef}
              tabIndex={0}
              className="overflow-auto"
              onKeyDown={handleListKeyDown}
              style={{ height: LIST_PANEL_HEIGHT, minHeight: `${LIST_PANEL_MIN_HEIGHT}px` }}
            >
              <table className="min-w-[920px] w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr>
                    <th className="w-[40%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">名称</th>
                    <th className="w-[12%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">类型</th>
                    <th className="w-[22%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">大小</th>
                    <th className="w-[18%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">修改时间</th>
                    <th className="w-[8%] px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {treeRows.map((row) => renderRow(row.file, row.depth, row.hasChildren, row.file.path))}
                  {treeChildrenTotal > (childrenByPath.get(viewPath)?.length ?? 0) && (
                    <tr>
                      <td colSpan={5} className="px-6 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => void loadTreeChildren(viewPath, childrenByPath.get(viewPath)?.length ?? 0)}
                          disabled={treeLoadingPath === viewPath}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {treeLoadingPath === viewPath ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          加载更多（剩余 {(childrenByPath.get(viewPath)?.length ?? 0)} / {treeChildrenTotal}）
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {treeViewChildren.length === 0 && (
                <div className="flex h-full min-h-[360px] items-center justify-center px-8">
                  <div className="text-center">
                    <div className="text-sm font-medium text-gray-900">当前目录没有可展示项</div>
                    <div className="mt-1 text-sm text-gray-500">返回上一级或选择其他目录</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              ref={flatContainerRef}
              tabIndex={0}
              className="overflow-auto bg-white"
              onKeyDown={handleListKeyDown}
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
                      const ratio = flatTotalSize > 0 ? Math.min((itemSize / flatTotalSize) * MAX_BAR_WIDTH, MAX_BAR_WIDTH) : 0;
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
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPath(file.path);
                              flatContainerRef.current?.focus();
                            }}
                            className="min-w-0 text-left"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {file.is_dir ? <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" /> : <File className="h-4 w-4 flex-shrink-0 text-gray-500" />}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
                                <div className="truncate text-xs text-gray-500">{file.path}</div>
                              </div>
                            </div>
                          </button>
                          <div>
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${file.is_dir ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                              {file.is_dir ? "目录" : "文件"}
                            </span>
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
                          <div className="relative flex justify-end">{renderItemActions(file, file.is_dir)}</div>
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
          )}
        </div>

        <aside className="bg-gray-50/70">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-900">详情</h3>
            <p className="mt-1 text-xs text-gray-500">选中一项后查看路径、大小和更新时间</p>
          </div>
          <div className="space-y-5 px-6 py-5">
            {selectedFile ? (
              <>
                <div>
                  <div className="text-sm font-medium text-gray-900">{selectedFile.name}</div>
                  <div className="mt-1 text-xs text-gray-500 break-all">{selectedFile.path}</div>
                </div>
                <dl className="space-y-4 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">类型</dt>
                    <dd className="mt-1 text-gray-900">{selectedFile.is_dir ? "目录" : "文件"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">当前显示大小</dt>
                    <dd className="mt-1 text-gray-900">{formatFileSize(getSizeValue(selectedFile, sizeMode))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">逻辑大小</dt>
                    <dd className="mt-1 text-gray-900">{formatFileSize(selectedFile.sizeLogical)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">磁盘占用</dt>
                    <dd className="mt-1 text-gray-900">{formatFileSize(selectedFile.sizeDisk)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">修改时间</dt>
                    <dd className="mt-1 text-gray-900">{formatDate(selectedFile.modified)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
                当前没有选中项
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
