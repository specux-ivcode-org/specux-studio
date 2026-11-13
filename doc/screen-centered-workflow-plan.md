# Screen-Centered Workflow Workspace Plan

**Status:** Initial design direction
**Scope:** Keep the Screen visible as the primary workspace for Screen, Workflow, and Spec modes, with Material editing as the workspace exception.

## Goal

Keep the Screen canvas as the primary, persistent workspace for every mode except Material editing. Workflow and Spec editors appear in a closeable, resizable bottom dock while the Screen remains visible; opening a linked workflow or spec does not silently change the active mode.

## Agreed direction

- Make the Screen canvas the central workspace rather than one editor among several dedicated views.
- Keep the existing Project page as a project-wide summary and provide an action there to create project-level specs.
- Reflect the canvas target (Screen, state, or placement) in a `#specux=<path>` URL fragment that follows the SpecUX URL structure. Preserve the app's existing URL parameters to identify the active editor and mode, so a shared URL restores both editor context and canvas focus.
- Add browser history entries only when switching Screens. Navigation to other SpecUX targets on the current Screen updates the URL without adding history entries.
- Make Screen mode the default/base mode: selecting a Screen displays it on the canvas.
- Choosing a Screen directly from the toolbar enters Screen mode. Following a reference to another Screen while in Workflow or Spec mode changes the canvas target without changing the active mode.
- After cross-Screen navigation, exiting Workflow or Spec mode leaves the canvas on the last referenced Screen rather than returning to the entry Screen. Treat this as a prototype direction to validate, since either behavior may feel unexpected.
- Put a toolbar across the top of the workspace.
- Include a Screen selector in the toolbar so users can choose an existing Screen or create a new one.
- Put the canvas zoom controls in the top toolbar.
- Use a subtle dot grid on the canvas instead of the current line grid to reduce visual noise.
- Keep a Details pane on the right, equivalent to the current Details pane: show and edit the current selection's properties and provide the Screen's layer and placement information.
- Organize the right Details pane into Properties, States, Layers, and Specs & Workflows tabs. Properties preserves current selection details; the other tabs provide Screen State controls, layer and placement management, and spec/workflow navigation.
- Provide explicit Screen, Workflow, Spec, and Theme modes, with the active mode determining how node and link interactions behave.
- In Workflow mode, show the Mermaid graph in a closeable bottom dock while keeping the Screen visible above it. Closing the graph exits Workflow mode and returns to normal Screen mode.
- In Spec mode, show the spec editor in a closeable bottom dock while keeping the Screen visible above it. Closing the spec editor exits Spec mode and returns to normal Screen mode.
- Pressing Escape closes the active Workflow or Spec view in the dock; closing a primary view exits its mode and returns to Screen mode. For nested views, Escape closes only the topmost view and reveals the underlying mode.
- Make the bottom dock resizable so users can adjust how much of the Screen canvas remains visible.
- Workflows describe how a user moves through Screen states and placements.
- Keep the Screen canvas as the default workspace; editing a Material replaces the Screen workspace with the Material editing workspace.
- In the Material editing workspace, show the Material preview in the canvas and provide its STML source editor as part of the workspace, not in an overlay.
- Provide a Material selector on the left, separate from the Material editor, where users can preview Materials, select one to add, or drag one onto the Screen.
- Preserve the workflow editor's current capabilities and controls in Workflow mode.
- In Workflow mode, selecting a node centers its target Screen, state, or placement on the canvas. Double-clicking a node opens a node-specific spec, creating it if needed, in the bottom dock without entering Spec mode. This spec belongs to the workflow node, not its target Screen or placement.
- Define workflow entry points as nodes with no incoming arrows. Use the first entry point in Mermaid source order and warn when multiple entry points exist. If every node has an incoming arrow, such as in a cycle, show a warning and do not guess an entry point.
- Require each workflow node to have at least one SpecUX placement link. Show a warning when a node has no placement link. Multiple placement links are allowed only when all linked placements belong to the same Screen and the same state, including its default state.
- When a node links to multiple placements on the same Screen and state, highlight all linked placements and center their combined bounds. If a link is missing or invalid, show a warning rather than arbitrarily focusing one placement.
- In Spec mode, cycle through the spec's links: Screen and placement links center their targets on the canvas; a workflow link opens that workflow's Mermaid graph in the bottom dock without entering Workflow mode.
- In Screen mode, double-clicking a placement opens its Element spec, creating it if needed; double-clicking empty canvas opens the active Screen's spec, creating it if needed. Provide explicit spec actions in Details as an alternative.
- Provide Theme mode from the Screen's right-click context menu. Keep the Screen visible, and reuse the current Theme selector and placement-variable controls in the Details pane; editing Theme colors is click-based, not drag-based.
- Keep the active mode visible in the top toolbar. Exit Theme mode by selecting Screen mode, toggling the active Theme control off, or pressing Escape.
- Show an indicator on the Screen and placements that have associated specs. Hide these indicators by default; provide a toolbar toggle that shows or hides them on both the canvas and in the Layers list.
- Make the Material selector, workflow graph, spec editor, and Details pane closeable, with persistent toolbar controls to reopen them.
- Provide one project-wide undo/redo history for Screen, Material, Workflow, Spec, and Theme edits; navigation and selection changes are not undoable. This is a core capability, not a later polish item.
- Automatically persist edits as users work. Use Git to identify persisted changes relative to the last commit; do not require a separate Save action for ordinary editing.
- Closing dock views or switching modes does not discard edits. Surface save failures clearly and retain unsaved edits rather than implying they were saved.

