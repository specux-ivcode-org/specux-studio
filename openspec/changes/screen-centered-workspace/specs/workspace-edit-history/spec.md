## ADDED Requirements

### Requirement: Automatic persistence
The Studio SHALL automatically persist edits during ordinary work rather than require a separate Save action. Closing views or switching modes SHALL NOT discard pending edits. Git SHALL remain the mechanism for identifying persisted changes relative to the last commit; autosave SHALL NOT create commits or pushes.

The workspace SHALL show an icon-only autosave indicator rather than Save/Saved text or a manual Save or reset-from-files action. The indicator SHALL animate while edits are pending or saving, use a quiet completion mark after a successful save, and expose errors through an accessible label and existing error reporting.

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
- **THEN** the last valid project artifact remains unchanged
- **AND** the invalid source is persisted separately as a recovery draft
- **AND** a warning identifies the source as invalid and not saved as the project artifact

#### Scenario: Recover invalid source after restart
- **WHEN** the project is reopened with an invalid-source recovery draft
- **THEN** the draft is restored in the editor with a visible invalid-source warning
- **AND** the draft is not represented as a successful project-file save

#### Scenario: Clear recovered draft after valid save
- **WHEN** the recovered source becomes valid and its project-file write succeeds
- **THEN** the recovery draft is cleared

#### Scenario: Detect external disk change
- **WHEN** autosave detects that the project file changed on disk since it was loaded
- **THEN** the pending write pauses before overwriting the external change
- **AND** both the local and disk versions remain available
- **AND** the user can explicitly reload the disk version, keep the local version, or merge the versions

### Requirement: Unified project edit history
The Studio SHALL provide one project-wide undo/redo history covering Screen, Material, Workflow, Spec, and Theme edits. Navigation and selection changes SHALL NOT create edit-history entries.

Undo and redo SHALL autosave their resulting artifact changes through the normal persistence path. The edit-history stack SHALL be session-only and SHALL start empty when a project is reopened.

#### Scenario: Undo across editor types
- **WHEN** the user changes a placement, edits a spec, then changes a Theme color
- **THEN** project undo traverses the Theme, Spec, and Screen edits in reverse chronological order
- **AND** project redo reapplies those undone edits in order

#### Scenario: Exclude navigation
- **WHEN** the user changes Screen, selection, or active mode without editing an artifact
- **THEN** no project edit-history entry is added

#### Scenario: Autosave undo and redo
- **WHEN** the user undoes or redoes an artifact edit
- **THEN** the resulting artifact state is automatically persisted

#### Scenario: Coalesce text input
- **WHEN** the user types consecutively in the same editor without pausing, changing focus, or performing a different edit
- **THEN** those input changes are grouped into one undo step

#### Scenario: Group an artifact gesture
- **WHEN** the user performs an artifact-changing pointer gesture with multiple intermediate updates
- **THEN** the complete gesture is recorded as one undo step when it ends
- **AND** pan, zoom, and dock resizing do not create edit-history entries

#### Scenario: Undo a create or delete action
- **WHEN** the user creates or deletes an artifact and the action also changes associated files or references
- **THEN** the artifact and all coupled file/reference changes are undone or redone together as one step

#### Scenario: Start a fresh history after restart
- **WHEN** the user reopens a project after restarting the app
- **THEN** the project files retain their saved contents
- **AND** the prior session's undo/redo history is not restored

### Requirement: Reference-safe edit transactions
Undo/redo of an editing action that changes placement structure and its dependent references SHALL keep those coupled changes consistent.

#### Scenario: Undo grouped reference rewrite
- **WHEN** the user undoes a grouping edit that also rewrote placement URLs in specs and workflows
- **THEN** the placement structure and affected references return to their preceding consistent state together
