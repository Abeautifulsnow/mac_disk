## ADDED Requirements

### Requirement: Parallel computation of both size types
The scanner SHALL compute both logical size and disk usage for each file entry in parallel using rayon, without requiring separate passes.

#### Scenario: Parallel chunk processing
- **WHEN** the scanner processes a chunk of directory entries
- **THEN** each entry's metadata.len() and metadata.blocks() are read once and both sizes are computed

#### Scenario: Thread-safe aggregation
- **WHEN** multiple threads accumulate directory sizes
- **THEN** each thread maintains its own accumulator and results are merged via try_reduce

#### Scenario: Fallback for zero blocks
- **WHEN** metadata.blocks() returns 0 for a file
- **THEN** disk usage falls back to the logical size value
