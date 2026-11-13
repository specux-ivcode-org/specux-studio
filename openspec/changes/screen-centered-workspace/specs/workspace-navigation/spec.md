## ADDED Requirements

### Requirement: Distinguish manual and reference navigation
Choosing a Screen directly from the toolbar SHALL enter Screen mode. Following references to another Screen in Workflow or Spec mode SHALL change the displayed canvas target without changing the active mode or reassigning the document's ownership.

#### Scenario: Navigate cross-Screen workflow
- **WHEN** a node in a Screen-owned workflow references a placement on another Screen
- **THEN** the referenced Screen/state is displayed while Workflow mode and the original workflow ownership remain unchanged

#### Scenario: Manually select Screen
- **WHEN** the user chooses a Screen from the toolbar while in Workflow or Spec mode
- **THEN** that Screen is displayed in Screen mode

### Requirement: Preserve last Screen on mode exit
Exiting Workflow or Spec mode after cross-Screen navigation SHALL leave the canvas on the last displayed Screen rather than automatically returning to the entry Screen. This behavior SHALL be reviewed in the interaction prototype before the final UX is accepted.

#### Scenario: Exit after following reference
- **WHEN** the user follows a reference from Screen A to Screen B and then closes the primary dock view
- **THEN** Screen B remains displayed in Screen mode

### Requirement: Separate URL editor and canvas context
The app's URL parameters SHALL identify the active editor and mode. A `specux` hash parameter SHALL identify the canvas Screen/state/placement target using SpecUX path structure. The fragment value SHALL be encoded as a single value so its internal query parameters remain part of the SpecUX target.

#### Scenario: Restore editor and placement focus
- **WHEN** a user opens a copied URL for a workflow with a named-state nested-placement canvas target in a fresh page
- **THEN** the intended workflow and mode are restored
- **AND** the referenced Screen/state/placement is focused without requiring prior browser history state

#### Scenario: Preserve inner query
- **WHEN** a SpecUX fragment target contains both `placement` and `state`
- **THEN** decoding the fragment preserves both target parameters without treating them as app parameters

### Requirement: Browser history only for Screen switches
The Studio SHALL add browser-history entries only when the displayed Screen changes from one Screen to another. Same-Screen target changes and editor/mode changes without a Screen switch SHALL update the current entry rather than add one. Initial URL synchronization and Back/Forward restoration SHALL NOT create additional entries.

#### Scenario: Navigate within same Screen
- **WHEN** the user cycles links or workflow nodes among placements or states on the same Screen
- **THEN** the URL reflects the new context and browser-history entry count does not increase

#### Scenario: Follow cross-Screen reference
- **WHEN** a reference changes the displayed Screen from A to B
- **THEN** one new browser-history entry is added

#### Scenario: Restore previous Screen
- **WHEN** the user uses browser Back to restore an existing Screen entry
- **THEN** its saved editor/canvas context is restored without pushing a new entry

### Requirement: Legacy URLs remain readable
The Studio SHALL continue resolving existing app query-only editor URLs that lack a `specux` fragment.

#### Scenario: Open old editor URL
- **WHEN** the user opens an existing supported `file`/`view` URL with no fragment
- **THEN** the corresponding artifact can still be opened
