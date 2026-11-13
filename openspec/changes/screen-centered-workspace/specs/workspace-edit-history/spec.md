## ADDED Requirements

### Requirement: Automatic persistence
The Studio SHALL automatically persist edits during ordinary work rather than require a separate Save action. Closing views or switching modes SHALL NOT discard pending edits. Git SHALL remain the mechanism for identifying persisted changes relative to the last commit; autosave SHALL NOT create commits or pushes.

#### Scenario: Edit and switch modes
- **WHEN** the user edits an artifact and switches modes
- **THEN** the edit remains available for automatic persistence rather than being discarded with the editor view

#### Scenario: Persist without commit
- **WHEN** autosave successfully writes changed project files
- **THEN** Git can identify those changes relative to the last commit without the Studio automatically committing them

### Requirement: Honest persistence status
Save failures SHALL be visibly reported and unsaved edits SHALL remain available. A failed or validation-blocked write SHALL NOT be represented as successfully saved. An edit made during an in-flight save SHALL remain pending until that edit's version is persisted.

#### Scenario: Save failure
- **WHEN** a write fails after the user closes its editor
- **THEN** the failure remains visible and the pending edit is retained

#### Scenario: New edit during save
- **WHEN** version A is saving and version B is edited before A is acknowledged
- **THEN** acknowledging A does not clear B's pending state

#### Scenario: Validation blocks save
- **WHEN** source validation prevents a write under the applicable persistence policy
- **THEN** the source remains available with a visible unsaved/validation state rather than a successful-save indication

### Requirement: Unified project edit history
The Studio SHALL provide one project-wide undo/redo history covering Screen, Material, Workflow, Spec, and Theme edits. Navigation and selection changes SHALL NOT create edit-history entries.

#### Scenario: Undo across editor types
- **WHEN** the user changes a placement, edits a spec, then changes a Theme color
- **THEN** project undo traverses the Theme, Spec, and Screen edits in reverse chronological order
- **AND** project redo reapplies those undone edits in order

#### Scenario: Exclude navigation
- **WHEN** the user changes Screen, selection, or active mode without editing an artifact
- **THEN** no project edit-history entry is added

### Requirement: Reference-safe edit transactions
Undo/redo of an editing action that changes placement structure and its dependent references SHALL keep those coupled changes consistent.

#### Scenario: Undo grouped reference rewrite
- **WHEN** the user undoes a grouping edit that also rewrote placement URLs in specs and workflows
- **THEN** the placement structure and affected references return to their preceding consistent state together
