## ADDED Requirements

### Requirement: Size calculation mode toggle
The application SHALL provide a user-facing toggle to switch between "Logical Size" and "Disk Usage" display modes. The toggle SHALL be accessible from the Scanner component.

#### Scenario: Default mode on first launch
- **WHEN** the application is launched for the first time
- **THEN** the size calculation mode SHALL default to "Logical Size"

#### Scenario: User switches to disk usage mode
- **WHEN** the user selects "Disk Usage" from the toggle
- **THEN** all file sizes in the results list SHALL be displayed using disk usage values

#### Scenario: User switches back to logical size mode
- **WHEN** the user selects "Logical Size" from the toggle
- **THEN** all file sizes in the results list SHALL be displayed using logical size values

### Requirement: Dual size calculation during scan
The scanner SHALL calculate both logical size and disk usage for each file and directory during a single scan pass.

#### Scenario: File size calculation
- **WHEN** a file is encountered during scanning
- **THEN** the scanner SHALL record both `metadata.len()` as logical size and `metadata.blocks() * 512` as disk usage

#### Scenario: Directory size calculation
- **WHEN** a directory's size is computed
- **THEN** the directory's logical size and disk usage SHALL each be the sum of its contained files' respective values

#### Scenario: Fallback when blocks returns zero
- **WHEN** `metadata.blocks()` returns 0 for a file
- **THEN** the disk usage SHALL fall back to the logical size value

### Requirement: Consistent size display across UI
All size displays in the application SHALL reflect the currently selected size calculation mode.

#### Scenario: File list displays correct size
- **WHEN** the file list is rendered
- **THEN** each item's size column SHALL display the value corresponding to the active size mode

#### Scenario: Header total size reflects active mode
- **WHEN** the header displays total scanned size
- **THEN** the total SHALL be calculated using the active size mode's values
