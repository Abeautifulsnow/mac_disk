import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { queryDirSize, querySubtree } from "../scanApi";
import { categorizeFile } from "../scanInsights";
import { aggregateToCap, squarify, type TreemapRect } from "../squarify";
import type { FileInfo } from "../types";

interface TreemapViewProps {
  scanId: string | null;
  viewPath: string;
  sizeMode: "logical" | "disk";
  formatFileSize: (bytes: number) => string;
  isPreview: boolean;
  previewItems: FileInfo[];
  selectedPaths: Set<string>;
  onSelect: (file: FileInfo) => void;
  onToggleSelect: (file: FileInfo) => void;
  onDrill: (path: string) => void;
  onQueryError: (err: unknown) => void;
}

interface Tile {
  file?: FileInfo;
  label?: string;
  value: number;
}

interface HoverInfo {
  x: number;
  y: number;
  name: string;
  path: string;
  size: number;
  pct: number;
}

interface MapError {
  message: string;
}

const PAGE = 200;
const MAX_TILES = 500;

const TYPE_COLORS: Record<string, string> = {
  应用: "#3b82f6",
  视频: "#ef4444",
  图片: "#f59e0b",
  音频: "#8b5cf6",
  文档: "#10b981",
  归档文件: "#14b8a6",
  设计文件: "#ec4899",
  数据库: "#06b6d4",
  磁盘镜像: "#6366f1",
  缓存目录: "#94a3b8",
  "Xcode 缓存": "#64748b",
  "Node 模块": "#84cc16",
  其他: "#9ca3af",
};

function colorFor(tile: Tile): string {
  if (!tile.file) return TYPE_COLORS["其他"];
  const category = categorizeFile(tile.file);
  return (category && TYPE_COLORS[category]) || TYPE_COLORS["其他"];
}

function isIndexNotFoundError(err: unknown): boolean {
  return String(err).includes("IndexNotFound");
}

