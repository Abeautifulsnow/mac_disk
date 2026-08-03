import { List, ListTree, MapIcon } from "lucide-react";
import type { ReactNode } from "react";

export type ViewMode = "tree" | "flat" | "map";

interface ResultsToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** View-specific summary shown on the left (e.g. current directory total). */
  meta: ReactNode;
  /** Show tree navigation buttons (root / up). */
  showTreeNav?: boolean;
  canGoUp?: boolean;
  onGoRoot?: () => void;
  onGoUp?: () => void;
}

const MODES: Array<{ mode: ViewMode; label: string; Icon: typeof ListTree }> = [
  { mode: "tree", label: "树形", Icon: ListTree },
  { mode: "flat", label: "平铺", Icon: List },
  { mode: "map", label: "地图", Icon: MapIcon },
];

/** Shared toolbar row for the tree/flat/map result views. */
export default function ResultsToolbar({
  viewMode,
  onViewModeChange,
  meta,
  showTreeNav = false,
  canGoUp = false,
  onGoRoot,
  onGoUp,
}: ResultsToolbarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
      <div className="text-sm text-gray-500">{meta}</div>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
          {MODES.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onViewModeChange(mode)}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium ${
                viewMode === mode ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        {showTreeNav && (
          <>
            <button
              type="button"
              onClick={onGoRoot}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              回到根目录
            </button>
            <button
              type="button"
              onClick={onGoUp}
              disabled={!canGoUp}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              返回上一级
            </button>
          </>
        )}
      </div>
    </div>
  );
}
