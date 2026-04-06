## MODIFIED Requirements

### Requirement: FileInfo exposes both size types with unified naming
The FileInfo structure SHALL expose size_logical and size_disk fields (renamed from size and disk_usage) to clearly distinguish the two calculation modes.

#### Scenario: FileInfo serialization
- **WHEN** a FileInfo is serialized for frontend communication
- **THEN** it includes sizeLogical and sizeDisk fields (camelCase: sizeLogical, sizeDisk)

#### Scenario: Backward compatibility
- **WHEN** existing code references the old field names
- **THEN** the old fields are removed and all references are updated to use the new names

### Requirement: Sorting uses logical size by default
The scanner SHALL sort results by size_logical in descending order, regardless of the active sizeMode.

#### Scenario: Default sort order
- **WHEN** scan results are returned
- **THEN** they are sorted by size_logical in descending order
