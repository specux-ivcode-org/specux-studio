## Why

Separate Screen, Workflow, Spec, and Theme views make users lose the spatial context of the Screen they are documenting. Bring these activities into a Screen-centered workspace while preserving the Project overview and giving Material authoring its own workspace.

## What Changes

- Keep the Screen canvas visible in Screen, Workflow, Spec, and Theme modes. Use a resizable bottom dock for Workflow and Spec views, a left Material selector, a right tabbed Details pane, and a persistent top toolbar with Screen selection, zoom, mode status, panel controls, and a spec-indicator toggle.
- Preserve the Project summary page and project-level spec creation. Workflows remain Screen-owned; project-wide workflows are out of scope.
- Distinguish manual Screen selection from reference navigation: toolbar selection enters Screen mode; references preserve the active Workflow/Spec mode. Exiting leaves the last referenced Screen visible, subject to prototype review.
- Close the current dock view with its close control or Escape. Closing a nested view reveals its parent without changing mode; closing a primary view exits to Screen mode.
- Navigate workflow placement targets, including multiple placements on one Screen/state. Highlight and fit their combined bounds; warn about missing/invalid links and invalid entry-point structure.
- Open/create Screen and placement specs by contextual double-click or Details actions. Give workflow nodes their own specs rather than reusing their target's spec.
- Enter Theme mode from the Screen context menu and edit colors/variables through click-based controls. Exit through toolbar controls or Escape.
- Replace the Screen workspace only for Material editing, with integrated STML source and preview. Drag Materials from the selector using a known-size outline; keep selector preview framing separate from placed geometry.
- Use a subtle dot grid and optional spec indicators on the canvas and Layers list, hidden by default.
- Restore editor/mode context from app URL parameters and canvas focus from `#specux=<path>`. Add browser-history entries only for Screen switches.
- Autosave edits and provide one project-wide undo/redo history across Screen, Material, Workflow, Spec, and Theme edits; exclude navigation and selection.

## Capabilities

### New Capabilities

- `screen-centered-workspace`: Workspace modes, panel layout, contextual Details, Theme access, and preserved Project overview.
- `workspace-navigation`: Separate editor/canvas identity, SpecUX fragment routing, and Screen-switch-only browser history.
- `workflow-context-navigation`: Entry-point diagnostics, placement-link validation, multi-target framing, and mode-preserving navigation.
- `contextual-spec-authoring`: Screen/placement/node spec ownership, contextual creation, linked dock views, and optional indicators.
- `material-selection-workspace`: Material selector, outlined dragging, independent thumbnail framing, and dedicated Material authoring.
- `workspace-edit-history`: Autosave, visible persistence failures, and unified edit-only undo/redo.

### Modified Capabilities

None. The local `openspec/specs/` baseline is empty. These new OpenSpec capabilities describe changes to the existing Studio, not replacement definitions of every existing feature.

## Impact

Changes will affect `frontend/app.mjs`, `frontend/index.html`, browser editor/navigation/layout controllers, persistence coordination, and the project APIs/validators needed for node-spec creation or metadata. Reuse existing Mermaid, YAML, Screen rendering, SpecUX link parsing, and Node test tooling; no new dependency is currently proposed.

Keep existing projects readable and preserve composition, grouped-placement reference maintenance, workflow source access, preview/capture behavior, and Project summary functionality. Update `schema/workflow.md`, `schema/spec.md`, and any affected Material schema together with implementation; update the living `doc/screen-editor-requirements.md` baseline and related editor documentation. The existing planning document remains discussion context; unresolved details are recorded in the design rather than promoted to confirmed requirements.
