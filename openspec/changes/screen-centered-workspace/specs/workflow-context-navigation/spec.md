## ADDED Requirements

### Requirement: Deterministic entry-point diagnostics
Workflow entry points SHALL be nodes with no incoming directed arrows. The Studio SHALL select the first entry point in Mermaid source order, warn if several exist, and warn without guessing an entry point if none exists.

#### Scenario: Multiple entry points
- **WHEN** a Mermaid graph contains multiple nodes with no incoming arrows
- **THEN** the first such node in source order is used as the entry point
- **AND** a multiple-entry-point warning is displayed

#### Scenario: No entry point
- **WHEN** every node has an incoming arrow
- **THEN** a warning is displayed and no arbitrary entry point is selected

#### Scenario: First written node is not an entry
- **WHEN** the first written node has an incoming arrow and a later node is the sole entry point
- **THEN** the later entry-point node is selected rather than the first written node

### Requirement: Placement targets share Screen and state
Each workflow node SHALL expect at least one attached SpecUX placement link. Multiple placement links SHALL be accepted only if they resolve to placements on the same Screen and normalized state. Omitted state SHALL mean Default; nested dot-separated placement paths SHALL remain supported.

#### Scenario: Multiple Default targets
- **WHEN** a node references several placements on one Screen with omitted or explicit Default state
- **THEN** the targets are accepted as one Screen/state target set

#### Scenario: Incompatible targets
- **WHEN** a node's placement links identify different Screens or different normalized states
- **THEN** the Studio displays a warning identifying the incompatible node targets
- **AND** it does not arbitrarily select one link as the node's canvas target

#### Scenario: Missing placement link
- **WHEN** a node has no placement link, including when it only links to a Screen or state
- **THEN** a warning indicates that a SpecUX placement link is expected
- **AND** the node remains visible in the graph

### Requirement: Multi-placement canvas framing
Selecting a node with valid placement targets SHALL display their Screen/state, highlight all linked placements, and center and fit their combined transformed bounds within the visible canvas. Missing or invalid target links SHALL produce a warning rather than arbitrary focus.

#### Scenario: Fit multiple placements
- **WHEN** the user selects a node with two valid placement links on one Screen/state
- **THEN** both placements are highlighted and their combined bounds fit in the canvas above the dock

#### Scenario: Broken target
- **WHEN** the selected node references a nonexistent placement or Screen/state
- **THEN** the Studio displays a target warning without pretending the reference resolved

### Requirement: Preserve workflow authoring and ownership
Workflows SHALL remain Screen-owned and support selection, creation, and deletion from the owning Screen's Specs & Workflows tab. Current workflow editing controls and Mermaid source access SHALL be retained in Workflow mode. Reference navigation SHALL NOT reparent a workflow.

#### Scenario: Create Screen workflow
- **WHEN** the user creates a workflow from Screen A's Specs & Workflows tab
- **THEN** it belongs to Screen A and opens in Workflow mode

#### Scenario: Navigate to Screen B
- **WHEN** that workflow references a placement on Screen B
- **THEN** the displayed Screen changes without moving the workflow out of Screen A

#### Scenario: Edit existing workflow
- **WHEN** the user opens a previously supported workflow
- **THEN** Mermaid source and existing authoring capabilities remain accessible
- **AND** new design warnings do not delete its source or make the project unreadable
