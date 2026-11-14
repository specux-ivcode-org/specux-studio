## ADDED Requirements

### Requirement: Screen workspace and Project overview
The Studio SHALL retain the Screen canvas as the primary editing workspace in Screen, Workflow, Spec, and Theme modes when a Screen context exists. It SHALL preserve the Project summary page with project-level spec creation. Material editing SHALL use a dedicated replacement workspace.

#### Scenario: Enter workflow from a Screen
- **WHEN** the user opens a workflow from the displayed Screen
- **THEN** the Screen remains visible and the Mermaid graph appears in the bottom dock

#### Scenario: Open Project overview
- **WHEN** the user opens the Project page
- **THEN** the existing project-wide summary remains available with an action to create a project-level spec
- **AND** project-wide workflow creation is not introduced

#### Scenario: Open project spec without Screen
- **WHEN** the user opens a project-level spec from the Project page before selecting a Screen
- **THEN** the project spec opens without requiring or implicitly selecting a Screen

### Requirement: Persistent workspace controls
The workspace SHALL provide a top toolbar with Screen selection/creation, zoom controls, active-mode indication, and controls to reopen closed panels. The Material selector SHALL default to the left and Details SHALL default to the right. The canvas SHALL use a subtle dot grid instead of continuous grid lines.

#### Scenario: Close and reopen side panels
- **WHEN** the user closes the Material selector or Details
- **THEN** the corresponding persistent toolbar control remains available
- **AND** reopening restores access to that panel

#### Scenario: Keep canvas usable on narrow viewport
- **WHEN** the workspace is displayed on a narrow viewport
- **THEN** the Material selector and Details use overlay panels rather than taking horizontal canvas space
- **AND** persistent toolbar controls remain available to open or close them

### Requirement: Contextual Details tabs
Details SHALL provide Properties, States, Layers, and Specs & Workflows tabs. Properties SHALL retain the current selection's property editing, while States and Layers SHALL expose the displayed Screen's state and placement/layer controls.

#### Scenario: Inspect a selected placement
- **WHEN** the user selects a placement on the displayed Screen
- **THEN** Properties exposes that placement's details
- **AND** States and Layers remain associated with the displayed Screen

### Requirement: Resizable dock and mode exits
Workflow and Spec views SHALL use a resizable bottom dock that keeps the Screen visible above it. Closing the active dock view through its close control or Escape SHALL reveal its parent if it is linked, or exit to Screen mode if it is primary.

#### Scenario: Close node spec in Workflow mode
- **WHEN** the user closes a node-spec view opened from the workflow graph
- **THEN** the graph is revealed in the dock and Workflow mode remains active

#### Scenario: Escape from linked workflow
- **WHEN** the user presses workspace-level Escape while viewing a workflow linked from a Spec
- **THEN** the Spec view is revealed and Spec mode remains active

#### Scenario: Close primary dock view
- **WHEN** the user closes the primary Workflow or Spec view
- **THEN** the dock closes and the workspace enters Screen mode

#### Scenario: Resize dock
- **WHEN** the user resizes the bottom dock
- **THEN** the document area changes size while a usable Screen canvas remains visible above it

### Requirement: Theme mode from Screen context
Theme mode SHALL be accessible from the right-click context menu on the empty Screen background and on placements, preserve the displayed Screen, and reuse the current Theme selector and variable controls in Details. Theme color editing SHALL be click-based, not a selector drag interaction. Selecting Screen mode, toggling Theme mode off, or pressing workspace-level Escape SHALL exit Theme mode. Escape SHALL first dismiss/cancel an active dialog or end a focused transient text-edit interaction; it SHALL close a dock view or exit Theme mode only when neither local interaction applies.

#### Scenario: Edit Theme with Screen context
- **WHEN** the user enters Theme mode from the empty Screen background or placement context menu and selects a color to edit
- **THEN** Theme controls appear in Details without replacing the Screen canvas or requiring dragging

#### Scenario: Exit Theme
- **WHEN** the user presses workspace-level Escape in Theme mode
- **THEN** the workspace returns to Screen mode with the Screen still visible

#### Scenario: Escape handles local interaction first
- **WHEN** the user presses Escape while a dialog or transient text-edit interaction is active
- **THEN** that local interaction is dismissed, cancelled, or ended
- **AND** the dock view or Theme mode remains open
