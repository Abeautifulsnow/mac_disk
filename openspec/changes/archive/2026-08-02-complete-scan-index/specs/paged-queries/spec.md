## ADDED Requirements

### Requirement: query_flat_files returns all matching records with pagination
The `query_flat_files` command SHALL apply size, modified-time, search, kind, and type filters server-side over the complete index and SHALL return all matching records in pages, never a truncated subset. It SHALL accept a `sizeMode` parameter that selects which size dimension filters and sorting use.

#### Scenario: Size filter returns every match
- **WHEN** a user filters the flat view to show items of at least a given size
- **THEN** `query_flat_files` SHALL return every matching record across all pages, including records beyond any former display cap

#### Scenario: Kind filter distinguishes files, directories, or both
- **WHEN** a user requests files only, directories only, or both in the flat view
- **THEN** `query_flat_files` SHALL apply the `kind` filter server-side and return only the requested records

#### Scenario: Type filter applies across all pages
- **WHEN** a user filters the flat view by a file-type category
- **THEN** every record matching that category SHALL be returned across all pages, and no record SHALL be excluded because it appeared on a page the frontend has not loaded

#### Scenario: Size-mode switch changes the filter dimension without rescan
- **WHEN** a user toggles between logical and disk size modes after a scan
- **THEN** `query_flat_files` SHALL be reissued with the new `sizeMode`, and filtering and sorting SHALL use that dimension without rescanning

#### Scenario: Search and modified-time filters apply server-side
- **WHEN** a user searches by name/path or filters by a modified-time window in the flat view
- **THEN** the filter SHALL be applied over the complete index and the response SHALL contain every matching record

### Requirement: Pagination is bounded, stable, and complete
Pagination SHALL be bounded by a maximum page size, SHALL use a stable sort with a deterministic tie-breaker so pages have no duplicates or gaps even with many equal-sized records, and SHALL expose the total match count and a continuation indicator.

#### Scenario: Pagination exposes total and continuation
- **WHEN** a flat-view query matches more records than the page size
- **THEN** the response SHALL include the total match count and a continuation indicator, and successive pages SHALL return the remaining matches without duplicates or gaps

#### Scenario: Many equal-sized records paginate stably
- **WHEN** many records share the same sort key
- **THEN** successive pages SHALL not repeat or omit any record, using a deterministic tie-breaker

#### Scenario: Invalid pagination parameters are rejected
- **WHEN** a query specifies a negative offset or a page size outside the allowed range
- **THEN** the command SHALL return a pagination error rather than silently clamping or returning arbitrary data

#### Scenario: Offset beyond the total returns an empty page
- **WHEN** a query specifies an offset greater than or equal to the total match count
- **THEN** the command SHALL return an empty item list with the correct total and `hasMore` set to false

### Requirement: query_subtree returns a directory's children on demand
The `query_subtree` command SHALL return the children of a given directory (subdirectories with aggregate sizes, and files), paginated and sorted by size in descending order, with no `minSize` pruning.

#### Scenario: Expanding a directory loads its children
- **WHEN** a user expands a directory in the tree view
- **THEN** `query_subtree` SHALL return that directory's complete children, sorted by size, without the frontend holding the full tree

### Requirement: query_dir_size returns aggregates without children
The `query_dir_size` command SHALL return the logical and disk aggregate sizes for a directory without returning its child records.

#### Scenario: Breadcrumb total without listing children
- **WHEN** a user navigates into a directory via breadcrumbs
- **THEN** `query_dir_size` SHALL provide the directory's aggregate sizes without shipping its children

### Requirement: Stale or evicted indexes have a defined recovery path
If a `scanId` refers to an index that no longer exists (for example, evicted from the LRU cache), query commands SHALL return an index-not-found error, and the frontend SHALL prompt the user to rescan.

#### Scenario: Querying an evicted index prompts a rescan
- **WHEN** the frontend queries a `scanId` whose index has been evicted
- **THEN** the command SHALL return an index-not-found error, and the UI SHALL show a message that the scan results are no longer available with a rescan action
