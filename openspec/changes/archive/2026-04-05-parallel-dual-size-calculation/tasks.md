## 1. Backend: Rename FileInfo fields

- [x] 1.1 Rename `size` to `size_logical` and `disk_usage` to `size_disk` in `FileInfo` struct in `commands.rs`

## 2. Backend: Update scanner to use new field names

- [x] 2.1 Update `create_file_info_from_metadata` in `scanner.rs` to populate `size_logical` and `size_disk` fields
- [x] 2.2 Update `create_file_info` in `scanner.rs` to use new field names
- [x] 2.3 Update `create_file_info_with_sizes` in `scanner.rs` to use new field names
- [x] 2.4 Update sorting logic in `scanner.rs` to sort by `size_logical`

## 3. Frontend: Update type definitions

- [x] 3.1 Rename `size` to `sizeLogical` and `diskUsage` to `sizeDisk` in `FileInfo` interface in `src/types.ts`

## 4. Frontend: Update App.tsx total size calculation

- [x] 4.1 Update `displayedSize` calculation in `App.tsx` to use `sizeLogical`/`sizeDisk` based on `sizeMode`
- [x] 4.2 Ensure header total size updates when `sizeMode` changes (use `displayedSize` as source)

## 5. Frontend: Update FileList.tsx display logic

- [x] 5.1 Update size display in `FileList.tsx` to use `sizeLogical`/`sizeDisk` based on `sizeMode`

## 6. Build and verify

- [x] 6.1 Run `cargo check` to verify Rust backend compiles
- [x] 6.2 Run `pnpm build` to verify frontend TypeScript compiles
- [x] 6.3 Manually verify toggle updates header total size and list items correctly
