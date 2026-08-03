import { useMemo } from "react";
import { File, Folder } from "lucide-react";
import { getSizeValue, type SizeMode } from "../../scanInsights";
import { formatDate, formatFileSize } from "../../lib/format";
import type { FileInfo } from "../../types";
import TreemapView from "../TreemapView";
import type { ViewMode } from "./ResultsToolbar";
import TypeBadge from "./TypeBadge";

interface PreviewViewProps {
  viewMode: ViewMode;
  previewItems: FileInfo[];
  sizeMode: SizeMode;
  selectedPaths: Set<string>;
  onSelect: (file: FileInfo) => void;
  onToggleSelect: (file: FileInfo) => void;
  onDrill: (path: string) => void;
}

/**
 * Read-only live preview shown while a scan is still running. Uses the
 * streaming events' data and never queries the (not-yet-built) index.
 */
export default function PreviewView({
  viewMode,
  previewItems,
  sizeMode,
  selectedPaths,
  onSelect,
  onToggleSelect,
  onDrill,
}: PreviewViewProps) {
  const previewSorted = useMemo(
    () =>
      [...previewItems].sort((a, b) => {
        const delta = getSizeValue(b, sizeMode) - getSizeValue(a, sizeMode);
        return delta !== 0 ? delta : a.path.localeCompare(b.path);
      }),
    [previewItems, sizeMode],
  );

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
            viewPath=""
            sizeMode={sizeMode}
            isPreview
            previewItems={previewSorted}
            selectedPaths={selectedPaths}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
            onDrill={onDrill}
            onQueryError={() => {}}
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
                  <TypeBadge isDir={file.is_dir} />
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