## Initial interaction model

1. The user can open the existing Project page to review a project-wide summary and create project-level specs.
2. The user chooses an existing Screen or creates a new one from the top toolbar.
3. The user works on its canvas, using the toolbar's zoom controls as needed.
4. The Details pane on the right provides Properties, States, Layers, and Specs & Workflows tabs for the current Screen context.
5. The user selects a workflow from the selected Screen's workflow list to enter Workflow mode and open its Mermaid graph in the bottom dock, leaving the Screen visible above it.
6. Selecting a workflow node switches to the referenced Screen when needed, shows its referenced state, and centers the referenced Screen, placement, or group without leaving Workflow mode.
7. Double-clicking a placement opens its Element spec, creating it if needed; double-clicking empty canvas opens the active Screen's spec, creating it if needed. The same actions are available from Details.
8. Double-clicking a node opens its node-specific spec, creating it if needed, in the bottom dock; the active mode remains Workflow mode. Closing the spec view, including with Escape, returns to the workflow graph in the dock.
9. Closing the workflow graph, including with Escape, exits Workflow mode and returns to normal Screen mode.
10. The user enters Spec mode and opens the spec editor in the bottom dock, which leaves the Screen visible above it.
11. Cycling through spec links centers Screen and placement targets; opening a workflow link shows its graph in the bottom dock while the active mode remains Spec mode.
12. Closing the workflow view, including with Escape, returns to the spec editor; closing the spec editor, including with Escape, exits Spec mode and returns to normal Screen mode.
13. The user enters Theme mode from the Screen's right-click menu; the Screen stays visible and Theme selection and variable controls appear in Details. The top toolbar indicates Theme mode; the user can return to Screen mode from the toolbar or by pressing Escape.
14. When the user edits a Material, the Screen workspace is replaced by the Material editing workspace, with the Material preview in the canvas and its STML source editor in the workspace.
15. The user opens the Material selector, previews a Material, then selects it or drags it onto the Screen to create a placement.
16. In Screen mode, spec indicators on the Screen and placements are hidden unless the user enables the indicator toggle.
17. The user can close and reopen the Material selector, bottom dock, and Details pane using the toolbar.
18. Users can undo and redo Screen, Material, Workflow, Spec, and Theme edits through one project-wide history; navigation and selection changes are not undoable.
19. Edits are saved automatically; Git shows persisted changes, and closing a dock view or switching modes does not discard them.

The workflow graph and spec editor should not replace the Screen canvas: users should retain the Screen as spatial context while viewing and navigating either document.

## Workspace layout and panels

