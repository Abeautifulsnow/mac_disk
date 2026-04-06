## ADDED Requirements

### Requirement: FileInfo includes disk_usage field
The FileInfo structure SHALL include a `disk_usage` field (u64, bytes) representing the actual disk space consumed by the file or directory.

#### Scenario: FileInfo serialization includes disk_usage
- **WHEN** a FileInfo is serialized for transmission to the frontend
- **THEN** the serialized object SHALL include both `size` (logical size) and `diskUsage` (disk usage) fields

#### Scenario: FileInfo deserialization handles disk_usage
- **WHEN** the frontend receives a FileInfo object
- **THEN** it SHALL be able to access both `size` and `diskUsage` properties

### Requirement: TypeScript FileInfo interface includes diskUsage
The TypeScript FileInfo interface SHALL include a `diskUsage: number` field.

#### Scenario: Type-safe access to disk usage
- **WHEN** frontend code accesses a FileInfo object
- **THEN** TypeScript SHALL provide type checking for the `diskUsage` property
