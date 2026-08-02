import type { FileInfo } from "./types";

export type SizeMode = "logical" | "disk";

export function getSizeValue(file: FileInfo, sizeMode: SizeMode) {
  return sizeMode === "disk" ? file.sizeDisk : file.sizeLogical;
}

/**
 * Frontend mirror of the Rust type taxonomy (src-tauri/src/index.rs
 * `categorize_file`). Kept for interactive type badges; the authoritative
 * bucket computation happens server-side over the complete index.
 */
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
