export interface FileInfo {
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
  name: string;
}

export interface ScanOptions {
  path: string;
  limit?: number | null;
  minSize?: number | null;
  timeoutSeconds?: number | null;
}

export type ScanEvent =
  | {
      type: "progress";
      scanId: string;
      processed: number;
      discovered?: number;
      totalEstimated?: number;
      currentPath: string;
      phase?: "walking" | "processing";
    }
  | { type: "fileFound"; scanId: string; file: FileInfo }
  | { type: "directoryFound"; scanId: string; directory: FileInfo }
  | {
      type: "completed";
      scanId: string;
      filesFound: number;
      directoriesFound: number;
      totalSize: number;
      results: FileInfo[];
    }
  | { type: "cancelled"; scanId: string }
  | { type: "timeout"; scanId: string }
  | { type: "error"; scanId: string; message: string };

export interface ScanProgress {
  scanId: string;
  processed: number;
  discovered?: number;
  totalEstimated?: number;
  currentPath: string;
  percentage?: number;
  phase?: "walking" | "processing";
}
