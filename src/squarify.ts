/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk 2000).
 *
 * Produces rectangles whose areas are proportional to the input values,
 * tiling a given container with good aspect ratios. No dependencies.
 */

export interface SquarifyItem {
  value: number;
  id: string;
}

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
}

/** Minimum tile area (in square units) — smaller items are aggregated by the caller. */
export const MIN_TILE_AREA = 8;

/** Layout `items` into `(x, y, w, h)` using normalized proportions. */
export function squarify(
  items: SquarifyItem[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapRect[] {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (total <= 0 || w <= 0 || h <= 0) return [];

  const normalized = items
    .filter((i) => i.value > 0)
    .map((i) => ({ ...i, value: i.value / total }))
    .sort((a, b) => b.value - a.value);

  const out: TreemapRect[] = [];
  squarifyInner(normalized, x, y, w, h, w * h, out);
  return out;
}

function squarifyInner(
  items: SquarifyItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  totalArea: number,
  out: TreemapRect[],
) {
  let i = 0;
  while (i < items.length) {
    if (w <= 0.001 || h <= 0.001) break;
    const shortSide = Math.min(w, h);
    let rowSum = 0;
    const rowStart = i;
    let prevWorst = 0;
    let first = true;

    while (i < items.length) {
      const candidateArea = items[i].value * totalArea;
      const newRowSum = rowSum + candidateArea;
      const worst = worstAspect(items, rowStart, i + 1, totalArea, shortSide, newRowSum);
      if (first || worst <= prevWorst) {
        rowSum = newRowSum;
        prevWorst = worst;
        first = false;
        i++;
      } else {
        break;
      }
    }

    const thickness = rowSum / shortSide;
    // The row runs along the short side. Taller-than-wide: items laid
    // horizontally across the width; wider-than-tall: items laid vertically.
    const horizontal = h > w;
    let pos = horizontal ? x : y;
    for (let j = rowStart; j < i; j++) {
      const len = (items[j].value * totalArea) / thickness;
      if (horizontal) {
        out.push({ id: items[j].id, x: pos, y, w: len, h: thickness });
      } else {
        out.push({ id: items[j].id, x, y: pos, w: thickness, h: len });
      }
      pos += len;
    }

    if (horizontal) {
      y += thickness;
      h -= thickness;
    } else {
      x += thickness;
      w -= thickness;
    }
  }
}

function worstAspect(
  items: SquarifyItem[],
  start: number,
  end: number,
  totalArea: number,
  shortSide: number,
  rowSum: number,
): number {
  let worst = 0;
  for (let j = start; j < end; j++) {
    const itemArea = items[j].value * totalArea;
    const length = itemArea / (rowSum / shortSide);
    const thickness = rowSum / shortSide;
    const asp = Math.max(length, thickness) / Math.min(length, thickness);
    if (asp > worst) worst = asp;
  }
  return worst;
}

/**
 * Split an already-sorted (descending) list of values into "top tiles" plus one
 * aggregate "other" item, so the rendered map stays bounded while proportions
 * remain exact to the total.
 *
 * `getValue` extracts the numeric weight (in the current size mode) from a
 * list item. Items are taken until `cap` tiles or the loaded sum reaches
 * `total * ratioThreshold`. The remainder (if any) becomes an "其他" item.
 */
export function aggregateToCap<T>(
  items: T[],
  getValue: (item: T) => number,
  total: number,
  cap: number,
  ratioThreshold = 0.99,
  otherLabel = "其他",
): { tiles: (T | { label: string; value: number })[]; otherValue: number } {
  const result: (T | { label: string; value: number })[] = [];
  let loadedSum = 0;
  for (const item of items) {
    if (result.length >= cap) break;
    if (total > 0 && loadedSum >= total * ratioThreshold) break;
    result.push(item);
    loadedSum += getValue(item);
  }
  const otherValue = Math.max(0, total - loadedSum);
  if (otherValue > 0 && result.length > 0) {
    result.push({ label: otherLabel, value: otherValue });
  }
  return { tiles: result, otherValue };
}