- The top toolbar contains the Screen selector, zoom controls, and persistent controls for reopening closed panels.
- The Screen canvas is the default central workspace.
- Choosing a Screen from the toolbar enters Screen mode and displays that Screen on the canvas. Reference navigation in Workflow or Spec mode may switch the displayed Screen without changing modes.
- Render the canvas grid as subtle dots rather than continuous lines.
- The Material selector is on the left by default; the Details pane is on the right.
- The Details pane has Properties, States, Layers, and Specs & Workflows tabs.
- Theme mode is entered from the Screen's right-click context menu, keeps the Screen visible, and exposes the existing Theme selector and variable controls in Details. Theme color editing is click-based, not drag-based.
- The top toolbar indicates the active mode; selecting Screen mode or closing the primary Workflow or Spec view in the dock returns to normal Screen mode. Pressing Escape closes the topmost Workflow or Spec view; if it is primary, this exits that mode. Escape also exits Theme mode.
- Workflow mode shows the Mermaid graph in a resizable, closeable bottom dock while keeping the Screen visible above it.
- Spec mode shows the spec editor in the resizable, closeable bottom dock while keeping the Screen visible above it.
- A Spec editor opened from Workflow mode replaces the dock's current view; closing it reveals the workflow graph and leaves Workflow mode active.
- A workflow graph opened from Spec mode replaces the dock's current view; closing it reveals the spec editor and leaves Spec mode active.
- Closing the primary Workflow or Spec view in the dock exits that mode. Escape closes the topmost view, returning to the underlying mode when nested or exiting to Screen mode when primary.
- Selecting a workflow node switches to and centers its referenced Screen, state, placement, or group without leaving Workflow mode.
- Exiting Workflow or Spec mode after cross-Screen navigation leaves the canvas on the last referenced Screen; validate this in the prototype.
- Workflow execution starts at the first node with no incoming arrows in Mermaid source order; multiple entry points produce a warning. If all nodes have incoming arrows, show a warning and do not guess. A node without a SpecUX placement link produces a warning; multiple linked placements are valid only when they share one Screen and state.
- When a node has multiple valid placement links, highlight all linked placements and fit their combined bounds in the canvas. Invalid or missing links produce a warning without choosing an arbitrary placement.
- Cycling spec links centers Screen and placement targets; workflow links open the linked graph in the bottom dock without entering Workflow mode or activating workflow-node behavior.
- Theme mode is available from the Screen's right-click context menu and reuses the existing Theme selector and variable controls in Details; editing Theme colors is click-based, not drag-based.
- Screen and placement spec indicators are hidden by default; a toolbar toggle controls their visibility on both the canvas and in the Layers list.
- The Material source editor is not an overlay. Opening it replaces the Screen workspace with the Material editing workspace; provide a clear way to return to Screen editing.
- The Material selector, Details pane, and bottom dock can be closed and reopened from persistent toolbar controls.
- Automatically save edits during normal work and use Git changes to identify modifications since the last commit. Closing an overlay or changing modes does not discard edits; save failures remain visible and must not be reported as successful saves.

## Material selection and adding placements

The Material selector is separate from the Material editor and provides a visual way to add placements to the Screen. Its previews should be useful for identifying Materials without changing how those Materials render on the canvas.

The agreed preview-framing behavior is:

1. In the Material editor, show a preview box that can be resized and repositioned to define what is visible in the selector preview.
2. In the Material selector, transform the Material preview to fit within the selector tile using that framing.
3. When dragging a Material from the selector onto the Screen, show an outlined placement preview at the Material's known preview size. The selector tile's framing affects only its thumbnail and does not resize the placed Material.

This framing is for selector presentation only; it must not change the Material's STML markup or a placed instance's geometry.

## Specs and Workflows: proposed access model

This is a proposal to review, not a confirmed decision.

- Mirror ownership in the UI: the project owns cross-Screen specs; a Screen owns its Screen behavior spec and the workflows that start from it, even when those journeys cross into other Screens; an Element spec belongs to the specific placement it documents within that Screen. Reusable Materials remain shared visual definitions, not behavior-spec owners.
- Keep the Project page as the project-wide summary and provide an action there to create project-level specs. Create workflows from the owning Screen's Specs & Workflows tab.
- Provide workflow management within the active Screen: users can select an existing workflow, add a workflow that starts from that Screen, or delete a workflow it owns. Selecting a workflow enters Workflow mode and opens its Mermaid graph in the bottom dock while leaving the Screen visible above it.
- Use the Details pane's Specs & Workflows tab to list project-wide and Screen/placement specs, and to select/open, add, or delete workflows owned by the active Screen.
- Make creation contextual: create a workflow for the active Screen, create a Screen spec for the active Screen, or create an Element spec for the selected placement.
- Double-clicking a placement opens its Element spec, creating it if it does not exist. Provide an explicit open/create action in Details as an alternative.
- Double-clicking empty canvas opens the active Screen's behavior spec, creating it if it does not exist. Empty space means the canvas background, not a placement or dock; provide an explicit open/create action in Details as an alternative.
- In Workflow mode, double-clicking a node opens its node-specific spec, creating it if needed, in the bottom dock without switching to Spec mode. Opening the node's linked spec also leaves Workflow mode active.
- In Spec mode, provide navigation through links in document order. Screen and placement links center their targets on the canvas; workflow links open the linked graph in the bottom dock without switching to Workflow mode or activating workflow-node behavior.
- Opening a spec keeps the Screen visible in Spec mode; opening a node's spec from Workflow mode leaves Workflow mode underneath.

## Design questions to resolve

