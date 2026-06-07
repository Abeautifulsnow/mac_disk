import { useEffect, useMemo, useRef, useState } from "react";
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
  MoreHorizontal,
  RotateCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import type { FileInfo } from "../types";

interface FileListProps {
  files: FileInfo[];
  sessionKey: number;
  scanRoot: string;
  isPreview: boolean;
  focusedPath?: string | null;
  onDelete: (file: FileInfo) => void;
  onShowInFinder: (file: FileInfo) => void;
  onCopyPath: (file: FileInfo) => void;
  onRescanDirectory: (file: FileInfo) => void;
  formatFileSize: (bytes: number) => string;
  sizeMode: "logical" | "disk";
}

interface TreeNode {
  item: FileInfo;
  children: TreeNode[];
}

interface TreeResult {
  roots: TreeNode[];
  nodeMap: Map<string, TreeNode>;
}

interface FlatNode {
  item: FileInfo;
  depth: number;
  hasChildren: boolean;
}

const MAX_BAR_WIDTH = 100;
const LIST_PANEL_HEIGHT = "calc(100vh - 320px)";
const LIST_PANEL_MIN_HEIGHT = 420;
const FLAT_ROW_HEIGHT = 76;
const FLAT_OVERSCAN = 8;
const RESULT_VIEW_MODE_STORAGE_KEY = "mac-disk-scanner.result-view-mode";

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

function getSizeValue(file: FileInfo, sizeMode: "logical" | "disk") {
  return sizeMode === "disk" ? file.sizeDisk : file.sizeLogical;
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

function buildTree(
  files: FileInfo[],
  scanRoot: string,
  sizeMode: "logical" | "disk",
): TreeResult {
  const normalizedRoot = normalizePath(scanRoot);
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    const node: TreeNode = {
      item: { ...file, path },
      children: [],
    };
    nodeMap.set(path, node);
    const parentPath = getParentPath(node.item.path);
    const parentNode =
      parentPath && parentPath !== normalizedRoot
        ? nodeMap.get(parentPath)
        : undefined;

    if (parentNode) {
      parentNode.children.push(node);
      continue;
    }

    roots.push(node);
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const sizeDelta = getSizeValue(b.item, sizeMode) - getSizeValue(a.item, sizeMode);
      if (sizeDelta !== 0) return sizeDelta;

      return a.item.path.localeCompare(b.item.path);
    });

    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(roots);
  return { roots, nodeMap };
}

