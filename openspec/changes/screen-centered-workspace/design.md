## Context

This change translates `doc/screen-centered-workflow-plan.md` and its subsequent confirmed decisions into implementation artifacts. The Studio uses browser ES modules, a Node backend, Mermaid, YAML, and Node's test runner. No frontend framework migration is needed.

Today, `frontend/app.mjs` coordinates separate view flags and editors. `EditorNavigation.mjs` derives a single selection that sometimes represents an artifact's owning Screen and sometimes the preview Screen. `BrowserHistory.mjs` uses `file` changes to decide when to push history. `ProjectPersistence.mjs` tracks dirty-file versions, supports multi-file save entries, and disables saving for invalid YAML or Mermaid. The redesign must separate these responsibilities without discarding the existing controllers.

The existing schema supports Screen-owned Mermaid files, placement/state SpecUX references, Markdown links associating specs with workflow nodes, STML `preview-size`, and independent Screen placement geometry. It also documents Screen-only workflow links and invalid-source save guards. New placement-link diagnostics are warnings, not a reason to delete legacy nodes or make existing projects unreadable. Exact extensions for multiple links and node-spec storage remain decision gates.

The existing Project page remains a separate overview, not another Screen editing mode. The new Screen workspace applies when a Screen context exists; Material authoring remains a workspace replacement. Project-spec behavior before a Screen is selected remains explicitly open.

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
- Treating suggestions about invalid-draft persistence, external-write recovery, or Project-spec empty-canvas behavior as already approved product decisions.

## Decisions

### 1. Separate workspace context from editor ownership

Introduce a small explicit workspace state managed by the navigation layer:

- Active mode: Screen, Workflow, Spec, or Theme.
- Displayed canvas target: Screen ID, state ID, and zero or more placement ID paths.
- Primary document: workflow/spec file and owning Screen or project identity.
- Dock stack: active linked document and the parent context to restore.
- Panel visibility and dock height.
- Material workspace context, separate from Screen modes.

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

Escape dispatch must respect an active dialog or transient editor interaction before applying workspace-level close behavior; determine exact precedence during the interaction prototype.

### 3. Navigate workflow context, not executable flows

Use Mermaid graph structure to identify nodes with no incoming directed arrows. Preserve first occurrence in source order, including nodes introduced by edge statements. Select the first entry candidate; show diagnostics for multiple candidates. If none exists, warn and do not choose an arbitrary start node. This is preview navigation, not execution.

Reuse and extend SpecUX parsing in `WorkflowEditor.mjs`. Normalize an omitted state to Default. Resolve nested placement paths using existing group helpers. A selected node can reference several placements only when all targets have the same Screen and normalized state.

Validate the complete target set before applying it. For a valid set, render all focus indicators and fit the union of their transformed bounds within the visible canvas above the dock. Missing, unresolved, or incompatible targets produce an actionable node warning; do not collapse the set to the first link. The exact retained-canvas behavior after an invalid selection needs confirmation.

Mermaid's existing click handling cannot simply be assumed to support multiple directives per node. Resolve the serialized multi-link convention before changing parsers and update the workflow schema, validators, grouping reference updater, and examples together.

### 4. Keep spec ownership contextual

Reuse existing project and Screen spec references and placement spec discovery. Double-click shortcuts apply in Screen mode; explicit Details actions expose the same open/create behavior. Reopening an existing spec must not create duplicates.

A node-specific spec is associated with workflow identity and node identity, not its current placement target. Reuse existing Markdown workflow-node links for association where possible. Its path convention, multiplicity, rename/delete behavior, and creation API are open until resolved; do not invent a project or Screen schema field unnecessarily.

A workflow graph reached from Spec mode does not become a Workflow-mode controller: it can display its referenced node without enabling mode-specific node-to-canvas navigation or node-spec creation. Existing linked-reference navigation/highlighting should be retained where compatible; the exact linked-view action set remains open.

Alternative: reuse a node's Screen/Element spec. Rejected because the user chose a distinct node-specific spec.

### 5. Treat Material thumbnails as presentation metadata

Reuse `MaterialDefaults.mjs`, STML `preview-size`, and the Material preview controllers for the known Material preview dimensions. Convert drag outlines into canvas-space geometry accounting for zoom and pan. Creating a placement must not use the scaled selector tile size.

Thumbnail framing is independently resizable/repositionable in Material authoring and transformed to fit each selector tile. Its storage and uncustomized fallback must be resolved without changing Material HTML or existing placement sizes. Preserve legacy Material rendering when metadata is absent.

The only new selector drag interaction is Material-to-Screen placement; Theme editing remains click-based. Click-to-add positioning and drop defaults are still open.

### 6. Give URL fields separate responsibilities

