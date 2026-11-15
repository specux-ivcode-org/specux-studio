## ADDED Requirements

### Requirement: Separate Material selector
The Studio SHALL provide a visual Material selector separate from Material authoring. It SHALL default to the left of the Screen workspace. In Screen mode, clicking a Material SHALL create a placement on the current Screen using the current default state and layer rules. In the Material authoring workspace, clicking a Material SHALL open it for editing, and clicking another Material SHALL switch the editor to that Material without creating a placement. Dragging a Material onto the Screen or using the editor's Place action SHALL also create a placement using the current default state and layer rules.
The selector SHALL display as many Material tiles per row as fit while maintaining a minimum tile width of 125px, adding columns as the panel widens.

#### Scenario: Place a Material from the selector in Screen mode
- **WHEN** the user clicks a Material in the selector while in Screen mode
- **THEN** a placement referencing that Material is created on the current Screen

#### Scenario: Switch Materials while authoring
- **WHEN** the Material editor is open and the user clicks a different Material in the selector
- **THEN** the editor switches to that Material without leaving the Material workspace
- **AND** no Screen placement is created

#### Scenario: Keep the active Material selected
- **WHEN** the Material editor is open and the user clicks the Material already being edited
- **THEN** the current editor remains open without creating a Screen placement

#### Scenario: Drag reusable Material
- **WHEN** the user drags a Material from the selector onto the Screen
- **THEN** a placement referencing that Material is created without changing the reusable Material definition
- **AND** the placement outline is centered under the pointer and uses the current default state and layer rules

#### Scenario: Expand Material selector
- **WHEN** the user widens the Material selector panel enough to fit another minimum-width tile
- **THEN** the selector displays an additional column of Material tiles
- **AND** it keeps the number of columns that fit the panel width

### Requirement: Known-size drag outline
While dragging from the Material selector, the Studio SHALL show an outlined placement preview using the known Material preview dimensions in Screen coordinates. Selector thumbnail scaling SHALL NOT determine placement size.

#### Scenario: Drag under zoom
- **WHEN** the user drags a known-size Material over a zoomed Screen canvas
- **THEN** the outline represents the known preview size under the current canvas transform rather than the thumbnail's display pixels

### Requirement: Full Material selector preview
The selector SHALL display the complete Material preview scaled to fit its tile, using the Material's `preview-size` or its type's default dimensions when `preview-size` is omitted. Selector thumbnail scaling SHALL NOT determine placement size. Legacy `material-previews` crop metadata SHALL be ignored so existing projects remain readable.

#### Scenario: Display a sized Material preview
- **WHEN** a Material has a `preview-size`
- **THEN** the selector displays the complete preview canvas at that size, scaled to fit its tile

#### Scenario: Display a default-sized Material preview
- **WHEN** a Material has no `preview-size`
- **THEN** the selector displays the complete preview using the type's default dimensions

#### Scenario: Ignore legacy selector crop metadata
- **WHEN** a project contains legacy `material-previews` metadata
- **THEN** the selector displays the complete Material preview without applying the saved crop

### Requirement: Dedicated Material workspace
Opening Material authoring SHALL replace the Screen editing workspace with a Material preview canvas above an integrated STML source editor in the existing resizable split layout, rather than a source overlay. On narrow viewports the split SHALL remain vertical and the workspace SHALL remain scrollable. A clear return action and Escape SHALL return to Screen editing without discarding edits.

#### Scenario: Open and leave Material editor
- **WHEN** the user opens a Material for authoring
- **THEN** Material preview and STML source are available in the dedicated workspace
- **AND** a clear action and Escape return to Screen editing without discarding edits

#### Scenario: Escape after opening from project navigation
- **WHEN** the user opens a Material file from Project navigation and presses Escape
- **THEN** the Material workspace closes and the active Screen is restored

#### Scenario: Place a Material from its editor
- **WHEN** the user uses the Place action in the Material editor
- **THEN** a placement referencing that Material is created on the current Screen
- **AND** the reusable Material definition is unchanged

#### Scenario: Arrange Material preview and source
- **WHEN** the Material editing workspace opens
- **THEN** the preview canvas appears above the STML source editor
- **AND** the divider can resize the two areas

#### Scenario: Use Material workspace on narrow viewport
- **WHEN** the Material editing workspace is shown on a narrow viewport
- **THEN** the preview and source remain in a vertical split
- **AND** the workspace can scroll to expose both areas

### Requirement: Preserve navigation when editing from the selector context menu
The selector's Edit Material context-menu action SHALL open the Material editor without switching the left navigation tab or revealing the file in Project navigation.

#### Scenario: Edit a Material without changing navigation
- **WHEN** the user chooses Edit Material from a selector tile's context menu
- **THEN** the Material editor opens
- **AND** the current navigation tab remains active