function flattenTree(
  nodes: TreeNode[],
  expandedPaths: Set<string>,
): FlatNode[] {
  const flat: FlatNode[] = [];

  const walk = (currentNodes: TreeNode[], depth: number) => {
    for (const node of currentNodes) {
      flat.push({
        item: node.item,
        depth,
        hasChildren: node.children.length > 0,
      });

      if (node.children.length > 0 && expandedPaths.has(node.item.path)) {
        walk(node.children, depth + 1);
      }
    }
  };

  walk(nodes, 0);
  return flat;
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

function getStoredViewMode(): "tree" | "flat" {
  if (typeof window === "undefined") return "tree";

  const stored = window.localStorage.getItem(RESULT_VIEW_MODE_STORAGE_KEY);
  return stored === "flat" ? "flat" : "tree";
}

export default function FileList({
  files,
  sessionKey,
  scanRoot,
  isPreview,
  focusedPath,
  onDelete,
  onShowInFinder,
  onCopyPath,
  onRescanDirectory,
  formatFileSize,
  sizeMode,
}: FileListProps) {
  const normalizedRoot = useMemo(() => normalizePath(scanRoot), [scanRoot]);
  const { roots, nodeMap } = useMemo(
    () => buildTree(files, normalizedRoot, sizeMode),
    [files, normalizedRoot, sizeMode],
  );

  const flatContainerRef = useRef<HTMLDivElement | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [viewPath, setViewPath] = useState(normalizedRoot);
  const [viewMode, setViewMode] = useState<"tree" | "flat">(getStoredViewMode);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [flatScrollTop, setFlatScrollTop] = useState(0);
  const [flatViewportHeight, setFlatViewportHeight] = useState(LIST_PANEL_MIN_HEIGHT);
  const [flatSearchQuery, setFlatSearchQuery] = useState("");

  useEffect(() => {
    setExpandedPaths(new Set());
    setViewPath(normalizedRoot);
    setSelectedPath(null);
    setOpenMenuPath(null);
    setFlatScrollTop(0);
    setFlatSearchQuery("");
  }, [normalizedRoot, sessionKey]);

  useEffect(() => {
    setSelectedPath((current) => {
      if (!current) return files[0]?.path ?? null;
      return files.some((file) => normalizePath(file.path) === normalizePath(current))
        ? current
        : files[0]?.path ?? null;
    });
  }, [files]);

  useEffect(() => {
    window.localStorage.setItem(RESULT_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (viewPath === normalizedRoot) return;
    if (!nodeMap.has(viewPath)) {
      setViewPath(normalizedRoot);
    }
  }, [nodeMap, normalizedRoot, viewPath]);

  useEffect(() => {
    if (!focusedPath) return;

    const normalizedFocusedPath = normalizePath(focusedPath);
    const focusedFile = files.find(
      (file) => normalizePath(file.path) === normalizedFocusedPath,
    );
    if (!focusedFile) return;

    setSelectedPath(focusedFile.path);
    setOpenMenuPath(null);

    if (focusedFile.is_dir) {
      setViewPath(focusedFile.path);
      return;
    }

    setViewPath(getParentPath(focusedFile.path) ?? normalizedRoot);
  }, [files, focusedPath, normalizedRoot]);

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

  const branchNodes = useMemo(() => {
    if (viewPath === normalizedRoot) {
      return roots;
    }

    return nodeMap.get(viewPath)?.children ?? [];
  }, [nodeMap, normalizedRoot, roots, viewPath]);

  const flatNodes = useMemo(
    () => flattenTree(branchNodes, expandedPaths),
    [branchNodes, expandedPaths],
  );
  const flatFiles = useMemo(
    () => [...files].sort((a, b) => {
      const sizeDelta = getSizeValue(b, sizeMode) - getSizeValue(a, sizeMode);
      if (sizeDelta !== 0) return sizeDelta;
      return a.path.localeCompare(b.path);
    }),
    [files, sizeMode],
  );
  const normalizedFlatSearchQuery = flatSearchQuery.trim().toLowerCase();
  const filteredFlatFiles = useMemo(() => {
    if (!normalizedFlatSearchQuery) return flatFiles;

    return flatFiles.filter((item) => {
      const lowerName = item.name.toLowerCase();
      const lowerPath = item.path.toLowerCase();
      return (
        lowerName.includes(normalizedFlatSearchQuery) ||
        lowerPath.includes(normalizedFlatSearchQuery)
      );
    });
  }, [flatFiles, normalizedFlatSearchQuery]);

  const totalSize = useMemo(
    () =>
      branchNodes.reduce((sum, node) => sum + getSizeValue(node.item, sizeMode), 0),
    [branchNodes, sizeMode],
  );
  const flatTotalSize = useMemo(
    () =>
      filteredFlatFiles.reduce((sum, item) => sum + getSizeValue(item, sizeMode), 0),
    [filteredFlatFiles, sizeMode],
  );

  const selectedFile =
    files.find((file) => normalizePath(file.path) === normalizePath(selectedPath ?? "")) ?? null;

  const pathSegments = useMemo(
    () => buildPathSegments(normalizedRoot, viewPath),
    [normalizedRoot, viewPath],
  );

  const toggleExpand = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleMenuAction = (action: () => void) => {
    action();
    setOpenMenuPath(null);
  };

  const canGoUp = viewPath !== normalizedRoot;
  const currentLevelLabel =
    viewMode === "flat"
      ? "全部结果"
      : viewPath === normalizedRoot
        ? "根目录"
        : viewPath;
  const currentListSize = viewMode === "flat" ? flatTotalSize : totalSize;
  const flatStartIndex = Math.max(
    0,
    Math.floor(flatScrollTop / FLAT_ROW_HEIGHT) - FLAT_OVERSCAN,
  );
  const flatEndIndex = Math.min(
    filteredFlatFiles.length,
    Math.ceil((flatScrollTop + flatViewportHeight) / FLAT_ROW_HEIGHT) + FLAT_OVERSCAN,
  );
  const visibleFlatFiles = filteredFlatFiles.slice(flatStartIndex, flatEndIndex);
  const flatOffsetTop = flatStartIndex * FLAT_ROW_HEIGHT;
  const flatTotalHeight = filteredFlatFiles.length * FLAT_ROW_HEIGHT;

  useEffect(() => {
    if (viewMode !== "flat" || !selectedPath || !flatContainerRef.current) return;

    const index = filteredFlatFiles.findIndex(
      (item) => normalizePath(item.path) === normalizePath(selectedPath),
    );
    if (index === -1) return;

    const targetTop = index * FLAT_ROW_HEIGHT;
    const viewportBottom = flatScrollTop + flatViewportHeight - FLAT_ROW_HEIGHT;
    if (targetTop >= flatScrollTop && targetTop <= viewportBottom) return;

    flatContainerRef.current.scrollTo({
      top: Math.max(0, targetTop - flatViewportHeight / 2 + FLAT_ROW_HEIGHT / 2),
    });
  }, [
    filteredFlatFiles,
    flatScrollTop,
    flatViewportHeight,
    selectedPath,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "flat") return;
    setFlatScrollTop(0);
    flatContainerRef.current?.scrollTo({ top: 0 });
  }, [normalizedFlatSearchQuery, viewMode]);

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
              onClick={() => handleMenuAction(() => setViewPath(item.path))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen className="h-4 w-4 text-gray-500" />
              进入目录
            </button>
          )}

          <button
            type="button"
            onClick={() => handleMenuAction(() => onShowInFinder(item))}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          >
            <FolderOpen className="h-4 w-4 text-gray-500" />
            在 Finder 中显示
          </button>

          <button
            type="button"
            onClick={() => handleMenuAction(() => onCopyPath(item))}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          >
            <Copy className="h-4 w-4 text-gray-500" />
            复制路径
          </button>

          {item.is_dir && (
            <button
              type="button"
              onClick={() => handleMenuAction(() => onRescanDirectory(item))}
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
            onClick={() => handleMenuAction(() => onDelete(item))}
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

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isPreview ? "扫描中预览" : "扫描结果"} ({files.length} 项)
            </h2>
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
              {isPreview
                ? "预览结果会持续变化"
                : viewMode === "tree"
                  ? "树形表格支持逐层展开和查看详情"
                  : "平铺视图按体积排序，并对长列表做窗口化渲染"}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              当前层级: {currentLevelLabel}
            </div>
          </div>
        </div>
        {isPreview && (
          <div className="mt-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            当前列表是扫描中的预览结果。大小、目录层级和展示项会继续变化，最终结果将在扫描完成后替换此视图。
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border-r border-gray-200">
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
            <div className="text-sm text-gray-500">
              当前视图合计: <span className="font-semibold text-gray-900">{formatFileSize(currentListSize)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("tree")}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                    viewMode === "tree"
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <ListTree className="h-3.5 w-3.5" />
                  树形
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("flat")}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                    viewMode === "flat"
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  平铺
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
                      if (!canGoUp) return;
                      setViewPath(getParentPath(viewPath) ?? normalizedRoot);
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
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-6 py-3">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
                <Search className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <input
                  type="text"
                  value={flatSearchQuery}
                  onChange={(event) => setFlatSearchQuery(event.target.value)}
                  placeholder="搜索名称或路径"
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
              <div className="text-xs text-gray-500">
                {filteredFlatFiles.length.toLocaleString()} / {flatFiles.length.toLocaleString()} 项
              </div>
            </div>
          )}

          {viewMode === "tree" ? (
            <div
              className="overflow-auto"
              style={{ height: LIST_PANEL_HEIGHT, minHeight: `${LIST_PANEL_MIN_HEIGHT}px` }}
            >
              <table className="min-w-[920px] w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr>
                    <th className="w-[40%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      名称
                    </th>
                    <th className="w-[12%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      类型
                    </th>
                    <th className="w-[22%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      大小
                    </th>
                    <th className="w-[18%] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      修改时间
                    </th>
                    <th className="w-[8%] px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {flatNodes.map(({ item, depth, hasChildren }) => {
                    const itemSize = getSizeValue(item, sizeMode);
                    const ratio = currentListSize > 0
                      ? Math.min((itemSize / currentListSize) * MAX_BAR_WIDTH, MAX_BAR_WIDTH)
                      : 0;
                    const isExpanded = expandedPaths.has(item.path);
                    const isSelected = normalizePath(selectedPath ?? "") === item.path;

                    return (
                      <tr
                        key={item.path}
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
                                onClick={() => toggleExpand(item.path)}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                                title={isExpanded ? "折叠目录" : "展开目录"}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            ) : (
                              <span className="block h-6 w-6" />
                            )}

                            {item.is_dir ? (
                              <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
                            ) : (
                              <File className="h-4 w-4 flex-shrink-0 text-gray-500" />
                            )}

                            <button
                              type="button"
                              onClick={() => setSelectedPath(item.path)}
                              className="min-w-0 text-left"
                            >
                              <div className="truncate text-sm font-medium text-gray-900">
                                {item.name}
                              </div>
                              <div className="truncate text-xs text-gray-500">{item.path}</div>
                            </button>
                          </div>
                        </td>

                        <td className="px-4 py-3 align-middle">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              item.is_dir
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {item.is_dir ? "目录" : "文件"}
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
                              占当前视图 {currentListSize > 0 ? ((itemSize / currentListSize) * 100).toFixed(1) : "0.0"}%
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3 align-middle text-sm text-gray-500">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            {formatDate(item.modified)}
                          </div>
                        </td>

                        <td className="px-4 py-3 align-middle">
                          {renderItemActions(item, hasChildren)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {flatNodes.length === 0 && (
                <div className="flex h-full min-h-[360px] items-center justify-center px-8">
                  <div className="text-center">
                    <div className="text-sm font-medium text-gray-900">当前层级没有可展示项</div>
                    <div className="mt-1 text-sm text-gray-500">
                      返回上一级，或降低最小大小限制后重新扫描
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              ref={flatContainerRef}
              className="overflow-auto bg-white"
              style={{ height: LIST_PANEL_HEIGHT, minHeight: `${LIST_PANEL_MIN_HEIGHT}px` }}
              onScroll={(event) => setFlatScrollTop(event.currentTarget.scrollTop)}
            >
              {filteredFlatFiles.length === 0 ? (
                <div className="flex h-full min-h-[360px] items-center justify-center px-8">
                  <div className="text-center">
                    <div className="text-sm font-medium text-gray-900">
                      {normalizedFlatSearchQuery ? "没有匹配的搜索结果" : "当前没有可展示项"}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {normalizedFlatSearchQuery
                        ? "尝试缩短关键词，或切换回树形视图继续查看"
                        : "调整筛选条件，或重新扫描后再查看"}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ height: `${flatTotalHeight}px`, position: "relative" }}>
                  <div
                    style={{
                      transform: `translateY(${flatOffsetTop}px)`,
                    }}
                  >
                    {visibleFlatFiles.map((item) => {
                      const itemSize = getSizeValue(item, sizeMode);
                      const ratio = currentListSize > 0
                        ? Math.min((itemSize / currentListSize) * MAX_BAR_WIDTH, MAX_BAR_WIDTH)
                        : 0;
                      const isSelected =
                        normalizePath(selectedPath ?? "") === normalizePath(item.path);
                      const hasChildren = (nodeMap.get(normalizePath(item.path))?.children.length ?? 0) > 0;

                      return (
                        <div
                          key={item.path}
                          className={`grid grid-cols-[minmax(0,1.7fr)_120px_180px_170px_56px] items-center gap-4 border-b border-gray-100 px-6 py-3 transition-colors ${
                            isSelected ? "bg-blue-50/80" : "hover:bg-gray-50"
                          }`}
                          style={{ height: `${FLAT_ROW_HEIGHT}px` }}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedPath(item.path)}
                            className="min-w-0 text-left"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {item.is_dir ? (
                                <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
                              ) : (
                                <File className="h-4 w-4 flex-shrink-0 text-gray-500" />
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-900">
                                  {item.name}
                                </div>
                                <div className="truncate text-xs text-gray-500">{item.path}</div>
                              </div>
                            </div>
                          </button>

                          <div>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                item.is_dir
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {item.is_dir ? "目录" : "文件"}
                            </span>
                          </div>

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
                          </div>

                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Calendar className="h-4 w-4 text-gray-400" />
                            {formatDate(item.modified)}
                          </div>

                          {renderItemActions(item, hasChildren)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="bg-gray-50/70">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-900">详情</h3>
            <p className="mt-1 text-xs text-gray-500">
              {isPreview
                ? "预览态下大小和目录结构仍可能变化"
                : "选中一项后查看路径、大小和更新时间"}
            </p>
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
                    <dd className="mt-1 text-gray-900">
                      {formatFileSize(getSizeValue(selectedFile, sizeMode))}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">逻辑大小</dt>
                    <dd className="mt-1 text-gray-900">
                      {formatFileSize(selectedFile.sizeLogical)}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs uppercase tracking-wider text-gray-500">磁盘占用</dt>
                    <dd className="mt-1 text-gray-900">
                      {formatFileSize(selectedFile.sizeDisk)}
                    </dd>
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
