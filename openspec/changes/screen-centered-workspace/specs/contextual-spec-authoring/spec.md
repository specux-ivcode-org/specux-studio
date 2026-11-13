## ADDED Requirements

### Requirement: Screen and placement spec shortcuts
In Screen mode, double-clicking a placement SHALL open its Element spec, creating it if absent. Double-clicking empty canvas background SHALL open the active Screen's spec, creating it if absent. Equivalent explicit open/create actions SHALL be available from Details. These actions SHALL open the spec in Spec mode.

#### Scenario: Open placement spec
- **WHEN** the user double-clicks a placement with an existing Element spec in Screen mode
- **THEN** that spec opens in the bottom dock without creating another spec

#### Scenario: Create Screen spec
- **WHEN** the user double-clicks empty canvas background for a Screen with no spec
- **THEN** a spec is created for that Screen and opened in Spec mode

#### Scenario: Use explicit alternative
- **WHEN** the user invokes the corresponding Screen or placement open/create action in Details
- **THEN** it has the same ownership and open/create outcome as the double-click shortcut

### Requirement: Node-specific specs
A workflow node's contextual spec SHALL belong to that workflow node, separately from its target Screen or placement spec. Double-clicking a node in Workflow mode SHALL open its node-specific spec, creating it if absent, without entering Spec mode.

#### Scenario: Create node spec
- **WHEN** the user double-clicks a workflow node that targets a placement already having an Element spec
- **THEN** a separate node-specific spec is opened or created
- **AND** Workflow mode remains active

#### Scenario: Reopen node spec
- **WHEN** the user repeats the action on a node with an existing contextual spec
- **THEN** that existing spec is opened without creating a duplicate

### Requirement: Spec links preserve underlying mode
Spec-mode link navigation SHALL traverse Screen and workflow links in document order. Screen/placement references SHALL center their canvas targets. Workflow references SHALL open a linked graph view in the bottom dock without entering Workflow mode or activating Workflow-mode node-navigation behavior. A spec opened from Workflow mode SHALL remain a linked view under Workflow mode, not become the primary Spec-mode editor.

#### Scenario: Navigate spec placement links
- **WHEN** the user advances through the Spec's references in document order
- **THEN** the active Screen/placement reference centers its target without leaving Spec mode

#### Scenario: Open linked workflow
- **WHEN** the user follows a workflow reference from Spec mode
- **THEN** the graph opens in the bottom dock under Spec mode
- **AND** closing it restores the Spec view
- **AND** Workflow-mode node-to-canvas navigation is not activated

#### Scenario: View spec from workflow
- **WHEN** a node-specific spec opens from Workflow mode
- **THEN** the primary workflow context is retained and closing the spec returns to its graph

### Requirement: Optional spec indicators
Screens and placements with associated specs SHALL have optional indicators controlled by a persistent toolbar toggle. Indicators SHALL be hidden by default, and the toggle SHALL control visibility on both the canvas and Layers list.

#### Scenario: Default visibility
- **WHEN** a Screen with associated Screen and placement specs is displayed with indicators not enabled
- **THEN** those spec indicators are hidden on the canvas and in Layers

#### Scenario: Toggle indicators
- **WHEN** the user enables the spec-indicator toolbar toggle
- **THEN** associated spec indicators appear on the canvas and in Layers
- **AND** disabling the toggle hides them in both places

### Requirement: Preserve contextual ownership
Project-level specs SHALL be creatable from the Project overview. Screen specs SHALL belong to their Screen, Element specs SHALL belong to their specific placement, and node specs SHALL belong to their workflow node. Reusable Materials SHALL NOT acquire behavior-spec ownership.

#### Scenario: Edit reusable Material
- **WHEN** a Material is shared by placements on several Screens
- **THEN** those placements' behavior specs remain placement-owned rather than becoming a shared Material spec
