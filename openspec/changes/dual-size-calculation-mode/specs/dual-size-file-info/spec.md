## ADDED Requirements

### Requirement: FileInfo includes logical and disk size fields
The FileInfo structure SHALL include `size_logical` and `size_disk` fields (u64, bytes) representing logical content size and actual disk space consumed by the file or directory.

#### Scenario: FileInfo serialization includes both size fields
- **WHEN** a FileInfo is serialized for transmission to the frontend
- **THEN** the serialized object SHALL include both `sizeLogical` (logical size) and `sizeDisk` (disk usage) fields

#### Scenario: FileInfo deserialization handles both size fields
- **WHEN** the frontend receives a FileInfo object
- **THEN** it SHALL be able to access both `sizeLogical` and `sizeDisk` properties

### Requirement: TypeScript FileInfo interface includes sizeDisk
The TypeScript FileInfo interface SHALL include `sizeLogical: number` and `sizeDisk: number` fields.

#### Scenario: Type-safe access to disk usage
- **WHEN** frontend code accesses a FileInfo object
- **THEN** TypeScript SHALL provide type checking for the `sizeDisk` property
