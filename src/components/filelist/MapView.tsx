import { useMemo } from "react";
import { getSizeValue, type SizeMode } from "../../scanInsights";
import type { FileInfo } from "../../types";
import TreemapView from "../TreemapView";
import ResultsToolbar, { type ViewMode } from "./ResultsToolbar";

const LIST_PANEL_HEIGHT = "calc(100vh - 320px)";
const LIST_PANEL_MIN_HEIGHT = 420;

interface MapViewProps {
  scanId: string | null;
  viewPath: string;
  sizeMode: SizeMode;
  isPreview: boolean;
  previewItems: FileInfo[];
  selectedPaths: Set<string>;
  onSelect: (file: FileInfo) => void;
  onToggleSelect: (file: FileInfo) => void;
  onDrill: (path: string) => void;
  onIndexStale: () => void;
  onViewModeChange: (mode: ViewMode) => void;
}

/** Disk map over the current directory (final, query-driven). */
export default function MapView({
  scanId,
  viewPath,
  sizeMode,
  isPreview,
  previewItems,
  selectedPaths,
  onSelect,
  onToggleSelect,
  onDrill,
  onIndexStale,
  onViewModeChange,
}: MapViewProps) {
  const previewSorted = useMemo(
    () =>
      [...previewItems].sort((a, b) => {
        const delta = getSizeValue(b, sizeMode) - getSizeValue(a, sizeMode);
        return delta !== 0 ? delta : a.path.localeCompare(b.path);
      }),
    [previewItems, sizeMode],
  );

  return (
    <div>
      <ResultsToolbar
        viewMode="map"
        onViewModeChange={onViewModeChange}
        meta="地图视图：单击目录下钻，Shift+单击多选"
      />
      <div style={{ height: LIST_PANEL_HEIGHT, minHeight: `${LIST_PANEL_MIN_HEIGHT}px` }}>
        <TreemapView
          scanId={scanId}
          viewPath={viewPath}
          sizeMode={sizeMode}
          isPreview={isPreview}
          previewItems={previewSorted}
          selectedPaths={selectedPaths}
          onSelect={onSelect}
          onToggleSelect={onToggleSelect}
          onDrill={onDrill}
          onQueryError={onIndexStale}
        />
      </div>
    </div>
  );
}
