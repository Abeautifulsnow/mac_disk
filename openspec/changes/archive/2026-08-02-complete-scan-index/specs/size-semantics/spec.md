## ADDED Requirements

### Requirement: FileInfo exposes three explicit size dimensions
Every `FileInfo` SHALL expose `sizeLogical` (content bytes), `sizeDisk` (allocated disk space, blocks × 512), and `physicalUnique` (allocated bytes after hard-link deduplication) fields.

#### Scenario: Serialization includes all three fields
- **WHEN** a `FileInfo` is serialized for transmission to the frontend
- **THEN** it SHALL include `sizeLogical`, `sizeDisk`, and `physicalUnique`

#### Scenario: physicalUnique deduplicates hard-linked inodes
- **WHEN** two paths within one scan index reference the same inode
- **THEN** `physicalUnique` SHALL count that inode's allocated bytes once, and the subsequent occurrence SHALL be zero

### Requirement: Disk size never falls back to logical size when blocks are zero
When the block count is zero (`blocks == 0`), `sizeDisk` and `physicalUnique` SHALL be reported as zero allocated bytes, and SHALL NOT fall back to the logical size.

#### Scenario: Sparse or empty file occupancy is not overstated
- **WHEN** a file has a large logical size but zero allocated blocks
- **THEN** its `sizeDisk` and `physicalUnique` SHALL be `0` rather than inflated to the logical size

#### Scenario: UI renders zero allocated bytes honestly
- **WHEN** a record has `sizeDisk` equal to zero while its logical size is larger
- **THEN** the UI SHALL display the zero allocated-bytes value rather than substituting the logical size

### Requirement: physicalUnique is limited to hard-link deduplication
The `physicalUnique` field SHALL represent allocated bytes after hard-link deduplication only. It SHALL NOT claim to represent copy-on-write (APFS clone) deduplication or total true physical occupancy.

#### Scenario: Documentation and copy use the limited definition
- **WHEN** the app or its documentation describes `physicalUnique`
- **THEN** it SHALL describe it as hard-link-deduplicated allocated bytes and SHALL NOT claim APFS clone deduplication

### Requirement: Directory sizes use additive semantics only
Directory sizes SHALL be presented using additive semantics (`sizeLogical` or `sizeDisk`). The deduplicated `physicalUnique` value SHALL NOT be presented as a summable directory size.

#### Scenario: Directory sizes are additive
- **WHEN** the UI displays a directory size
- **THEN** it SHALL use `sizeLogical` or `sizeDisk`, and SHALL NOT display `physicalUnique` as the directory's size

#### Scenario: physicalUnique is surfaced only at root or file level
- **WHEN** the UI shows physical-occupancy information
- **THEN** it SHALL do so only for the scan root/volume level (as the physical-unique total) or for a single file, never as a directory-size column
