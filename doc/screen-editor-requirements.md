# Screen Editor Requirements

**Status:** Living requirements baseline
**Scope:** Authoring and editing a Screen in SpecUX Studio.
**Initial baseline:** 2026-10-28

This document records the agreed behavior and constraints for the Screen editor. It complements the [Terminology](terminology.md), the general [Editor Requirements](editor.md), the [Screen file schema](../schema/screen.md), and the CLI's [annotation rendering requirements](cli.md). The schema defines the serialized format; this document defines the editing experience and its invariants.

When a Screen-editor requirement is added, changed, or removed, update this document in the same change as the relevant schema, implementation, documentation, and tests. Preserve stable requirement IDs where possible; mark superseded requirements rather than silently changing their meaning.

## Composition model

| ID | Requirement |
|---|---|
| SE-001 | A Screen is an absolute-positioned canvas composed of independent placements of reusable STML Materials. Screen composition must not depend on HTML layout/grouping assets or layout templates. |
| SE-002 | Each Material placement references a reusable Material and owns its own variable overrides, position, size, rotation, transform scale, and visibility. Top-level placements own a layer assignment; nested placements inherit their group's layer. Editing one placement must not alter another placement or the shared Material template. |
| SE-003 | Materials on the Screen canvas are visual-only. They do not execute actions or accept application input. |
| SE-004 | Keep Screen data and editing controls Screen-specific. Do not make a placement's Material markup or properties stand in for the Screen's composition or behavior spec. |

## Canvas and placement editing

| ID | Requirement |
|---|---|
| SE-010 | Use Screen-canvas pixel coordinates with the canvas origin at its top-left. A placement's position is its top-left coordinate; its size is width and height in pixels; rotation is clockwise around its center. |
| SE-011 | The canvas has a minimum coordinate extent of 1440 by 900 pixels and may extend to include placements beyond that extent. Canvas dimensions are not user-editable; zoom changes the editor view, not saved placement coordinates. |
| SE-012 | Provide canvas zoom from 25% through 200% in 10% increments and a direct reset to 100%. Keep X/Y rulers aligned with canvas pixels as the canvas is zoomed or scrolled. Rulers are Screen-editor UI and are not part of rendered Screen output. |
| SE-013 | Let users select and move placements on the canvas, resize them using handles, and rotate them using a rotation control. Support X/Y dimensions and persistent transform scale through the Screen properties editor. |
| SE-014 | Selecting a Screen placement must not automatically scroll the canvas or reposition the viewport. Selection must not cause the preview to jump. |
| SE-015 | Keep placement order stable when selecting a placement; selection alone must not change its visual stacking order. |
| SE-016 | Provide Preview and YAML views for the Screen. Accept YAML changes only when syntax and Screen semantics are valid; surface invalid data instead of silently repairing or dropping it. |

## Layers and placements inspector

| ID | Requirement |
|---|---|
| SE-020 | The Screen Details inspector has Properties and Layers tabs. Properties contains the selected Screen or placement's existing editable details; Layers contains the layer and placement lists. |
| SE-021 | Every Screen has at least one layer, and every placement must explicitly reference an existing layer. Reject missing or invalid layer assignments in Screen YAML and project validation; do not silently assign a layer during parsing or normalization. |
| SE-022 | New Screens start with a `Base` layer. Base is an ordinary layer: it can be renamed, reordered, hidden, and deleted under the same rules as other layers. |
| SE-023 | Users can create and rename layers. Layer order is topmost to bottommost, and placements in a higher layer render above placements in a lower layer. Layer visibility controls whether its placements are rendered. |
| SE-024 | Users can reorder layers and reorder placements within a layer by dragging. Users can move a placement to another layer by dropping it on that layer's row. Within-layer placement order controls stacking within that layer. |
| SE-025 | Deleting a layer deletes its placements. Do not move its placements to another layer. The last remaining layer cannot be deleted. |
| SE-026 | Present one row per layer in a Layers box and the selected layer's placements in a separate Placements box below it. The Layers box occupies 30% of the available inspector height; Placements uses the remainder. These proportions do not change with item count, and each list scrolls internally. |
| SE-027 | Layer rows and placement rows support reordering by drag-and-drop. Do not use a per-placement layer dropdown; dropping a placement on a layer row is the layer-assignment interaction. Keep the two-list organization compact and omit redundant read-only labels or helper text. |

## Grouping

