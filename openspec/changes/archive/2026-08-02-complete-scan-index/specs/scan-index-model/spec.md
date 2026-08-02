## ADDED Requirements

### Requirement: Scan builds a complete queryable index
The scan SHALL build a complete queryable index during traversal instead of returning a top-K truncated result set. The index SHALL retain a record for every regular file and for every directory with its complete aggregate size, independent of any display or pagination limit.

#### Scenario: Files beyond the old display cap remain reachable
- **WHEN** a scan of a directory containing more than 200 qualifying files completes
- **THEN** a query for the 201st and later qualifying files SHALL return them, and no display limit SHALL hide or exclude them

#### Scenario: All directory aggregates are captured
- **WHEN** a scan completes
- **THEN** every directory under the scan root SHALL have a complete aggregate size in the index that includes all descendant files, regardless of the display limit or any filter

### Requirement: Minimum-size filtering is a query/UI filter, not an index-pruning threshold
The `minSize` filter SHALL NOT prune records from the index during traversal. It SHALL be applied only at query time by `query_flat_files`, against the size dimension selected by the current `sizeMode`, so that switching between logical and disk size modes never makes an already-indexed file unreachable.

#### Scenario: A file below the scan-time threshold remains queryable after a mode switch
- **WHEN** a scan completes with a given `minSize` value, and a file qualifies under the logical-size dimension but not the disk-size dimension used at scan time
- **THEN** that file SHALL still be present in the index and SHALL be returned by a `query_flat_files` call that uses the logical-size dimension, without rescanning

#### Scenario: Filtered files still count toward parents
- **WHEN** a flat-view query applies a `minSize` filter that excludes some files
- **THEN** the excluded files' sizes SHALL still be included in their parent directory aggregates and in the scan totals

### Requirement: ScanEvent::Completed carries metadata, coverage, and stats, not a result array
The `ScanEvent::Completed` event SHALL NOT carry a full or truncated result array. It SHALL carry scan metadata (root, scan options), counts, totals, an insights payload, and scan-coverage information, and the frontend SHALL retrieve results through query commands.

#### Scenario: Completed event payload excludes results
- **WHEN** a scan completes
- **THEN** the `Completed` event SHALL contain totals, counts, insights, and coverage, and SHALL NOT contain a `results` array of file records

#### Scenario: Frontend reconstructs the view from queries
- **WHEN** the frontend receives a `Completed` event
- **THEN** it SHALL render the root-level view by querying the index and SHALL NOT depend on a bundled result array

### Requirement: Incomplete scans are reported as partial, never as complete
The scan SHALL record every traversal path that could not be fully scanned, together with its reason, in an `unscannedRegions` list. Reasons SHALL include permission denial, I/O error, metadata-read failure, and symlink loops. The `Completed` event SHALL carry `scanCoverage` with a `partial` flag set when any region is unscanned, and the UI SHALL clearly mark a partial scan as such instead of presenting complete statistics.

#### Scenario: Permission-denied directory is recorded, not silently skipped
- **WHEN** a directory cannot be read due to missing permissions during a scan
- **THEN** its path and a `permission-denied` reason SHALL appear in `unscannedRegions`, the `partial` flag SHALL be set, and the UI SHALL indicate the scan was partial

#### Scenario: Unscanned regions are deduplicated to top-level
- **WHEN** multiple nested paths under one unreadable directory fail during a scan
- **THEN** only the topmost failing path SHALL be recorded, and descendants of an already-recorded region SHALL NOT be recorded separately

### Requirement: Deleting an item keeps the index consistent
When a path is successfully moved to the Trash, the index for that scan SHALL be updated atomically: the node and all its descendants SHALL be removed from query results, ancestor aggregates and totals SHALL be reduced, and totals and insights SHALL be recomputed. Deleted items SHALL NOT reappear in later pages or re-expanded subtrees.

#### Scenario: Trashed item does not reappear after pagination
- **WHEN** a user moves an item to the Trash and then loads the next page or re-expands a parent directory
- **THEN** the trashed item and its descendants SHALL NOT appear in any query result

#### Scenario: Ancestor aggregates update after deletion
- **WHEN** a directory with descendants is moved to the Trash
- **THEN** the aggregate sizes of its ancestors, the scan totals, and the insights SHALL be reduced by the removed sizes

### Requirement: Scan results are labeled as a point-in-time snapshot
The index SHALL reflect the disk state at the time the scan completed. External file changes made outside the app SHALL NOT be reflected until a rescan, and the UI SHALL state this explicitly.

#### Scenario: External changes require a rescan
- **WHEN** files are added or removed outside the app after a scan completes
- **THEN** the existing index SHALL NOT reflect those changes, and the UI SHALL state that results reflect the scan-time snapshot and a rescan is needed for changes
