import {
  AppWindow,
  Archive,
  Clock3,
  FileStack,
  FolderTree,
  Sparkles,
} from "lucide-react";

import { formatFileSize } from "../lib/format";
import type { Insights, InsightPick } from "../types";
import type { SizeMode } from "../scanInsights";

interface ScanInsightsProps {
  insights: Insights;
  sizeMode: SizeMode;
  onFocusPath: (path: string) => void;
  activeTypeFilter: string | null;
  onTypeFilterChange: (type: string | null) => void;
}

interface InsightCard {
  title: string;
  description: string;
  pick: InsightPick;
}

function toCards(insights: Insights): InsightCard[] {
  const cards: InsightCard[] = [];
  if (insights.largestDirectory) {
    cards.push({
      title: "最大目录",
      description: "先从体积最大的目录开始排查",
      pick: insights.largestDirectory,
    });
  }
  if (insights.largestFile) {
    cards.push({
      title: "最大文件",
      description: "单文件往往是最直接的清理入口",
      pick: insights.largestFile,
    });
  }
  if (insights.recentLargeFile) {
    cards.push({
      title: "近期新增的大文件",
      description: "最近 30 天内变大的内容值得优先确认",
      pick: insights.recentLargeFile,
    });
  }
  if (insights.staleLargeFile) {
    cards.push({
      title: "长期未动的大文件",
      description: "超过 180 天未修改的文件更适合清理或归档",
      pick: insights.staleLargeFile,
    });
  }
  return cards;
}

export default function ScanInsights({
  insights,
  sizeMode,
  onFocusPath,
  activeTypeFilter,
  onTypeFilterChange,
}: ScanInsightsProps) {
  const cards = toCards(insights);

  if (cards.length === 0 && insights.topTypes.length === 0) {
    return null;
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3.5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Sparkles className="h-5 w-5 text-blue-600" />
              扫描洞察
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              基于完整索引计算，帮助你更快判断空间主要被什么占用。
            </p>
          </div>
          <div className="text-xs text-gray-400">
            当前口径: {sizeMode === "disk" ? "磁盘使用量" : "逻辑大小"}
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        {cards.length > 0 && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {cards.map((card, index) => {
              const Icon =
                index === 0
                  ? FolderTree
                  : index === 1
                    ? FileStack
                    : index === 2
                      ? AppWindow
                      : Clock3;
              const size = sizeMode === "disk" ? card.pick.sizeDisk : card.pick.sizeLogical;
              return (
                <button
                  key={`${card.title}:${card.pick.path}`}
                  type="button"
                  onClick={() => onFocusPath(card.pick.path)}
                  className="rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        {card.title}
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-gray-900">
                        {card.pick.path.split("/").filter(Boolean).pop() || card.pick.path}
                      </div>
                      <div className="mt-1 truncate text-xs text-gray-500">
                        {card.pick.path}
                      </div>
                    </div>
                    <Icon className="h-5 w-5 flex-shrink-0 text-blue-600" />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-sm text-gray-500">{card.description}</div>
                    <div className="text-sm font-semibold text-gray-900">
                      {formatFileSize(size)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {insights.topTypes.length > 0 && (
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
                  当前平铺视图仅查看: {activeTypeFilter}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {insights.topTypes.map((bucket) => {
                const total = sizeMode === "disk" ? bucket.totalDisk : bucket.totalLogical;
                return (
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
                        {formatFileSize(total)}
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
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
