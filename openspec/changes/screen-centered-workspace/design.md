## Context

This change translates `doc/screen-centered-workflow-plan.md` and its subsequent confirmed decisions into implementation artifacts. The Studio uses browser ES modules, a Node backend, Mermaid, YAML, and Node's test runner. No frontend framework migration is needed.

Today, `frontend/app.mjs` coordinates separate view flags and editors. `EditorNavigation.mjs` derives a single selection that sometimes represents an artifact's owning Screen and sometimes the preview Screen. `BrowserHistory.mjs` uses `file` changes to decide when to push history. `ProjectPersistence.mjs` tracks dirty-file versions, supports multi-file save entries, and disables saving for invalid YAML or Mermaid. The redesign must separate these responsibilities without discarding the existing controllers.

The existing schema supports Screen-owned Mermaid files, placement/state SpecUX references, Markdown links associating specs with workflow nodes, STML `preview-size`, and independent Screen placement geometry. It also documents Screen-only workflow links and invalid-source save guards. New placement-link diagnostics are warnings, not a reason to delete legacy nodes or make existing projects unreadable. Multiple-link syntax and node-spec storage were decision gates and are resolved below.

The existing Project page remains a separate overview, not another Screen editing mode. Project-level specs are independent of Screen selection and can open directly from the Project page. The new Screen workspace applies when a Screen context exists; Material authoring remains a workspace replacement.

## Goals / Non-Goals

**Goals:**

- Preserve Screen context through Workflow, Spec, and Theme work.
- Separate active mode, open document, document ownership, and canvas target.
- Make dock close/Escape behavior deterministic and preserve nested parent context.
- Preserve current workflow capabilities while adding contextual specs and multi-placement focus.
- Provide autosave and one edit history for all editor types, with visible failures.
- Preserve existing project readability, reference integrity, and preview/capture behavior.

**Non-Goals:**

- Project-wide workflows, executable workflow engines, or runtime interactions inside Materials.
- A new framework, third-party history service, automatic Git commits, or automatic pushes.
- Making thumbnail framing change placed geometry.

## Decisions

### 1. Separate workspace context from editor ownership

Introduce a small explicit workspace state managed by the navigation layer:

- Active mode: Screen, Workflow, Spec, or Theme.
- Displayed canvas target: Screen ID, state ID, and zero or more placement ID paths.
- Primary document: workflow/spec file and owning Screen or project identity.
- Dock stack: active linked document and the parent context to restore.
- Panel visibility and dock height.
- Material workspace context, separate from Screen modes.

`EditorNavigation` exposes a normalized context snapshot for the current mode, document owner, canvas target, and dock primary/linked views. This keeps the navigation contract explicit while editor-specific controllers remain the source of their own editing state.

An artifact's owner does not change when a workflow/spec navigates to another Screen. Details' Screen tabs follow the displayed Screen; the workflow document retains its original owner. Reuse existing editor-specific state rather than folding all editor internals into one generic editor.

Alternative: add more conditions to the existing view booleans. Rejected because nested Spec/Workflow views and cross-Screen navigation would continue conflating owner, canvas, and mode.

### 2. Use explicit transitions and one bottom dock

| Action | Mode result | Workspace result |
|---|---|---|
| Choose Screen in toolbar | Screen | Display chosen Screen; leave primary Workflow/Spec context |
| Open Screen-owned workflow | Workflow | Graph in bottom dock |
| Follow workflow placement link | Preserve Workflow | Resolve Screen/state and focus placement set |
| Open Screen/placement spec from Screen mode | Spec | Spec in bottom dock |
| Follow spec Screen/placement link | Preserve Spec | Resolve and center canvas target |
| Open node spec from Workflow | Preserve Workflow | Push linked Spec view into dock |
| Open workflow link from Spec | Preserve Spec | Push linked graph view into dock |
| Close/Escape linked view | Preserve parent mode | Pop view and reveal its parent |
| Close/Escape primary view | Screen | Close dock; retain last displayed Screen |
| Enter Theme from Screen context menu | Theme | Keep Screen; show Theme controls in Details |
| Exit Theme through toolbar or Escape | Screen | Keep Screen |
| Open Material editor | Material workspace | Integrated STML source and Material preview |

The dock replaces only its own content, never the Screen canvas. Retain parent document and navigation position while a linked view is open. Closing/reopening the primary dock is also an exit/re-entry operation, not a hidden active mode; toolbar controls must indicate this accurately.

Alternative: independently floating overlays. Rejected by the chosen resizable bottom-dock layout. Reuse `SplitViewLayout.mjs` mechanisms where suitable, not its assumption that each artifact owns a separate Screen preview.

