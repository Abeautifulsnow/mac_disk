## ADDED Requirements

### Requirement: Map view renders the current directory as a proportional treemap
The map view SHALL render the children of the currently viewed directory as a squarified treemap in which each rectangle's area is proportional to its size relative to the directory total, using the currently selected size mode.

#### Scenario: Rectangles are proportional to the directory total
- **WHEN** the user opens the map view for a directory
- **THEN** each child is drawn as a rectangle whose area equals its size divided by the directory's total size, and the rectangles tile the full viewport area

#### Scenario: Size-mode switch re-proportions without rescan
- **WHEN** the user toggles between logical and disk size modes
- **THEN** the map SHALL re-query and re-render using the new size dimension without rescanning

### Requirement: Render cap preserves exact proportions via an "other" aggregate
When a directory has more children than the render cap, the map SHALL draw the largest children up to the cap and aggregate the remainder into a single "other" rectangle whose area equals the directory total minus the sum of the drawn children, so proportions remain exact to the whole.

#### Scenario: Large directories keep exact proportions
- **WHEN** a directory has more children than the render cap
- **THEN** the drawn rectangles plus the "other" rectangle SHALL sum to the directory total, and no space is silently misrepresented

### Requirement: Map view supports drill-down and breadcrumb navigation
Clicking a directory rectangle SHALL re-root the map on that directory, and the breadcrumb trail SHALL allow navigating back to any ancestor.

#### Scenario: Clicking a directory drills into it
- **WHEN** the user clicks a directory rectangle
- **THEN** the map SHALL render that directory's children, and the breadcrumbs SHALL reflect the new location

### Requirement: Hover shows item details
Hovering a rectangle SHALL show a tooltip with the item's name, full path, size, and percentage of the current directory total.

#### Scenario: Hover displays details
- **WHEN** the user hovers over a rectangle
- **THEN** a tooltip SHALL display the item's name, path, size in the current size mode, and percentage of the directory total

### Requirement: Rectangles are colored by file type
Each rectangle SHALL be colored according to the file-type category of its item (using the frontend `categorizeFile` taxonomy), with a legend for the categories present.

#### Scenario: Type coloring and legend
- **WHEN** the map renders rectangles
- **THEN** rectangles SHALL be colored by their item's type category, and the legend SHALL list the categories shown

### Requirement: Map view supports multi-selection
The map SHALL support selecting multiple rectangles (single click, shift-click to extend), showing a selection toolbar with the selected count and total size, and SHALL clear the selection when the view re-renders or deletes complete.

#### Scenario: Shift-click extends selection
- **WHEN** the user shift-clicks a rectangle after selecting another
- **THEN** the selection SHALL include both rectangles, and the toolbar SHALL show the combined count and total size

#### Scenario: Selection clears after deletion
- **WHEN** a batch delete completes
- **THEN** the selection SHALL be cleared and deleted items SHALL NOT appear on subsequent renders

### Requirement: Map view renders live during a scan
While a scan is running, the map SHALL render a coarse treemap of the items discovered so far from streaming preview events, switching to the exact map when the scan completes.

#### Scenario: Coarse live map during scan
- **WHEN** a scan is in progress and preview items are available
- **THEN** the map SHALL render the preview items proportionally to their sizes, and SHALL be replaced by the exact query-driven map upon completion
