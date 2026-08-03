import { Copy, FolderOpen, MoreHorizontal, RotateCw, Trash2 } from "lucide-react";
import type { FileInfo } from "../../types";

interface RowActionsProps {
  item: FileInfo;
  hasChildren: boolean;
  isPreview: boolean;
  /** Whether this row's context menu is open (controlled by the owning view). */
  open: boolean;
  onToggle: () => void;
  onShowInFinder: (item: FileInfo) => void;
  onCopyPath: (item: FileInfo) => void;
  onEnterDirectory: (item: FileInfo) => void;
  onRescanDirectory: (item: FileInfo) => void;
  onDelete: (item: FileInfo) => void;
}

/** The "⋯" context menu for a single result row (shared by tree and flat). */
export default function RowActions({
  item,
  hasChildren,
  isPreview,
  open,
  onToggle,
  onShowInFinder,
  onCopyPath,
  onEnterDirectory,
  onRescanDirectory,
  onDelete,
}: RowActionsProps) {
  const run = (action: () => void) => () => {
    onToggle();
    action();
  };

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
        title="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 w-44 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {item.is_dir && hasChildren && (
            <button
              type="button"
              onClick={run(() => onEnterDirectory(item))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen className="h-4 w-4 text-gray-500" />
              进入目录
            </button>
          )}

          <button
            type="button"
            onClick={run(() => onShowInFinder(item))}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          >
            <FolderOpen className="h-4 w-4 text-gray-500" />
            在 Finder 中显示
          </button>

          <button
            type="button"
            onClick={run(() => onCopyPath(item))}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          >
            <Copy className="h-4 w-4 text-gray-500" />
            复制路径
          </button>

          {item.is_dir && (
            <button
              type="button"
              onClick={run(() => onRescanDirectory(item))}
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
            onClick={run(() => onDelete(item))}
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
}