export default function TreemapView({
  scanId,
  viewPath,
  sizeMode,
  formatFileSize,
  isPreview,
  previewItems,
  selectedPaths,
  onSelect,
  onToggleSelect,
  onDrill,
  onQueryError,
}: TreemapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [items, setItems] = useState<FileInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [error, setError] = useState<MapError | null>(null);

  const getSize = useCallback(
    (file: FileInfo) => (sizeMode === "disk" ? file.sizeDisk : file.sizeLogical),
    [sizeMode],
  );

  // Measure the container; render only once a real size is known.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    const raf = window.requestAnimationFrame(measure);
    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, []);

  // Load children + directory total (exact proportions to the whole).
  useEffect(() => {
    if (!scanId || isPreview) return;
    const sid = scanId;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setItems([]);
      setTotal(0);
      setHover(null);
      try {
        const dirSize = await queryDirSize(sid, viewPath);
        const t = dirSize
          ? sizeMode === "disk"
            ? dirSize.sizeDisk
            : dirSize.sizeLogical
          : 0;
        const children: FileInfo[] = [];
        let offset = 0;
        let loadedSum = 0;
        while (
          children.length < MAX_TILES &&
          (t === 0 || loadedSum < t * 0.99)
        ) {
          const page = await querySubtree(sid, viewPath, sizeMode, offset, PAGE);
          if (page.items.length === 0) break;
          for (const file of page.items) {
            children.push(file);
            loadedSum += getSize(file);
          }
          offset += page.items.length;
          if (!page.hasMore) break;
        }
        if (cancelled) return;
        setTotal(t);
        setItems(children);
      } catch (err) {
        if (isIndexNotFoundError(err)) onQueryError(err);
        if (!cancelled) {
          setError({ message: "地图数据加载失败，请重试或重新扫描。" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId, viewPath, sizeMode, isPreview, getSize, onQueryError]);

  // Build tiles (with an exact "其他" aggregate past the render cap).
  const tiles = useMemo<Tile[]>(() => {
    if (isPreview) {
      return previewItems.map((file) => ({ file, value: getSize(file) }));
    }
    const agg = aggregateToCap(items, getSize, total, MAX_TILES);
    return agg.tiles.map((t) =>
      "label" in t ? { label: t.label, value: t.value } : { file: t as FileInfo, value: getSize(t as FileInfo) },
    );
  }, [items, total, isPreview, previewItems, sizeMode, getSize]);
  const previewTotal = useMemo(
    () => previewItems.reduce((sum, file) => sum + getSize(file), 0),
    [previewItems, getSize],
  );

  // Layout.
  const rects = useMemo(() => {
    if (!size) return [];
    const laid = squarify(
      tiles.map((t, idx) => ({ value: t.value, id: String(idx) })),
      0,
      0,
      size.w,
      size.h,
    );
    return laid.map((r) => ({ ...r, tile: tiles[Number(r.id)] as Tile }));
  }, [tiles, size]);

  const legend = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rects) {
      const tile = r.tile;
      const category = tile.file ? categorizeFile(tile.file) : null;
      seen.add(category || (tile.file ? "其他" : "其他"));
    }
    return Array.from(seen);
  }, [rects]);

  const handleMouseMove = (e: React.MouseEvent, rect: TreemapRect & { tile: Tile }) => {
    const el = containerRef.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const tile = rect.tile;
    const name = tile.file ? tile.file.name : (tile.label ?? "");
    const path = tile.file ? tile.file.path : "";
    const denominator = isPreview ? previewTotal : total;
    const pct = denominator > 0 ? (tile.value / denominator) * 100 : 0;
    setHover({
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
      name,
      path,
      size: tile.value,
      pct,
    });
  };

  const handleClick = (e: React.MouseEvent, rect: TreemapRect & { tile: Tile }) => {
    const tile = rect.tile;
    if (!tile.file) return;
    if (e.shiftKey) {
      onToggleSelect(tile.file);
      return;
    }
    if (tile.file.is_dir) {
      onDrill(tile.file.path);
      return;
    }
    onSelect(tile.file);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-gray-50"
      onMouseLeave={() => setHover(null)}
    >
      {loading && items.length === 0 && !isPreview && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-50/80">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-2 text-sm text-gray-500">正在加载地图...</p>
        </div>
      )}
      {!loading && !isPreview && rects.length === 0 && items.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-500">当前目录没有可展示内容</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-50/90 px-6 text-center">
          <p className="text-sm text-red-600">{error.message}</p>
        </div>
      )}

      {size ? (
        <svg width={size.w} height={size.h} className="block">
        {rects.map((rect) => {
          const tile = rect.tile;
          const isOther = !tile.file;
          const selected = tile.file && selectedPaths.has(tile.file.path);
          const fill = colorFor(tile);
          return (
            <g
              key={rect.id}
              onMouseMove={(e) => handleMouseMove(e, rect)}
              onClick={(e) => handleClick(e, rect)}
              className={isOther ? "" : "cursor-pointer"}
            >
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                fill={fill}
                fillOpacity={selected ? 0.45 : isOther ? 0.35 : 0.9}
                stroke="#ffffff"
                strokeWidth={1}
                rx={1}
              />
              {selected && (
                <rect
                  x={rect.x + 1}
                  y={rect.y + 1}
                  width={Math.max(0, rect.w - 2)}
                  height={Math.max(0, rect.h - 2)}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={2}
                />
              )}
              {rect.w > 40 && rect.h > 24 && (
                <text
                  x={rect.x + 4}
                  y={rect.y + 14}
                  fontSize={11}
                  fill="#ffffff"
                  className="pointer-events-none select-none"
                >
                  {tile.file ? tile.file.name : (tile.label ?? "")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-gray-500">
          正在测量地图区域...
        </div>
      )}

      {legend.length > 0 && (
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5 rounded-lg bg-white/85 px-2 py-1.5 backdrop-blur-sm">
          {legend.map((cat) => (
            <span key={cat} className="flex items-center gap-1 text-[11px] text-gray-700">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: TYPE_COLORS[cat] ?? TYPE_COLORS["其他"] }}
              />
              {cat}
            </span>
          ))}
        </div>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-[280px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            left: size ? Math.min(hover.x, Math.max(0, size.w - 280)) : 0,
            top: hover.y + 12,
          }}
        >
          <div className="font-semibold text-gray-900">{hover.name}</div>
          {hover.path && (
            <div className="mt-0.5 break-all font-mono text-[11px] text-gray-500">
              {hover.path}
            </div>
          )}
          <div className="mt-1 flex justify-between gap-4 text-gray-700">
            <span>{formatFileSize(hover.size)}</span>
            <span className="font-medium text-blue-600">{hover.pct.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
