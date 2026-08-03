import { getSizeValue, type SizeMode } from "../../scanInsights";
import { formatDate, formatFileSize } from "../../lib/format";
import type { FileInfo } from "../../types";

interface DetailAsideProps {
  selectedFile: FileInfo | null;
  sizeMode: SizeMode;
}

/** Right-hand details panel for the currently selected result row. */
export default function DetailAside({ selectedFile, sizeMode }: DetailAsideProps) {
  return (
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
  );
}
