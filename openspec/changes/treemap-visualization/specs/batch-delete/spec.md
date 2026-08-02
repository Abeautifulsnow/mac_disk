## ADDED Requirements

### Requirement: delete_paths moves multiple paths to the Trash
The `delete_paths` command SHALL move a list of paths to the Trash, validating each path for existence and system-path protection before any deletion.

#### Scenario: Multiple items are moved to the Trash
- **WHEN** a user confirms deleting a set of selected paths
- **THEN** each path SHALL be moved to the Trash, and the response SHALL report success with an updated index summary

### Requirement: Sensitive paths abort the whole batch
If any path in the batch is a protected system path, the `delete_paths` command SHALL reject the entire batch without deleting anything.

#### Scenario: Protected path blocks the batch
- **WHEN** a batch contains a protected system path
- **THEN** the command SHALL fail and delete none of the paths in the batch

### Requirement: Batch delete keeps the index consistent
After a successful batch delete, the index SHALL remove all deleted paths and their descendants, recompute aggregates, totals, and insights once, and deleted items SHALL NOT reappear in subsequent queries.

#### Scenario: Deleted items do not reappear
- **WHEN** a batch delete completes and the affected directory is re-queried
- **THEN** none of the deleted items or their descendants SHALL appear in query results, and ancestor aggregates and insights SHALL reflect the removal

### Requirement: Partial failures remove only the successful items
If some paths in a batch fail to move to the Trash, the command SHALL report the failed paths, remove the successfully trashed items from the index, and leave the failed items in the index, so the index reflects what is actually on disk.

#### Scenario: Failed item remains in the index
- **WHEN** one path in a batch fails to move to the Trash while others succeed
- **THEN** the response SHALL list the failed path, the successfully trashed items SHALL be removed from the index, and the failed item SHALL remain in the index
