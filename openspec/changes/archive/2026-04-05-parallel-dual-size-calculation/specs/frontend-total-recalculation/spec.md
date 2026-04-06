## ADDED Requirements

### Requirement: Frontend recalculates total size on mode switch
When the user switches between "logical" and "disk" size modes, the header total size SHALL be recalculated immediately from the loaded file list without re-scanning.

#### Scenario: Switch from logical to disk mode
- **WHEN** the user switches sizeMode from "logical" to "disk"
- **THEN** the header total size is recalculated as the sum of all files' sizeDisk values

#### Scenario: Switch from disk to logical mode
- **WHEN** the user switches sizeMode from "disk" to "logical"
- **THEN** the header total size is recalculated as the sum of all files' sizeLogical values

#### Scenario: No scan results loaded
- **WHEN** the file list is empty
- **THEN** the header total size displays 0 regardless of sizeMode

### Requirement: File list displays size based on active mode
Each file/directory in the list SHALL display its size according to the currently active sizeMode.

#### Scenario: Logical mode active
- **WHEN** sizeMode is "logical"
- **THEN** each item displays its sizeLogical value formatted in human-readable units

#### Scenario: Disk mode active
- **WHEN** sizeMode is "disk"
- **THEN** each item displays its sizeDisk value formatted in human-readable units