| ID | Requirement |
|---|---|
| SE-060 | Let users group selected Screen placements together, resulting in a single new placement that represents the group. |
| SE-061 | Group only sibling items from the same layer and parent. The selection must form a consecutive block in that parent's stacking order; reject grouping when it does not. |
| SE-062 | Let users build a multi-selection by holding Ctrl while selecting placements on either the canvas or in the placement list. Ctrl-clicking an already-selected placement removes it from the selection. |
| SE-063 | Right-clicking a placement in the current selection, on either canvas tool or in the placement list, opens a context menu with a Group command. Group operates on the full selection and is available only when at least two placements satisfy SE-061. |
| SE-064 | Superseded by SE-074, which defines X/Y geometry resizing and persistent transform scaling for groups and Material placements. |
| SE-065 | Set the group pivot to the center of its bounds when the group is created and keep it fixed relative to the group. Rotating a group rotates all child positions around this shared pivot; each child's own rotation is combined with the group's rotation. |
| SE-066 | Groups can contain other groups. A group is one placement at its parent level, and the placement list represents the hierarchy with expandable group rows. A group's child order controls stacking within that group. |
| SE-067 | A group has one effective layer. Its descendants inherit that layer; moving a group to another layer moves the whole subtree. |
| SE-068 | Group transforms compose through the hierarchy. Child positions are relative to the containing group's top-left. Moving, scaling, or rotating a parent applies to all descendants while preserving each nested group's internal transforms and pivot. |
| SE-069 | Right-clicking a group offers an Ungroup command. Ungrouping dissolves that group and restores its children as siblings in the same stack position, preserving their world-space transforms and order. |
| SE-070 | Serialize groups as recursive Screen-local containers, not reusable STML Materials. Group and child placement IDs share one unique-ID namespace; validate the group/Material union and inherited layer rules before accepting or saving Screen data. |
| SE-071 | A placement inside a group, including a nested group, cannot be moved, resized, or rotated independently on the canvas or through its placement-transform fields. Only the outermost group can be transformed; ungroup a placement before editing its transform directly. |
| SE-072 | Provide separate Select and Drag to select canvas tools. Select preserves direct placement selection and transform gestures; Drag to select draws a marquee from anywhere on the canvas and selects top-level placements only when their visible screen-space bounds are fully enclosed by the marquee, except any placement whose bounds contain the drag-start point. |
| SE-073 | In Drag to select mode, a click without a drag clears the current selection. Right-clicking a placement opens its placement context menu in either canvas selection tool. Clicking outside the open menu dismisses it, including a click on the canvas. |

## Preview states and toolbars

| ID | Requirement |
|---|---|
| SE-030 | Let users select named visual states that inherit the Default Screen and apply sparse overrides to placement visibility, Material attributes, placement transforms, and layer visibility. Set placement visibility in the Placements list and layer visibility in the Layers list; do not duplicate visibility controls in Properties or state details. Missing overrides inherit the corresponding Default value; switching states never rewrites Default values. Allow hidden placements to be selected from the placement list. |
| SE-031 | Keep preview-state, zoom, view-mode, and annotation controls available on the Screen editor toolbars. When a toolbar is too narrow, overflow complete control groups into its menu; do not clone controls or break their event handlers. |
| SE-032 | Keep annotation tools and annotation actions in one toolbar group. Selecting an annotation tool enters annotation mode. Provide pen, circle, rectangle, arrow, highlight, and note tools, plus undo, redo, and clear actions. |
| SE-033 | Keep the annotation exit control in the annotation tool group and visible at all times. It is disabled outside annotation mode, has no visible text label, retains an accessible name, and is red while enabled. |
| SE-034 | Treat Default as the structural source of truth. Adding or deleting placements, editing layer structure, and grouping or ungrouping are available only in Default; disable those controls and reject those operations in named states. |
| SE-035 | Apply edits made in a named state immediately to that state's sparse overrides and persist them through the normal Screen save flow. Support state-specific placement transforms, Material attributes, placement visibility, and layer visibility. |
| SE-036 | New placements and layers added in Default appear in every named state through inheritance. Deleting structural items removes their associated overrides. |
| SE-037 | Grouping and ungrouping in Default must preserve each named state's resolved visual result, including transforms, per-placement visibility, and hidden-group behavior. |
| SE-038 | In a named state's Properties details, list its individual placement, attribute, and layer overrides with their values. Let users select one change and reset only that override to the inherited Default value. |
| SE-074 | Provide temporary X/Y and Transform resize modes in the Screen toolbar. X/Y mode changes saved dimensions (and scales a group's descendant geometry); Transform mode changes saved X/Y transform factors without changing base dimensions. Both modes apply to groups and individual placements. The selected toolbar mode is not saved, but resulting placement sizes and transforms are. |
| SE-075 | Ungrouping composes each child's transform with the removed group's transform and preserves the rendered result, including shear caused by non-uniform scaling of rotated descendants. Persist any resulting affine matrix on the child placement. |
| SE-076 | Draw a screen-aligned selection border sized to the placement's transformed bounds. Calculate those bounds from the full composed placement matrix, including scale, rotation, and affine transforms, but do not rotate, shear, or scale the border itself. Keep the border stroke and manipulation handles legible and aligned to the border under placement transforms. |
| SE-077 | Resizing or rotating a multi-selection treats the selected top-level placements as a temporary group: resize around the combined bounds and rotate around their shared center. Apply and persist the operation to every selected placement without creating a group; preserve the active X/Y or Transform resize mode. |

## Annotations

| ID | Requirement |
|---|---|
| SE-040 | Record annotations as structured vector data in Screen-canvas pixels, not as a browser-captured screenshot. Map pointer input correctly through canvas zoom and scrolling. |
| SE-041 | When an annotation targets a placement, retain its placement identity and Material reference where available so downstream tooling can associate the mark with the design. |
| SE-042 | Keep editor annotation data separate from Screen composition and use the structured annotations for the CLI's annotated render workflow. The CLI produces the PNG; the editor does not upload a screenshot as the annotation source. |

## Persistence and validation

| ID | Requirement |
|---|---|
| SE-050 | Persist Screen edits through the editor's explicit save flow and the backend's project-file validation. Follow the general save, error-reporting, and data-preservation requirements in [Editor Requirements](editor.md). |
| SE-051 | Validate placement dimensions and transforms, referenced Materials, layer definitions, and placement-to-layer references before accepting or saving Screen data. Do not accept a placement without a valid layer. |

## Related requirements and specifications

- [General Editor Requirements](editor.md): project-wide editing, save, error, and data-preservation requirements.
- [Screen file schema](../schema/screen.md): YAML fields and validation rules for Screens, layers, placements, and preview states.
- [CLI documentation](cli.md): structured annotation handoff and annotated image rendering.
