## 1. Resolve dependent design decisions

- [x] 1.1 Confirm Theme context-menu targets, linked-view actions, Escape/focus precedence, and Project-spec behavior with no Screen selected; record decisions and relevant scenarios before implementing those interactions.
- [x] 1.2 Define node-spec path/identity, multiplicity, and rename/delete behavior using the existing workflow-node Markdown association where possible; document any required API/schema changes before node-spec creation work.
- [x] 1.3 Define and verify a Mermaid-compatible multi-placement link convention, source-order entry extraction, and invalid-target canvas behavior; update the design/specs before parser changes.
- [x] 1.4 Define URL serialization for primary/linked editor context and multi-placement focus while retaining a canonical `specux` fragment and legacy query-only links.
- [x] 1.5 Confirm invalid-source recovery, external-write conflict handling, undo/redo autosave/history lifetime, and text/gesture/creation/deletion transaction boundaries before replacing current persistence behavior.
- [x] 1.6 Confirm Material click/drop defaults, full-preview selector sizing, Material source/preview arrangement, and small-window/panel sizing behavior before their dependent UI/schema work.

## 2. Separate navigation context

- [x] 2.1 Introduce explicit active mode, document owner, displayed Screen/state/placement set, and dock context through the existing navigation layer; keep editor-specific controllers responsible for their own state.
- [x] 2.2 Add transitions distinguishing manual toolbar Screen selection from Workflow/Spec reference navigation, including cross-Screen ownership preservation and last-Screen retention on exit.
- [x] 2.3 Implement linked dock push/pop and primary close/reopen transitions without discarding editor drafts or parent navigation position.
- [x] 2.4 Add focused transition tests for primary versus linked close/Escape, manual Screen selection, cross-Screen references, and retained last Screen.

## 3. Build the Screen-centered shell

- [x] 3.1 Integrate top-toolbar Screen selection/creation, zoom, mode indication, and persistent panel controls while retaining the Project overview and its project-spec creation action.
- [x] 3.2 Place the Material selector on the left and Details on the right; organize Details into Properties, States, Layers, and Specs & Workflows using current Screen/placement controls.
- [x] 3.3 Implement the resizable bottom dock using existing layout primitives where suitable, with usable canvas bounds and the responsive behavior confirmed in 1.6.
- [x] 3.4 Replace continuous grid lines with subtle dots without changing canvas coordinates, snapping, or zoom/pan behavior.
- [x] 3.5 Integrate Theme entry and click-based controls in Details, toolbar/Escape exits, and the focus/dialog precedence confirmed in 1.1.
- [x] 3.6 Review a working shell prototype, including the last-Screen-on-exit trial, and record any user-directed changes before final layout acceptance.

## 4. Integrate workflow navigation and management

- [x] 4.1 Move the existing workflow graph/source and retained authoring controls into the dock without introducing a second independent Screen-preview controller.
- [x] 4.2 Add Screen-owned workflow selection, creation, and deletion to Specs & Workflows, retaining ownership during cross-Screen navigation.
- [x] 4.3 Implement no-incoming-arrow entry detection in source order, warnings for multiple entries, and warning/no guessed start for graphs with no entries.
- [x] 4.4 Implement the multi-placement convention from 1.3, normalize omitted state to Default, resolve nested placement paths, and warn for missing/unresolved/incompatible targets without deleting legacy graph source.
- [x] 4.5 Highlight all valid linked placements and fit their combined transformed bounds within the visible canvas; implement the invalid-selection behavior confirmed in 1.3.
- [x] 4.6 Add workflow tests for entry order, cycles, compatible Default/named-state target sets, incompatible/broken links, multi-target framing, and nested grouped-reference maintenance; update `schema/workflow.md` with changed conventions and examples in this implementation phase.

## 5. Integrate contextual specs

- [x] 5.1 Implement Screen-mode placement/background double-click and equivalent Details open/create actions using current spec discovery; distinguish canvas gestures and avoid duplicate specs.
- [x] 5.2 Implement node-specific spec discovery/creation using the identity and storage policy from 1.2, keeping it separate from the target Screen/Element spec.
- [x] 5.3 Integrate ordered Spec link navigation and linked Workflow/Spec dock views with parent-mode preservation and without enabling Workflow-mode behaviors from Spec mode.
- [x] 5.4 Implement the hidden-by-default toolbar-controlled spec indicators on both the canvas and Layers list.
- [x] 5.5 Cover ownership, create/reopen, linked-view navigation, and indicator visibility in focused tests; update `schema/spec.md` and any affected project/Screen schema alongside the creation changes.

