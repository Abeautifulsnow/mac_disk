import {
  AppWindow,
  Archive,
  Clock3,
  FileStack,
  FolderTree,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";

import type { FileInfo } from "../types";
import {
  buildTypeBuckets,
  getSizeValue,
  type SizeMode,
} from "../scanInsights";

interface ScanInsightsProps {
  files: FileInfo[];
  sizeMode: SizeMode;
  formatFileSize: (bytes: number) => string;
  onFocusPath: (path: string) => void;
  activeTypeFilter: string | null;
  onTypeFilterChange: (type: string | null) => void;
}

interface InsightItem {
  title: string;
  description: string;
  path: string;
  size: number;
}

const RECENT_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const STALE_WINDOW_SECONDS = 180 * 24 * 60 * 60;

function pickLargerBySize(
  current: FileInfo | null,
  candidate: FileInfo,
  sizeMode: SizeMode,
) {
  if (!current) return candidate;

  const currentSize = getSizeValue(current, sizeMode);
  const candidateSize = getSizeValue(candidate, sizeMode);
  if (candidateSize !== currentSize) {
    return candidateSize > currentSize ? candidate : current;
  }

  return candidate.path.localeCompare(current.path) < 0 ? candidate : current;
}

function buildInsights(files: FileInfo[], sizeMode: SizeMode) {
  const directories = files.filter((item) => item.is_dir);
  const regularFiles = files.filter((item) => !item.is_dir);
  const nowSeconds = Math.floor(Date.now() / 1000);

  let largestDirectory: FileInfo | null = null;
  for (const item of directories) {
    largestDirectory = pickLargerBySize(largestDirectory, item, sizeMode);
  }

  let largestFile: FileInfo | null = null;
  for (const item of regularFiles) {
    largestFile = pickLargerBySize(largestFile, item, sizeMode);
  }

  let recentLargeFile: FileInfo | null = null;
  for (const item of regularFiles) {
    if (!item.modified) continue;
    if (nowSeconds - item.modified > RECENT_WINDOW_SECONDS) continue;
    recentLargeFile = pickLargerBySize(recentLargeFile, item, sizeMode);
  }
  if (!recentLargeFile && regularFiles.length > 0) {
    recentLargeFile = [...regularFiles].sort((a, b) => {
      const modifiedDelta = (b.modified ?? 0) - (a.modified ?? 0);
      if (modifiedDelta !== 0) return modifiedDelta;
      return getSizeValue(b, sizeMode) - getSizeValue(a, sizeMode);
    })[0];
  }

  let staleLargeFile: FileInfo | null = null;
  for (const item of regularFiles) {
    if (!item.modified) continue;
    if (nowSeconds - item.modified < STALE_WINDOW_SECONDS) continue;
    staleLargeFile = pickLargerBySize(staleLargeFile, item, sizeMode);
  }
  if (!staleLargeFile && regularFiles.length > 0) {
    staleLargeFile = [...regularFiles].sort((a, b) => {
      const modifiedDelta = (a.modified ?? Number.MAX_SAFE_INTEGER) - (b.modified ?? Number.MAX_SAFE_INTEGER);
      if (modifiedDelta !== 0) return modifiedDelta;
      return getSizeValue(b, sizeMode) - getSizeValue(a, sizeMode);
    })[0];
  }

  const topTypes = buildTypeBuckets(files, sizeMode).slice(0, 6);

  return {
    largestDirectory,
    largestFile,
    recentLargeFile,
    staleLargeFile,
    topTypes,
  };
}

function toInsightItem(
  file: FileInfo | null,
  sizeMode: SizeMode,
  title: string,
  description: string,
): InsightItem | null {
  if (!file) return null;

  return {
    title,
    description,
    path: file.path,
    size: getSizeValue(file, sizeMode),
  };
}

export default function ScanInsights({
  files,
  sizeMode,
  formatFileSize,
  onFocusPath,
  activeTypeFilter,
  onTypeFilterChange,
}: ScanInsightsProps) {
  const { largestDirectory, largestFile, recentLargeFile, staleLargeFile, topTypes } =
    useMemo(() => buildInsights(files, sizeMode), [files, sizeMode]);

  const insightItems = [
    toInsightItem(largestDirectory, sizeMode, "最大目录", "先从体积最大的目录开始排查"),
    toInsightItem(largestFile, sizeMode, "最大文件", "单文件往往是最直接的清理入口"),
    toInsightItem(recentLargeFile, sizeMode, "近期新增的大文件", "最近 30 天内变大的内容值得优先确认"),
    toInsightItem(staleLargeFile, sizeMode, "长期未动的大文件", "超过 180 天未修改的文件更适合清理或归档"),
  ].filter((item): item is InsightItem => item !== null);

  if (insightItems.length === 0 && topTypes.length === 0) {
    return null;
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Sparkles className="h-5 w-5 text-blue-600" />
              扫描洞察
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              基于当前展示结果生成，帮助你更快判断空间主要被什么占用。
            </p>
          </div>
          <div className="text-xs text-gray-400">
            当前口径: {sizeMode === "disk" ? "磁盘使用量" : "逻辑大小"}
          </div>
        </div>
      </div>

      <div className="space-y-6 px-6 py-5">
        {insightItems.length > 0 && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {insightItems.map((item, index) => {
              const Icon =
                index === 0
                  ? FolderTree
                  : index === 1
                    ? FileStack
                    : index === 2
                      ? AppWindow
                      : Clock3;

              return (
                <button
                  key={`${item.title}:${item.path}`}
                  type="button"
                  onClick={() => onFocusPath(item.path)}
                  className="rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        {item.title}
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-gray-900">
                        {item.path.split("/").filter(Boolean).pop() || item.path}
                      </div>
                      <div className="mt-1 truncate text-xs text-gray-500">
                        {item.path}
                      </div>
                    </div>
                    <Icon className="h-5 w-5 flex-shrink-0 text-blue-600" />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-sm text-gray-500">{item.description}</div>
                    <div className="text-sm font-semibold text-gray-900">
                      {formatFileSize(item.size)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {topTypes.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Archive className="h-4 w-4 text-gray-500" />
              占用最多的类型
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onTypeFilterChange(null)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTypeFilter === null
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
                }`}
              >
                全部类型
              </button>
              {activeTypeFilter && (
                <div className="text-xs text-gray-500">
                  当前仅查看: {activeTypeFilter}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {topTypes.map((bucket) => (
                <div
                  key={bucket.label}
                  className={`rounded-lg border px-4 py-3 transition-colors ${
                    activeTypeFilter === bucket.label
                      ? "border-blue-300 bg-blue-50/60"
                      : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{bucket.label}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {bucket.count.toLocaleString()} 个项目
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">
                      {formatFileSize(bucket.totalSize)}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onTypeFilterChange(bucket.label)}
                      className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-200 hover:text-blue-700"
                    >
                      {activeTypeFilter === bucket.label ? "保持筛选" : "只看这类"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onFocusPath(bucket.samplePath)}
                      className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-200 hover:text-blue-700"
                    >
                      定位示例
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
