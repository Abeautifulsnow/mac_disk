export interface FileInfo {
  path: string;
  sizeLogical: number;
  is_dir: boolean;
  modified: number | null;
  name: string;
  sizeDisk: number;
  physicalUnique: number;
}

export interface ScanOptions {
  path: string;
  limit?: number | null;
  minSize?: number | null;
  timeoutSeconds?: number | null;
  sizeMode?: "logical" | "disk" | null;
}

export interface UnscannedRegion {
  path: string;
  reason: string;
}

export interface ScanCoverage {
  scannedEntries: number;
  unscannedRegions: UnscannedRegion[];
  partial: boolean;
}

export interface InsightPick {
  path: string;
  sizeLogical: number;
  sizeDisk: number;
}

export interface TypeBucketStat {
  label: string;
  count: number;
  totalLogical: number;
  totalDisk: number;
  samplePath: string;
}

export interface Insights {
  largestDirectory: InsightPick | null;
  largestFile: InsightPick | null;
  recentLargeFile: InsightPick | null;
  staleLargeFile: InsightPick | null;
  topTypes: TypeBucketStat[];
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
      totalSizeLogical: number;
      totalSizeDisk: number;
      physicalUniqueTotal: number;
      scanCoverage: ScanCoverage;
      insights: Insights;
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

export interface IndexSummary {
  filesScanned: number;
  directoriesScanned: number;
  totalSizeLogical: number;
  totalSizeDisk: number;
  physicalUniqueTotal: number;
  insights: Insights;
}

// ---- query contract ----

export type SizeMode = "logical" | "disk";
export type FlatSortMode = "size" | "modified" | "name";
export type FlatKindFilter = "all" | "files" | "dirs";
export type FlatModifiedWindow = "all" | "30d" | "180d" | "365d";

export interface FlatPage {
  items: FileInfo[];
  total: number;
  hasMore: boolean;
}

export interface FlatQueryParams {
  scanId: string;
  minSize?: number | null;
  modifiedWindow?: FlatModifiedWindow;
  searchQuery?: string;
  kind?: FlatKindFilter;
  type?: string | null;
  sort?: FlatSortMode;
  sortDesc?: boolean;
  sizeMode?: SizeMode;
  offset?: number;
  limit?: number;
}

export interface DirSize {
  sizeLogical: number;
  sizeDisk: number;
}

export interface DeleteResult {
  message: string;
  updated: IndexSummary | null;
}
