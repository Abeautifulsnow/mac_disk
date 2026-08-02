import { invoke } from "@tauri-apps/api/core";
import type {
  DeleteResult,
  DirSize,
  FlatPage,
  FlatQueryParams,
  SizeMode,
} from "./types";

export function queryFlatFiles(params: FlatQueryParams): Promise<FlatPage> {
  return invoke("query_flat_files", params as unknown as Record<string, unknown>);
}

export function querySubtree(
  scanId: string,
  path: string,
  sizeMode: SizeMode,
  offset: number,
  limit: number,
): Promise<FlatPage> {
  return invoke("query_subtree", { scanId, path, sizeMode, offset, limit });
}

export function queryDirSize(
  scanId: string,
  path: string,
): Promise<DirSize | null> {
  return invoke("query_dir_size", { scanId, path });
}

export function deletePath(
  path: string,
  scanId: string | null,
): Promise<DeleteResult> {
  return invoke("delete_path", { path, scanId });
}