Extend `BrowserHistory.mjs` rather than replacing HTTP routing. Existing app query parameters identify editor/mode and document ownership; a hash parameter named `specux` carries the canvas target in SpecUX path form. For example, the decoded fragment value can be `screen/home/screen.yml?placement=dialog.save&state=open`. Encode it as one parameter value so inner `?`, `&`, and escaped path segments are not mistaken for outer parameters.

Both contexts must survive opening the URL in a fresh page, not just restoration from `history.state`. Keep legacy query-only links readable. Define additional app parameters only where current fields cannot represent primary and linked document context; specify their serialization before implementation.

Compare displayed Screen identity, not document filename, when synchronizing browser history. Replace the current entry for mode changes, node/link navigation within one Screen, and initial synchronization; push only for actual Screen-to-Screen switches. Back/Forward restoration must not push another entry.

For a multi-placement node, the app's document/node context can identify the target set while the fragment remains a valid canonical SpecUX target; the exact encoding of a target set must be settled without arbitrarily focusing the first placement.

### 7. Extend versioned persistence and share edit transactions

Retain the dirty-file version tracking and serialization in `ProjectPersistence.mjs`. Add a bounded autosave scheduler that serializes writes, batches related file changes, and clears only the versions actually acknowledged. A newer edit made during an in-flight save must remain dirty. Closing an editor must not dispose of its pending source or save work.

Use one project-level transaction history across Screen, Material, Workflow, Spec, and Theme edits. Group a gesture into one transaction and record coupled reference/file changes together. Navigation, selection, pan/zoom, and dock resizing do not represent artifact edits. Define text-edit coalescing and creation/deletion behavior before wiring every editor; do not leave native source undo competing with project history.

Git records persisted file differences; it does not prove an in-memory draft has been saved and is not the application undo stack. Display pending/error persistence state independently. Autosave must never imply a failed or validation-blocked write succeeded.

Invalid-source persistence and external-write conflict recovery are unresolved. Until a policy is selected, preserve existing validation guards and retain dirty drafts across editor transitions. The proposal does not authorize silently writing invalid source or overwriting a distinct external edit. Undo/redo persistence semantics are part of the same decision gate.

Alternative: separate editor histories or use browser navigation as undo. Rejected by the confirmed unified edit-only history requirement.

## Risks / Trade-offs

- [Owner and displayed Screen can diverge] -> Keep owner identity explicit and test cross-Screen workflows without reparenting their files.
- [Nested views can obscure active mode] -> Keep a visible mode label and define close/Escape through the dock stack.
- [Retaining the last Screen on exit may feel unexpected] -> Prototype and review this confirmed trial direction before finalizing UX.
- [Dock consumes canvas space] -> Refit targets to usable canvas bounds and provide a constrained resize behavior; resolve small-window treatment in the prototype.
- [Legacy workflows lack placement targets or entry points] -> Warn non-destructively, preserve source and rendering, and keep diagnostics separate from fatal syntax errors.
- [Mermaid multi-link syntax and node IDs require stable mapping] -> Resolve serialization and identity before schema/API work; cover rename, deletion, and grouped-reference rewrites.
- [Autosave races and coupled-file edits can lose changes] -> Serialize versioned writes and include concurrency, failure, and multi-file transaction tests.
- [Unified history may affect a hidden document] -> Show which artifact the transaction changes; determine whether revealing that editor is appropriate without making navigation itself undoable.
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

## Open Questions

These are not additional confirmed requirements. Tasks include resolving each before its dependent implementation.

- Is Theme access on the Screen background, placement context menus, or both? What is Escape precedence for dialogs/editor interactions?
- What actions remain available in linked Spec/Workflow views, and how much nested navigation is supported?
- What file convention identifies a node-specific spec, can there be multiple, and what happens on workflow/node rename or deletion?
- What serializable convention represents multiple placement links for one Mermaid node? What stays visible after invalid target selection?
- How are primary/linked documents and multi-placement canvas context serialized for reload?
- How does a project spec open before any Screen is selected? Avoid choosing a Screen merely to satisfy the layout.
- What is the invalid-draft autosave/recovery policy, how do external disk edits interact with saving/history, and how are undo/redo changes persisted?
- What are transaction boundaries for typing, creation/deletion, and cross-file reference rewrites, and how is a hidden-artifact undo communicated?
- What happens on Material click-to-add, and what layer/state/drop defaults apply?
- Where is thumbnail framing stored, and what is its default? How are Material preview and STML arranged?
- What minimum canvas/dock sizes, responsive layout, and panel reopen defaults preserve useful context?
- Which existing workflow controls must remain available, and how do canvas double-click shortcuts coexist with current selection/panning tools?
