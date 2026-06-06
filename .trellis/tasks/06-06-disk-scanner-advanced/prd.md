# Disk Scanner Advanced Implementation

## Goal

Upgrade the macOS disk scanner from a working large-file browser into a more reliable foundation for advanced disk analysis. The task started with contract/statistics stabilization and then extended into a focused scanner-core refactor: replace full-entry buffering with streaming traversal and bounded top-K file retention, while preserving the cross-layer event contract.

## What I Already Know

* The user asked to review the proposed advanced plan and implement it if sound.
* The existing app is a Tauri 2 + Rust backend with React 18 + TypeScript + Vite frontend.
* Backend scanning lives in `src-tauri/src/scanner.rs` and now uses `WalkDir` for streaming traversal, incremental directory aggregation, and bounded file retention for top-K results.
* Tauri command and event contracts live in `src-tauri/src/commands.rs`.
* Frontend event handling and aggregate scan state live in `src/App.tsx`.
* Scan controls live in `src/components/Scanner.tsx`.
* Tree result presentation lives in `src/components/FileList.tsx`.
* Current code already supports scan progress, cancel, timeout, Finder reveal, move-to-trash, tree view, and logical-vs-disk size mode.
* Existing OpenSpec docs for dual size mode mention `diskUsage`, but current code uses `sizeLogical` and `sizeDisk`.
* Git worktree has unrelated `.DS_Store` modifications and many untracked Trellis/bootstrap files; avoid reverting user/unrelated work.

## Assumptions

* Existing user-facing behavior should remain compatible unless a change clarifies incorrect or misleading semantics.
* The current field names `sizeLogical` and `sizeDisk` are acceptable if documented consistently across backend, frontend, and OpenSpec.

## Requirements

* Define and document the scan result data contract across Rust events and TypeScript types.
* Clarify scan statistic semantics so the UI distinguishes scan totals from returned/displayed result totals.
* Keep logical size and disk usage behavior consistent across sorting, filtering, totals, details, and delete confirmation.
* Add focused Rust tests for scanner aggregation, size mode filtering/sorting, ancestor inclusion, and sensitive path checks where feasible.
* Reduce scanner memory pressure by removing the full `Vec<DirEntry>` buffering step.
* Preserve current progress semantics while making traversal incremental, and expose provisional preview results during scanning.
* Add focused frontend tests or extract testable pure helpers for tree building/stat calculation if the existing tooling can support it without large dependency churn.
* Align README/OpenSpec notes with the actual implemented field names and behavior.
* Preserve existing app flows: scan, cancel, timeout, show in Finder, copy path, rescan directory, and move to trash.

## Acceptance Criteria

* [x] Backend `ScanEvent::Completed` exposes unambiguous total scan sizes and result counts.
* [x] Frontend header labels no longer imply that limited returned results are the same thing as total scanned size.
* [x] `src/types.ts` matches the serialized Rust contract.
* [x] Documentation no longer refers to stale `diskUsage` contract names when the actual app uses `sizeDisk`.
* [x] `cargo test` passes for scanner/command unit tests.
* [x] Scan execution no longer depends on buffering the full `WalkDir` entry list before processing files.
* [x] `pnpm build` passes.
* [x] Existing delete protection behavior remains intact.

## Definition of Done

* Tests added/updated for the changed behavior.
* TypeScript build and Rust tests/build pass.
* Docs/spec notes updated if behavior or contract semantics change.
* No unrelated `.DS_Store` or bootstrap/Trellis changes are reverted.
* Rollback is straightforward: changes are limited to contract/stat/test/docs work for this slice.

## Out of Scope

* Persistent scan history.
* File type/category analytics dashboard.
* Cleanup recommendations for caches/build artifacts.
* Virtualized table rendering or large UI redesign.
* New third-party dependencies unless the existing test setup makes them necessary.

## Technical Approach

Implemented approach:

1. Audit current backend-to-frontend event/data flow.
2. Add or refine contract structures so `totalSizeLogical` / `totalSizeDisk` mean total scanned bytes, while displayed result length remains separate.
3. Update UI copy and state names where misleading.
4. Add focused backend tests using temporary directories under the test runtime.
5. Replace full-entry buffering with streaming traversal and top-K file retention under `limit`.
6. Keep progress events compatible by reporting `"walking"` during traversal and `"processing"` during final result assembly.
7. Restore `fileFound` / `directoryFound` as provisional preview events during scanning.
8. Update README/OpenSpec docs to match actual behavior.

## Decision (ADR-lite)

**Context**: The earlier advanced plan includes engine, product, safety, and engineering improvements. Implementing everything in one pass would mix correctness fixes, architecture changes, and product expansion.

**Decision**: Complete the contract/statistics/testing/documentation slice first, then extend the same task with a narrowly scoped scanner-core refactor for streaming traversal and bounded top-K retention.

**Consequences**: This keeps the product-facing surface stable while eliminating the largest memory-pressure issue in the scanner. The UI now receives provisional preview items during scanning, but richer analytics views and fully virtualized incremental result management are still out of scope.

## Open Questions

* Resolved: user confirmed implementation should proceed with the recommended first-stage foundation slice.

## Technical Notes

* Relevant files inspected:
  * `README.md`
  * `package.json`
  * `src/types.ts`
  * `src/App.tsx`
  * `src/components/Scanner.tsx`
  * `src/components/FileList.tsx`
  * `src/components/ConfirmDialog.tsx`
  * `src-tauri/src/commands.rs`
  * `src-tauri/src/scanner.rs`
  * `src-tauri/src/lib.rs`
  * `openspec/changes/dual-size-calculation-mode/*`
* Cross-layer risk: Rust serde field names, TypeScript field names, UI labels, docs, and tests must agree.
* Current frontend spec layer is skeletal; use cross-layer thinking guide for this task.
