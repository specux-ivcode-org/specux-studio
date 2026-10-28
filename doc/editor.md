# Editor Requirements

**Status:** Draft requirements for the SpecUX editor; not normative.

The browser editor prototype is at the repository root; its sample project is in `specux/`. The prototype is exploratory and is used to try ideas and evaluate the intended experience. Its implementation choices and limitations are not requirements for the final product. This document describes the target product and should evolve as those requirements are refined.

| ID | Target requirement |
|---|---|
| ED-001 | Open a SpecUX project and resolve its Screens, reusable Material STML files, Theme, optional project- and Screen-level Markdown behavior specs, and supporting resources. Screen composition uses Material references with placement-specific transforms, not an Asset registry or layout template library. |
| ED-002 | Validate project structure and references on load, and make missing or invalid artifacts clear to the user. |
| ED-003 | Provide a selectable Project Overview with summaries of its Screens, reusable Materials, Theme, and attached behavior specs. Show a collapsible file tree for project configuration, Materials, and Screen files. Open supported files in their corresponding Studio views and keep selection consistent. Allow existing Material templates to be edited and placed again from the project tree or selected placement. |
| ED-004 | Keep the details inspector focused on the current selection: Project, project-level behavior spec, Theme, Screen, or selected Material. Do not mix unrelated entity details. |
| ED-005 | Render each Screen as a canvas of independent, visual-only Material instances. Support reusable Label and Button templates defined by single-root HTML in STML files. Give each instance its own variable overrides, absolute canvas coordinates, size, rotation, and optional preview-state visibility. Preserve project Theme tokens and contain project content within the preview. |
| ED-006 | Let users open and edit a reusable Material's STML markup and metadata. Provide direct canvas controls and inspector fields to move, resize, and rotate each placement independently. |
| ED-007 | Validate Material front matter, single-root HTML markup, local resources, and numeric placement transforms; report invalid values instead of silently substituting content or dimensions. |
| ED-008 | Edit Screen metadata, reusable Material files, placement transforms, and Theme values. Materials are visual only and do not accept input or execute actions. |
| ED-009 | Apply project Theme styles only to rendered project previews through shared semantic class names and tokens. Scope Theme CSS to preview content so project Themes cannot alter the editor interface. |
| ED-010 | Support project- and Screen-level Markdown behavior specs. Materials are visual only and do not have individual behavior specs. Require OpenSpec's structured Purpose, Requirements, and scenario format; treat specs as declarative behavior contracts, not executable actions or implementation plans. |
| ED-011 | Let a human inspect rendered results and record a review outcome for the relevant Screen, Material, or Theme. |
| ED-012 | Provide an explicit save action. The editor frontend sends changes to a Node.js server, which validates and writes them back to project files; the frontend does not write to the filesystem directly. Confine writes to the opened project root and report save failures. |
| ED-013 | Preserve project information when reading and writing files, including unknown fields or content the editor does not support. Never silently discard data or break compatibility. |
| ED-014 | Provide reliable error feedback for invalid values, unsupported features, missing files, and failed saves; do not silently substitute success-shaped results. |
| ED-015 | Support undo/recovery for user edits and allow the user to reload or revert to saved project data. |
| ED-016 | Let users position, resize, rotate, and remove Material placements directly on the canvas. Keep shared Material content in reusable STML files; do not turn Materials into layout groups or slot containers. |
| ED-017 | Create a Screen with a unique project ID and file, add it to the project manifest, and initialize it with an empty `materials` list. |
| ED-018 | Expose machine-readable context on each Material placement so browser inspection and automation can identify its owning Screen, placement ID, referenced Material file, and visible text or label. |
| ED-019 | Expose the current Screen ID and name on each Screen manifest file-tree entry and on major Screen-view containers, including the workspace context, main canvas, stage, and preview. Use the `data-specux-screen-id` and `data-specux-screen-name` attributes defined in `screen.md`. |
| ED-020 | Adapt the Studio interface to the operating system's light or dark color scheme, independently of the active project Theme, and respond to system preference changes while open. |
| ED-021 | Support one optional project-level OpenSpec-formatted behavior spec referenced by `project.spec` for requirements that apply across multiple Screens or throughout the project. Let users create or edit it from the Project Overview and persist a new file and manifest reference together only when its draft changes; discard an unchanged new draft when the user leaves it. Do not use it for Screen-specific behavior. |
| ED-022 | Let each Screen define named visual preview states, require a description for every non-default state, and switch the preview between them without altering authored defaults. Require each non-default state to be referenced with `SHOW <state-id>` after `THEN` in the Screen-level spec. Selecting a state shows its name, description, and per-Material visibility controls. Allow selecting hidden Materials from the Screen material list. |
| ED-023 | Provide a searchable Screen selector at the top of the file explorer, with available Screens searchable by name or ID. Selecting a Screen opens it, expands its path, and selects its `screen.yml` file. |
| ED-024 | Represent the active editor file in the URL and add a browser history entry when navigation changes to a different file. Back and Forward must restore the corresponding editor and selection without adding entries for edits within the same file. |
| ED-025 | Define reusable Materials as `.stml` templates under `materials/`, each with front matter variable mappings and one HTML root element. Store a Material reference and instance-specific variable overrides, ID, absolute position, size, rotation, and optional preview-state visibility in Screen YAML. |

## Target Page Layout (Proposed)

Use the current prototype's page structure as a starting point: a global header above a three-part workspace. This describes the intended information hierarchy, not fixed dimensions or a requirement to copy the prototype's visual styling.

- **Global header:** Show the product and current Screen context, plus project-wide actions and status such as save, undo, and unsaved changes.
- **Project files:** Provide a persistent, collapsible file explorer for project configuration, reusable Material files, and Screen files. Create Label instances through a direct control; open a Material file to edit its shared markup or place it on the current Screen.
- **Main canvas:** Give the selected Screen canvas the primary workspace. Keep review results and interaction feedback close to the preview without obscuring it.
- **Details inspector:** Place selection-specific details and editing controls beside the canvas. Show only the currently selected Theme, Screen, or Material; when nothing is selected, show a clear prompt.
- **Responsive behavior:** Preserve access to navigation and details on narrow screens by moving them into accessible collapsible panels or tabs. Do not simply remove these areas; prioritize the canvas and allow it to scroll or resize as needed.

## Prototype Context

The current prototype uses a local Node.js server to serve the editor and persist changes to the `specux/` example project. A searchable Screen selector switches Screens. Selecting `project.yml` opens the Project Overview; a Screen manifest opens its Screen with Preview and editable YAML views; Material files open a markup editor; Theme files open the Theme view; and Markdown specs open the spec editor. Screen YAML edits are parsed before they update the preview, and valid source is persisted on explicit save. Select a Material file in the project tree to edit its shared template or place another instance on the active Screen. Each instance stores its own variable overrides and transform, so changing one does not change the others. The server only allows edits to supported files under the example project. These are prototype constraints, not target-product requirements. Review-state persistence remains an open design decision.

When a behavior spec is open, selecting a Material only highlights it in the preview; Materials have no individual behavior specs.

File selections are reflected in the URL and browser history. Back and Forward restore the corresponding editor; changing the Screen preview/YAML subview or selecting a Material within the same Screen does not create another file-navigation entry.