## 6. Integrate Material selection and authoring

- [x] 6.1 Provide selector tiles using existing Material preview/default-size behavior; integrate click-to-edit and retain drag/editor-action placement interactions.
- [x] 6.2 Implement Material-to-Screen dragging with a known-size outline in zoom/pan-adjusted Screen coordinates and the confirmed drop defaults, without altering the Material template or using thumbnail display size.
- [x] 6.3 Provide dedicated Material preview and integrated STML source with clear return-to-Screen and Escape actions that retain pending edits.
- [x] 6.4 Display each Material's complete preview-size or type-default bounds in the selector; ignore legacy crop metadata without changing placement geometry.
- [x] 6.5 Test drag outline geometry under zoom, created placement independence, full-preview selector sizing, ignored legacy metadata, and Escape-based Material workspace return; update Material schemas and validators/examples together.
- [x] 6.6 Keep the selector's Edit Material context-menu action from changing Project navigation; cover the behavior with a focused test and update the living requirements.
- [x] 6.7 Ensure Escape returns to the active Screen from Material authoring regardless of entry path; handle the key before focused controls and cover Project-navigation entry with a regression test.
- [x] 6.8 Keep selector click-to-add in Screen mode; open or switch Materials from the selector while Material authoring is active, without creating placements; cover both modes with focused tests and update the Material requirements.

## 7. Implement URL restoration and browser history

- [x] 7.1 Extend `BrowserHistory.mjs` to serialize app editor/mode context separately from the encoded `specux` canvas fragment, using the convention resolved in 1.4.
- [x] 7.2 Restore both contexts from fresh-page URLs, including named states, nested placements, and linked/multi-placement views; preserve supported legacy query-only URLs and report invalid targets.
- [x] 7.3 Push history only on Screen-to-Screen switches, replace on same-Screen/editor/mode changes, and suppress additional pushes during initial sync and Back/Forward restoration.
- [x] 7.4 Extend `test/browser-history.test.js` with fragment round trips, fresh-page restoration, cross-Screen pushes, same-Screen replacements, and restoration without history growth.

## 8. Integrate autosave and unified edit history

- [x] 8.1 Extend `ProjectPersistence.mjs` with a version-aware serialized autosave scheduler and pending/saved/error status; retain edits across closed views and ensure newer edits survive older save acknowledgments.
- [x] 8.2 Implement the invalid-draft and external-write policies confirmed in 1.5, retaining current validation protections until the replacement policy is in place.
- [x] 8.3 Implement project-level edit transactions and undo/redo controls across Screen, Material, Workflow, Spec, and Theme, excluding navigation, selection, and layout-only changes.
- [x] 8.4 Integrate gesture/text coalescing and creation/deletion; record placement-tree edits and dependent spec/workflow reference rewrites together so undo/redo restores consistent multi-file state.
- [x] 8.5 Test autosave failures, edits during saves, closed-editor pending work, validation-blocked drafts, chosen external-write handling, cross-editor history, and coupled-reference undo/redo; ensure no automatic Git commit or push is performed.

## 9. Reconcile requirements and validate integration

- [x] 9.1 Update `doc/screen-editor-requirements.md` alongside implemented behavior, retaining stable IDs and marking superseded layout requirements; reconcile relevant `doc/editor.md`, CLI/capture documentation, and discussion-plan status.
- [x] 9.2 Verify existing composition, grouping/ungrouping, state preview, nested SpecUX references, Mermaid source access, and Project overview behavior through the existing targeted regression tests.
- [x] 9.3 Verify representative Screen/Workflow/Spec/Material previews and captures after reparenting layout hosts, including zoom/scroll focus and annotation coordinates.
- [x] 9.4 Run targeted Node tests as changes land, then `npm test`, `npm run lint`, and whitespace checks for final integration; resolve change-caused failures and confirm all capability scenarios and approved prototype decisions are covered.
