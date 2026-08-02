## ADDED Requirements

### Requirement: Flat-view filters operate on complete data
The flat-view size, modified-time, search, kind, and type filters SHALL operate on the complete index and return all matches, never the top-K subset.

#### Scenario: Modified-time filter covers all matches
- **WHEN** a user filters the flat view to items modified within a window
- **THEN** every record matching the window SHALL be returned across all pages, including records beyond any former display cap

#### Scenario: Search covers the full index
- **WHEN** a user searches the flat view by name or path
- **THEN** every record whose name or path matches SHALL be returned, regardless of its size rank

#### Scenario: Type filter applies across every page
- **WHEN** a user filters the flat view by a file-type category
- **THEN** every record in that category SHALL be returned across all pages, and the category filter SHALL NOT be limited to the currently loaded page

### Requirement: Scan insights are computed from the complete index
The largest-directory, largest-file, recent-large-file, stale-large-file, and file-type-bucket insights SHALL be computed over the complete index, not over a truncated result set.

#### Scenario: Type buckets reflect the true distribution
- **WHEN** a scan completes
- **THEN** the file-type-bucket totals SHALL be computed over all records in the index so that categories with many small files are not distorted by truncation

#### Scenario: Largest selections consider every record
- **WHEN** a scan completes
- **THEN** the largest-directory and largest-file insights SHALL consider all records in the index

### Requirement: Partial scans do not present as complete statistics
When a scan is partial (any region is unscanned), the insights and totals SHALL be presented together with a clear indication that the scan was partial, and SHALL NOT be presented as complete statistics.

#### Scenario: Partial scan is labeled
- **WHEN** a scan completes with unscanned regions
- **THEN** the UI SHALL show a partial-scan indicator next to the totals and insights, with the number of unscanned regions and a way to view them
