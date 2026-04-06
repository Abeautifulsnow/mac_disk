## 1. Backend Data Model Changes

- [x] 1.1 Add `disk_usage` field to `FileInfo` struct in `commands.rs` with serde serialization as `diskUsage`
- [x] 1.2 Add `use std::os::unix::fs::MetadataExt` import to `scanner.rs` for accessing `blocks()` method

## 2. Backend Scanner Logic Updates

- [x] 2.1 Modify `create_file_info_from_metadata` in `scanner.rs` to calculate and populate `disk_usage` field using `metadata.blocks() * 512`
- [x] 2.2 Add fallback logic: if `metadata.blocks() == 0`, set `disk_usage` equal to `size` (logical size)
- [x] 2.3 Update directory size accumulation in `scanner.rs` to track both logical size and disk usage in `dir_sizes` HashMap (consider renaming or using a second HashMap for disk usage)
- [x] 2.4 Update `create_file_info` function to accept and pass through `disk_usage` parameter

## 3. Frontend Type Definitions

- [x] 3.1 Add `diskUsage: number` field to `FileInfo` interface in `src/types.ts`

## 4. Frontend State Management

- [x] 4.1 Add `sizeMode` state (`"logical" | "disk"`) to `App.tsx` with default value `"logical"`
- [x] 4.2 Pass `sizeMode` and `setSizeMode` as props to `Scanner` component
- [x] 4.3 Pass `sizeMode` as prop to `FileList` component

## 5. Frontend UI Components

- [x] 5.1 Add size calculation mode toggle UI (segmented control or radio buttons) to `Scanner.tsx`
- [x] 5.2 Update `FileList.tsx` to display size based on `sizeMode` prop (use `file.size` for logical, `file.diskUsage` for disk usage)
- [x] 5.3 Update header total size calculation in `App.tsx` to respect active `sizeMode`

## 6. Testing & Verification

- [x] 6.1 Run `cargo build` to verify Rust backend compiles successfully
- [x] 6.2 Run `pnpm build` to verify frontend TypeScript compiles successfully
- [x] 6.3 Run `pnpm tauri dev` and verify toggle switches between logical size and disk usage correctly
- [x] 6.4 Verify disk usage values match `du -sh` output for test directories
