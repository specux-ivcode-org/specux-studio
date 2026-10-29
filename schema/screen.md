# Screen File Schema

A Screen is one YAML file named by an entry in `specux/project.yml` under `screens[].file`. Save the file under `specux/`; its path in the manifest is relative to that directory.

The Screen ID is defined by the matching `screens[].id` in `project.yml`; do not add an `id` property to the Screen file.

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | Yes | Human-readable Screen name. |
| `description` | string | Yes | Description of the Screen. |
| `note` | string | No | Implementation guidance for the Screen. |
| `spec` | string | No | Path to this Screen's behavior spec: `screens/<screen-id>/specs/screen.md`. |
| `layers` | list | Yes | Ordered layer stack, from topmost to bottommost. Every Screen must have at least one layer. |
| `materials` | list | Yes | Ordered list of independent visual materials. An empty list is allowed while building the Screen. |
| `preview-states` | list | No | Named visual states for previewing this Screen. If omitted, the Screen has an implicit `default` state. |

Screen Materials are instances of reusable STML templates. Labels and buttons are visual only; they do not execute actions or accept user input. Each instance can override declared template variables and has its own absolute position, size, and rotation.

## Preview States

Each item in `preview-states` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique state identifier using lowercase letters, numbers, and hyphens. The `default` state is required. |
| `name` | string | Yes | Non-empty label shown in the Studio preview-state selector. |
| `description` | string | Yes, except for `default` | Non-empty description of the visual state. |

Every non-default preview state must have a non-empty description. The implicit or explicit `default` state does not require one. Preview states are visual configurations; they do not define application navigation or executable behavior. Select another state to preview its material visibility configuration without changing the Screen's authored defaults.

When a Screen defines non-default preview states, each state ID must appear in a scenario step in a behavior spec linked to that Screen. Write the step as `- **SHOW** <state-id>` after that scenario's `THEN` step. `SHOW` records which preview state represents the scenario outcome; it does not make the state executable.

## Materials

Each item in `materials` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique Material ID on this Screen. |
| `src` | string | Yes | Path to a reusable STML Material file under `materials/`. |
| `attributes` | mapping | No | Instance-specific values for overridable variables declared in the Material's STML front matter. |
| `position` | mapping | Yes | Absolute canvas position in CSS pixels from the top-left corner: `{x, y}`. |
| `size` | mapping | Yes | Material dimensions in CSS pixels: `{width, height}`, each at least `24`. |
| `rotation` | number | No | Clockwise rotation in degrees around the material's center. Defaults to `0`. |
| `visibility` | mapping | No | Optional state-specific visibility values keyed by `preview-states[].id`. A missing state value means visible. |
| `note` | string | No | Optional implementation guidance. |
| `layer` | string | Yes | ID of a layer in the Screen's `layers` list. Every placement belongs to an explicit layer. |

Material markup and variable definitions are saved in the STML file; Screen YAML stores each instance's attribute overrides and transform. Edit a selected instance's variable fields to change only that placement. In the Studio, select one and drag it to move; use its handles to resize or rotate it. Open the Material file to edit its shared markup and variable definitions. A button Material is visual only and has no click behavior.

IDs must use lowercase letters, numbers, and hyphens and be unique within the Screen. Each `src` must reference a discovered Material file. Do not use the former `elements` property or asset templates for Screen composition.

## Layers

Each item in `layers` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique layer identifier using lowercase letters, numbers, and hyphens. |
| `name` | string | Yes | Non-empty layer name shown in the Studio. |
| `visible` | boolean | No | Whether the layer's placements are rendered. Defaults to `true`. |

The list is ordered from topmost to bottommost; placements in upper layers render above placements in lower layers. Within a layer, the order in `materials` determines stacking and can be changed in the Studio's selected-layer placement list. Every Screen must have at least one layer. New Screens start with a layer using the ID `base` and name `Base`, but it is an ordinary layer: it can be renamed, reordered, hidden, and deleted when another layer remains. Deleting a layer also deletes its placements. Older Screen files without a layer list are initialized with Base, but every placement must explicitly name a valid layer; missing or invalid layer assignments are rejected.

## Example

```yaml
name: Sign In
description: A visual-only sign-in composition.
layers:
  - id: base
    name: Base
materials:
  - id: welcome
    src: materials/label.stml
    layer: base
    attributes:
      text: Welcome back
    position:
      x: 48
      y: 48
    size:
      width: 320
      height: 56
    rotation: 0
  - id: continue
    src: materials/button.stml
    layer: base
    attributes:
      text: Continue
    position:
      x: 48
      y: 132
    size:
      width: 180
      height: 48
    rotation: 0
```

This example puts a placement on a named layer:

```yaml
layers:
  - id: foreground
    name: Foreground
  - id: background
    name: Background
    visible: true
  - id: base
    name: Base
materials:
  - id: welcome
    src: materials/label.stml
    layer: foreground
    position:
      x: 48
      y: 48
    size:
      width: 320
      height: 56
```

This example shows a visual message in a named preview state:

```yaml
preview-states:
  - id: default
    name: Screen
  - id: message-visible
    name: Message visible
    description: Show the confirmation message.
materials:
  - id: confirmation
    src: materials/confirmation.stml
    position:
      x: 48
      y: 220
    size:
      width: 320
      height: 48
    visibility:
      default: false
      message-visible: true
```
