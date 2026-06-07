import type { FileInfo } from "./types";

export type SizeMode = "logical" | "disk";

export interface TypeBucket {
  label: string;
  totalSize: number;
  count: number;
  samplePath: string;
}

export function getSizeValue(file: FileInfo, sizeMode: SizeMode) {
  return sizeMode === "disk" ? file.sizeDisk : file.sizeLogical;
}

export function categorizeFile(item: FileInfo): string | null {
  const lowerName = item.name.toLowerCase();
  const lowerPath = item.path.toLowerCase();

  if (item.is_dir) {
    if (lowerName.endsWith(".app")) return "应用";
    if (lowerName === "node_modules") return "Node 模块";
    if (lowerPath.includes("/library/caches/") || lowerName === "caches") {
      return "缓存目录";
    }
    if (lowerPath.includes("/deriveddata/")) return "Xcode 缓存";
    return null;
  }

  const ext = lowerName.includes(".") ? lowerName.split(".").pop() ?? "" : "";

  if (["app", "dmg", "pkg"].includes(ext)) return "应用";
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "xz"].includes(ext)) {
    return "归档文件";
  }
  if (["mov", "mp4", "mkv", "avi", "m4v", "webm"].includes(ext)) {
    return "视频";
  }
  if (["jpg", "jpeg", "png", "gif", "heic", "webp", "svg"].includes(ext)) {
    return "图片";
  }
  if (["mp3", "wav", "flac", "aac", "m4a"].includes(ext)) return "音频";
  if (["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "pages"].includes(ext)) {
    return "文档";
  }
  if (["psd", "ai", "sketch", "fig"].includes(ext)) return "设计文件";
  if (["sql", "db", "sqlite", "sqlite3"].includes(ext)) return "数据库";
  if (["iso"].includes(ext)) return "磁盘镜像";
  return "其他文件";
}

export function buildTypeBuckets(files: FileInfo[], sizeMode: SizeMode) {
  const typeBuckets = new Map<string, TypeBucket>();

  for (const item of files) {
    const category = categorizeFile(item);
    if (!category) continue;

    const current = typeBuckets.get(category);
    const itemSize = getSizeValue(item, sizeMode);
    if (current) {
      current.totalSize += itemSize;
      current.count += 1;
      continue;
    }

    typeBuckets.set(category, {
      label: category,
      totalSize: itemSize,
      count: 1,
      samplePath: item.path,
    });
  }

  return Array.from(typeBuckets.values()).sort(
    (a, b) => b.totalSize - a.totalSize || a.label.localeCompare(b.label),
  );
}