Escape dispatch gives the most local interaction priority: dismiss/cancel an active dialog or end a focused transient text-edit interaction first. Only when neither applies does Escape close the active dock view or exit Theme mode.

### 3. Navigate workflow context, not executable flows

Use Mermaid graph structure to identify nodes with no incoming directed arrows. Preserve first occurrence in source order, including nodes introduced by edge statements. Select the first entry candidate; show diagnostics for multiple candidates. If none exists, warn and do not choose an arbitrary start node. This is preview navigation, not execution.

Reuse and extend SpecUX parsing in `WorkflowEditor.mjs`. Normalize an omitted state to Default. Resolve nested placement paths using existing group helpers. A selected node can reference several placements only when all targets have the same Screen and normalized state.

Validate the complete target set before applying it. For a valid set, render all focus indicators and fit the union of their transformed bounds within the visible canvas above the dock. Missing, unresolved, or incompatible targets produce an actionable node warning; do not collapse the set to the first link. If the selected node has no valid target set, preserve the current canvas Screen and focus.

Mermaid supports one click URL per node; repeated `click` directives overwrite the node URL. Serialize a multi-placement target as repeated `placement` keys in that single URL, for example `click save href "specux://screen/home/screen.yml?placement=dialog.title&placement=dialog.save&state=dialog-open"`. Update the workflow parser to collect `URLSearchParams.getAll("placement")`, validate each target, and require one shared Screen/state. Update the workflow schema, grouping reference updater, and examples together.

### 4. Keep spec ownership contextual

Reuse existing project and Screen spec references and placement spec discovery. Double-click shortcuts apply in Screen mode; explicit Details actions expose the same open/create behavior. Reopening an existing spec must not create duplicates.

A node-specific spec is associated with workflow identity and node identity, not its current placement target. Store exactly one node spec at `screens/<screen-id>/specs/workflow-<workflow-id>-<node-id>.md`, alongside the owning Screen's other specs. Use the existing Markdown workflow-node link shape to attach it. Renaming a node renames the corresponding file and rewrites its association; deleting a node preserves the Markdown file as an unlinked spec and surfaces that state rather than deleting user documentation. Keep node/file validation safe and case-aware; do not invent a Screen YAML field unnecessarily.

A workflow graph reached from Spec mode is read-only: node selection does not navigate the Screen, and node-spec creation is unavailable. It does not become a Workflow-mode controller. Close it to return to the parent Spec view.

Alternative: reuse a node's Screen/Element spec. Rejected because the user chose a distinct node-specific spec.

### 5. Treat Material thumbnails as presentation metadata

Reuse `MaterialDefaults.mjs`, STML `preview-size`, and the Material preview controllers for the known Material preview dimensions. Convert drag outlines into canvas-space geometry accounting for zoom and pan. Creating a placement must not use the scaled selector tile size.

Each selector tile shows the complete Material preview, scaled to fit the tile using the STML `preview-size` or the type's default dimensions when omitted. Ignore legacy `material-previews` crop metadata so older projects remain readable without preserving the removed crop behavior. Selector thumbnail scaling remains independent of placed geometry.

Keep the Material editing workspace in its existing resizable split layout, with the preview canvas above the STML source editor. On narrow viewports, retain that vertical split and allow the workspace to scroll; the Material selector and Details become overlay panels rather than reducing the canvas width. Follow the existing responsive panel sizing and keep their persistent toolbar controls available.

In Screen mode, clicking a Material selector tile creates a placement on the current Screen using the existing default position, state, and layer rules. In the Material authoring workspace, clicking a tile opens that Material for editing, and clicking another tile switches the active Material without creating a placement. Material-to-Screen dragging and the Material editor's Place action also create placements; dragging shows the known-size outline centered under the pointer.

### 6. Give URL fields separate responsibilities

Extend `BrowserHistory.mjs` rather than replacing HTTP routing. Existing app query parameters identify the primary editor and its document context (`file`, `view`, `screen`, and `owner`). Add a `linked` query parameter for a linked document, and an optional `node` parameter identifying a selected workflow node in the linked workflow, or in the primary workflow when no linked document is specified. A hash parameter named `specux` carries the canvas target in SpecUX path form. For a multi-placement target, its decoded value contains repeated `placement` keys and one shared `state`, for example `screen/home/screen.yml?placement=dialog.title&placement=dialog.save&state=dialog-open`. Encode the SpecUX target as one parameter value so its inner `?`, `&`, and escaped path segments are not mistaken for outer parameters.

Primary editor, linked document, selected workflow node, and canvas target must survive opening the URL in a fresh page, not just restoration from `history.state`. Keep legacy query-only links readable.

Compare displayed Screen identity, not document filename, when synchronizing browser history. Replace the current entry for mode changes, node/link navigation within one Screen, and initial synchronization; push only for actual Screen-to-Screen switches. Back/Forward restoration must not push another entry.

