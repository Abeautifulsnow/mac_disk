import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronDown, ChevronRight, File, Folder, Loader2 } from "lucide-react";
import { querySubtree } from "../../scanApi";
import { getSizeValue, type SizeMode } from "../../scanInsights";
import { formatDate, formatFileSize } from "../../lib/format";
import { normalizePath } from "../../lib/path";
import type { FileInfo } from "../../types";
import { useListKeyboardNav } from "../../hooks/useListKeyboardNav";
import ResultsToolbar, { type ViewMode } from "./ResultsToolbar";
import RowActions from "./RowActions";
import TypeBadge from "./TypeBadge";

const PAGE_SIZE = 200;
const MAX_BAR_WIDTH = 100;
const LIST_PANEL_HEIGHT = "calc(100vh - 320px)";
const LIST_PANEL_MIN_HEIGHT = 420;

interface TreeViewProps {
  scanId: string | null;
  viewPath: string;
  sizeMode: SizeMode;
  isPreview: boolean;
  listVersion: number;
  selectedPath: string | null;
  canGoUp: boolean;
  onSelectPath: (file: FileInfo) => void;
  onCacheFiles: (files: FileInfo[]) => void;
  onIndexStale: () => void;
  onEnterDirectory: (file: FileInfo) => void;
  onGoUp: () => void;
  onGoRoot: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onShowInFinder: (file: FileInfo) => void;
  onCopyPath: (file: FileInfo) => void;
  onRescanDirectory: (file: FileInfo) => void;
  onDelete: (file: FileInfo) => void;
}

interface TreeRow {
  file: FileInfo;
  depth: number;
  hasChildren: boolean;
}

function isIndexNotFoundError(err: unknown): boolean {
  return String(err).includes("IndexNotFound");
}

/** Query-driven directory tree with expand/collapse and lazy-loaded pages. */
export default function TreeView({
  scanId,
  viewPath,
  sizeMode,
  isPreview,
  listVersion,
  selectedPath,
  canGoUp,
  onSelectPath,
  onCacheFiles,
  onIndexStale,
  onEnterDirectory,
  onGoUp,
  onGoRoot,
  onViewModeChange,
  onShowInFinder,
  onCopyPath,
  onRescanDirectory,
  onDelete,
}: TreeViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileInfo[]>>(new Map());
  const [childTotalByPath, setChildTotalByPath] = useState<Map<string, number>>(new Map());
  const [treeLoadingPath, setTreeLoadingPath] = useState<string | null>(null);
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);

  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedRowRef = useRef<HTMLElement | null>(null);

  // Reset query state when the scan changes.
  useEffect(() => {
    setExpandedPaths(new Set());
    setChildrenByPath(new Map());
    setChildTotalByPath(new Map());
  }, [scanId, listVersion]);

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
        onCacheFiles(page.items);
      } catch (err) {
        if (isIndexNotFoundError(err)) onIndexStale();
      } finally {
        setTreeLoadingPath((current) => (current === path ? null : current));
      }
    },
    [scanId, sizeMode, onCacheFiles, onIndexStale],
  );

  // Load the current directory's children when the scan/path/size mode changes.
  useEffect(() => {
    if (!scanId || isPreview) return;
    void loadTreeChildren(viewPath, 0);
  }, [scanId, viewPath, sizeMode, isPreview, listVersion, loadTreeChildren]);

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

  const handleSelectPath = (file: FileInfo) => {
    setOpenMenuPath(null);
    onSelectPath(file);
    treeContainerRef.current?.focus();
  };

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

  // Scroll the selected row into view.
  useEffect(() => {
    if (!selectedPath || !selectedRowRef.current) return;
    selectedRowRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedPath, treeRows.length]);

  const keyboardHandler = useListKeyboardNav<TreeRow>({
    items: treeRows,
    selectedPath,
    isPreview,
    onSelectPath: handleSelectPath,
    onEnterDirectory,
    onOpen: onShowInFinder,
    onDelete,
    onToggleMenu: (file) =>
      setOpenMenuPath((open) => (open === file.path ? null : file.path)),
    onArrowRight: (current) => {
      if (!expandedPaths.has(current.file.path)) {
        void toggleExpand(current.file.path);
      } else {
        onEnterDirectory(current.file);
      }
    },
    onArrowLeft: (current) => {
      if (current.hasChildren && expandedPaths.has(current.file.path)) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(current.file.path);
          return next;
        });
      } else if (canGoUp) {
        onGoUp();
      }
    },
  });

  const renderRow = (row: TreeRow, key: string) => {
    const file = row.file;
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
            style={{ paddingLeft: `${row.depth * 20}px` }}
          >
            {row.hasChildren ? (
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
            <button type="button" onClick={() => handleSelectPath(file)} className="min-w-0 text-left">
              <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
              <div className="truncate text-xs text-gray-500">{file.path}</div>
            </button>
          </div>
        </td>
        <td className="px-4 py-3 align-middle">
          <TypeBadge isDir={file.is_dir} />
        </td>
        <td className="px-4 py-3 align-middle">
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-gray-900">{formatFileSize(itemSize)}</div>
            <div className="h-2 rounded-full bg-gray-100">
              <div
                className="h-2 rounded-full bg-blue-500 transition-[width] duration-300"
                style={{ width: `${ratio}%` }}
              />
            </div>
            <div className="text-xs text-gray-500">
              占当前视图{" "}
              {currentListSize > 0 ? ((itemSize / currentListSize) * 100).toFixed(1) : "0.0"}%
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
          <RowActions
            item={file}
            hasChildren={row.hasChildren}
            isPreview={isPreview}
            open={openMenuPath === file.path}
            onToggle={() => setOpenMenuPath((open) => (open === file.path ? null : file.path))}
            onShowInFinder={onShowInFinder}
            onCopyPath={onCopyPath}
            onEnterDirectory={onEnterDirectory}
            onRescanDirectory={onRescanDirectory}
            onDelete={onDelete}
          />
        </td>
      </tr>
    );
  };

  return (
    <div>
      <ResultsToolbar
        viewMode="tree"
        onViewModeChange={onViewModeChange}
        meta={
          <>
            当前目录合计:{" "}
            <span className="font-semibold text-gray-900">{formatFileSize(currentListSize)}</span>
          </>
        }
        showTreeNav
        canGoUp={canGoUp}
        onGoRoot={onGoRoot}
        onGoUp={onGoUp}
      />
      <div
        ref={treeContainerRef}
        tabIndex={0}
        className="overflow-auto"
        onKeyDown={keyboardHandler}
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
            {treeRows.map((row) => renderRow(row, row.file.path))}
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
    </div>
  );
}