- Should Theme mode be opened by right-clicking the Screen background, a placement, or both?
- How should double-click spec shortcuts be distinguished from existing canvas interactions such as zooming or panning?
- How should node-specific workflow specs be stored and identified, and can a workflow node have multiple specs?
- Which existing workflow editor controls and layout modes must be retained in Workflow mode?
- How should the toolbar expose controls for reopening each closed panel without crowding the top bar?
- Which actions in linked workflow and spec dock views should be available without changing the active mode?
- How should the Material preview and STML source editor be arranged within the Material editing workspace?
- How should the workspace adapt to narrow windows and small screens?
- Where should a Material be placed when the user clicks it in the selector rather than dragging it onto the Screen?
- What should the default framing be for Materials that have not been customized?
- How should selector-preview framing be stored and represented in the Material editor?

## Implementation outline

1. Review the current Screen, workflow, and preview interactions and identify behavior that can be reused.
2. Prototype the Screen-first layout, top toolbar, default panel positions, and close/reopen controls while preserving existing Screen editing controls.
3. Add explicit Screen, Workflow, Spec, and Theme modes, with a resizable bottom dock for the closeable workflow graph and spec editor.
4. Connect workflow-node selection to the referenced Screen, state, placement, or group; support opening node specs and linked workflows without changing the active mode.
5. Add a Material selector for previewing and placing Materials, with drag-to-canvas support.
6. Design Material-specific selector preview framing and integrate its configuration into Material editing.
7. Define and integrate creation, selection, and deletion for Screen-owned workflows, plus creation and navigation for Screen and placement Element specs.
8. Integrate workflow editing and source access into the unified workspace.
9. Design and implement one project-wide undo/redo history for Screen, Material, Workflow, Spec, and Theme edits; exclude navigation and selection changes.
10. Add focused tests for the new interactions and update the Screen editor requirements and related documentation.

## Success criteria

- The Screen remains visible in Screen, Workflow, Spec, and Theme modes; Workflow and Spec editors use a resizable bottom dock, and only Material editing replaces the Screen workspace.
- Closing the workflow graph returns from Workflow mode to Screen mode; closing the mode's spec editor returns from Spec mode to Screen mode.
- Workflow-node selection switches to and centers its referenced Screen, state, placement, or group.
- Opening a spec from Workflow mode or a workflow from Spec mode preserves the underlying mode; closing the dock view returns to it.
- Theme mode is reachable from the Screen's right-click context menu, exposes Theme selection and variable controls in Details while keeping the Screen visible, and can be exited from the top toolbar or with Escape. Workflow and Spec dock views can be closed directly or with Escape; closing a primary view exits its mode.
- Users can create and reopen workflows and the relevant Screen or Element spec from the Screen-centered workspace.
- Double-clicking a placement or empty canvas opens the corresponding Element or Screen spec, creating it if needed; equivalent explicit actions are available in Details.
- The existing Project page remains available as a project-wide summary and provides an action to create project-level specs; workflows are created from a Screen.
- Users can select, add, and delete workflows owned by the active Screen.
- Selecting a workflow node with multiple valid placement links highlights and fits all linked placements; missing or invalid links produce a warning instead of arbitrary focus.
- The browser URL uses `#specux=<path>` for the canvas target and the app's existing URL parameters for the active editor and mode, so both contexts are restored when opened.
- Browser history adds an entry when switching Screens; navigation among targets on the current Screen does not add entries.
- Workflows use the first node with no incoming arrows in Mermaid source order as the entry point and warn about multiple entry points. If all nodes have incoming arrows, warn and do not guess. Every node expects a SpecUX placement link; multiple links are allowed only for placements on the same Screen and state.
- Selecting a node with multiple valid placement links highlights and fits all linked placements; missing or invalid links produce a warning instead of arbitrary focus.
- Users can optionally show indicators on Screens and placements that have specs; indicators are hidden by default, and a toolbar toggle controls their visibility on both the canvas and in the Layers list.
- Users can select a Material from a separate selector or drag it onto the Screen to create a placement; dragging shows an outline at the Material's known preview size, independent of selector thumbnail framing.
- Users can resize and close the Workflow/Spec bottom dock, and close/reopen the Material selector and Details pane independently.
- Editing a Material switches to a Material editing workspace instead of opening the STML source as an overlay.
- Selector previews can be framed without changing Material markup or placed geometry and fit into the selector tiles.
- Users can undo and redo Screen, Material, Workflow, Spec, and Theme edits through one project-wide history; navigation and selection changes are not undoable.
- Edits persist automatically, Git identifies changes since the last commit, and closing dock views or switching modes does not discard them.
- Existing Screen composition, workflow references, and save behavior continue to work.
