export interface PathSegment {
  label: string;
  path: string;
}

/** Strip trailing slashes, preserving the root path itself. */
export function normalizePath(path: string): string {
  if (path === "/") return "/";
  return path.replace(/\/+$/, "");
}

/** Parent of a normalized path; `null` for the root, `"/"` for a top-level path. */
export function getParentPath(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized === "/") return null;
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

/** Build clickable breadcrumb segments from the scan root down to the current path. */
export function buildPathSegments(scanRoot: string, currentPath: string): PathSegment[] {
  const normalizedRoot = normalizePath(scanRoot);
  const normalizedPath = normalizePath(currentPath);

  if (normalizedPath === normalizedRoot) {
    return [{ label: "扫描根目录", path: normalizedRoot }];
  }

  const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
  const parts = relative.split("/").filter(Boolean);
  const segments: PathSegment[] = [{ label: "扫描根目录", path: normalizedRoot }];

  let current = normalizedRoot;
  for (const part of parts) {
    current = current === "/" ? `/${part}` : `${current}/${part}`;
    segments.push({ label: part, path: current });
  }

  return segments;
}
