## ADDED Requirements

### Requirement: Separate Material selector
The Studio SHALL provide a visual Material selector separate from Material authoring. It SHALL default to the left of the Screen workspace and support clicking or dragging a reusable Material onto the Screen to create a placement. Clicking SHALL add the Material at the center of the visible canvas using the current default state and layer rules.

#### Scenario: Click to add Material
- **WHEN** the user clicks a Material in the selector
- **THEN** a placement referencing that Material is created at the center of the visible canvas using the current default state and layer rules
- **AND** the reusable Material definition is unchanged

#### Scenario: Drag reusable Material
- **WHEN** the user drags a Material from the selector onto the Screen
- **THEN** a placement referencing that Material is created without changing the reusable Material definition
- **AND** the placement outline is centered under the pointer and uses the current default state and layer rules

### Requirement: Known-size drag outline
While dragging from the Material selector, the Studio SHALL show an outlined placement preview using the known Material preview dimensions in Screen coordinates. Selector thumbnail scaling SHALL NOT determine placement size.

#### Scenario: Drag under zoom
- **WHEN** the user drags a known-size Material over a zoomed Screen canvas
- **THEN** the outline represents the known preview size under the current canvas transform rather than the thumbnail's display pixels

### Requirement: Independent selector framing
Material authoring SHALL expose a resizable and repositionable preview frame. The selector SHALL transform the framed Material preview to fit its tile. Store custom framing as project presentation metadata in `project.yml`, under `material-previews` keyed by Material ID, in Material canvas coordinates; do not change Material STML or HTML for selector framing. Without custom metadata, the frame SHALL cover the full `preview-size` rectangle or the type's default preview dimensions. Editing this frame SHALL NOT change Material HTML markup or any existing placement geometry.

#### Scenario: Customize selector frame
- **WHEN** the user resizes or repositions a Material's selector-preview frame
- **THEN** its selector thumbnail uses the chosen framing
- **AND** the Material HTML and existing placement sizes and positions remain unchanged

#### Scenario: Default selector frame
- **WHEN** a Material has no custom selector-preview frame
- **THEN** the selector shows the full Material preview using its `preview-size` or type default dimensions

### Requirement: Dedicated Material workspace
Opening Material authoring SHALL replace the Screen editing workspace with a Material preview canvas above an integrated STML source editor in the existing resizable split layout, rather than a source overlay. On narrow viewports the split SHALL remain vertical and the workspace SHALL remain scrollable. A clear return action SHALL restore access to Screen editing.

#### Scenario: Open and leave Material editor
- **WHEN** the user opens a Material for authoring
- **THEN** Material preview and STML source are available in the dedicated workspace
- **AND** a clear action is available to return to Screen editing without discarding edits

#### Scenario: Arrange Material preview and source
- **WHEN** the Material editing workspace opens
- **THEN** the preview canvas appears above the STML source editor
- **AND** the divider can resize the two areas

#### Scenario: Use Material workspace on narrow viewport
- **WHEN** the Material editing workspace is shown on a narrow viewport
- **THEN** the preview and source remain in a vertical split
- **AND** the workspace can scroll to expose both areas
