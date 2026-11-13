## ADDED Requirements

### Requirement: Separate Material selector
The Studio SHALL provide a visual Material selector separate from Material authoring. It SHALL default to the left of the Screen workspace and support dragging a reusable Material onto the Screen to create a placement.

#### Scenario: Drag reusable Material
- **WHEN** the user drags a Material from the selector onto the Screen
- **THEN** a placement referencing that Material is created without changing the reusable Material definition

### Requirement: Known-size drag outline
While dragging from the Material selector, the Studio SHALL show an outlined placement preview using the known Material preview dimensions in Screen coordinates. Selector thumbnail scaling SHALL NOT determine placement size.

#### Scenario: Drag under zoom
- **WHEN** the user drags a known-size Material over a zoomed Screen canvas
- **THEN** the outline represents the known preview size under the current canvas transform rather than the thumbnail's display pixels

### Requirement: Independent selector framing
Material authoring SHALL expose a resizable and repositionable preview frame. The selector SHALL transform the framed Material preview to fit its tile. Editing this frame SHALL NOT change Material HTML markup or any existing placement geometry.

#### Scenario: Customize selector frame
- **WHEN** the user resizes or repositions a Material's selector-preview frame
- **THEN** its selector thumbnail uses the chosen framing
- **AND** the Material HTML and existing placement sizes and positions remain unchanged

### Requirement: Dedicated Material workspace
Opening Material authoring SHALL replace the Screen editing workspace with a Material preview canvas and integrated STML source editor rather than a source overlay. A clear return action SHALL restore access to Screen editing.

#### Scenario: Open and leave Material editor
- **WHEN** the user opens a Material for authoring
- **THEN** Material preview and STML source are available in the dedicated workspace
- **AND** a clear action is available to return to Screen editing without discarding edits