The `specux` fragment is the canonical serialization of the complete canvas target set. A linked workflow's document and selected node remain in app query parameters; do not encode additional placements in app-specific parameters or focus only the first target.

### 7. Extend versioned persistence and share edit transactions

Retain the dirty-file version tracking and serialization in `ProjectPersistence.mjs`. Add a bounded autosave scheduler that serializes writes, batches related file changes, and clears only the versions actually acknowledged. A newer edit made during an in-flight save must remain dirty. Closing an editor must not dispose of its pending source or save work.

Use one project-level transaction history across Screen, Material, Workflow, Spec, and Theme edits. Group each artifact-changing gesture into one transaction committed when the gesture ends, and record coupled reference/file changes together. Coalesce consecutive typing in the same editor into one history entry until a pause, focus change, or different edit action. Treat each create or delete action and all coupled file/reference changes as one atomic transaction. Navigation, selection, pan/zoom, and dock resizing do not represent artifact edits. Do not leave native source undo competing with project history.

Undo and redo apply through the same autosave path as other edits. Keep the project-wide undo/redo stack for the current app session only; reopening the project starts with an empty history.

Git records persisted file differences; it does not prove an in-memory draft has been saved and is not the application undo stack. Display pending/error persistence state independently. Autosave must never imply a failed or validation-blocked write succeeded.

When source is invalid, keep the last valid project artifact untouched and persist the invalid text as a separate recovery draft. Restore that draft when the project is reopened and visibly warn that the source is invalid and has not been saved as the project artifact. Once the source becomes valid and its canonical write succeeds, the recovery draft can be cleared.

Before autosave writes a file, detect whether it changed on disk since the app loaded it. If an external change is detected, pause the write and preserve both versions until the user chooses to reload the disk version, keep the local version (overwriting the disk version only after that explicit choice), or merge them. Undo and redo use the same autosave path and the history is session-only.

Alternative: separate editor histories or use browser navigation as undo. Rejected by the confirmed unified edit-only history requirement.

## Risks / Trade-offs

- [Owner and displayed Screen can diverge] -> Keep owner identity explicit and test cross-Screen workflows without reparenting their files.
- [Nested views can obscure active mode] -> Keep a visible mode label and define close/Escape through the dock stack.
- [Retaining the last Screen on exit may feel unexpected] -> Prototype and review this confirmed trial direction before finalizing UX.
- [Dock consumes canvas space] -> Refit targets to usable canvas bounds and provide a constrained resize behavior; resolve small-window treatment in the prototype.
- [Legacy workflows lack placement targets or entry points] -> Warn non-destructively, preserve source and rendering, and keep diagnostics separate from fatal syntax errors.
- [Repeated query keys or workflow node IDs may be rewritten inconsistently] -> Cover multi-placement parsing, serialization, rename, deletion, and grouped-reference rewrites together.
- [Autosave races and coupled-file edits can lose changes] -> Serialize versioned writes, detect external changes before overwriting, and include concurrency, failure, conflict-resolution, and multi-file transaction tests.
- [Global history may affect a different editor's artifact] -> Keep undo and redo project-wide and apply them to the last artifact transaction; navigation itself is not a history action.
- [Existing capture/annotation hosts may move] -> Preserve coordinate-host contracts and verify representative captures after layout changes.
- [Plan and specifications can diverge] -> Implement from this change's specs; retain the discussion plan as context and reconcile the living baseline when features land.

## Migration Plan

1. Resolve the data/persistence decision gates and prototype mode/dock transitions before committing to schema extensions.
2. Introduce explicit context behind current navigation adapters, preserving query-only deep links and existing project loading.
3. Move reusable editor views into the Screen shell incrementally. Do not copy or fork preview controllers.
4. Add contextual creation, workflow diagnostics/multi-target focus, Material selector framing, and URL restoration with targeted tests.
5. Integrate autosave and history without removing dirty-version protections. Keep existing files unchanged until an actual editing action requires a write.
6. Update the applicable schema files, examples, editor/CLI documentation, and stable Screen requirement IDs in the same implementation changes.
7. Review the prototype and run the existing regression suite before retiring old layout paths.

Rollback must restore the previous UI without discarding user artifacts. Prefer backward-compatible optional metadata and avoid automatic file-format rewrites; if a new serialization is unavoidable, define its migration and rollback before shipping it.

## Resolved Questions

The decision gates in this document were resolved before their dependent implementation. Tasks 1.1–1.6 record the agreed behavior for navigation, node specs, multi-placement links, persistence and history boundaries, Material placement defaults, selector framing, and responsive layout. No implementation-blocking design question remains for this change.
