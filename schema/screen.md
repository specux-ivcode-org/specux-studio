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
| `materials` | list | Yes | Ordered list of visual Material placements and groups. An empty list is allowed while building the Screen. |
| `preview-states` | list | No | Named visual states. Each state inherits the Screen's Default values and stores only its visual overrides. If omitted, the Screen has an implicit `default` state. |

Screen Material placements are instances of reusable STML templates. Labels and buttons are visual only; they do not execute actions or accept user input. Each instance can override declared template variables and has its own position, size, and rotation. Placements can also be grouped into Screen-local containers; groups are not reusable STML Materials.

## Preview States

Each item in `preview-states` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique state identifier using lowercase letters, numbers, and hyphens. The `default` state is required. |
| `name` | string | Yes | Non-empty label shown in the Studio state selector. |
| `description` | string | Yes, except for `default` | Non-empty description of the visual state. |
| `layers` | mapping | No | Sparse layer visibility overrides keyed by layer ID, with each value shaped as `{visible: boolean}`. |
| `placements` | mapping | No | Sparse visual overrides keyed by placement ID. Values may override `visible`, `attributes`, `position`, `size`, `rotation`, `scale`, and `affine`; omitted values inherit from Default. |

Every non-default state must have a non-empty description. The implicit or explicit `default` state does not require one and cannot contain overrides. A named state inherits all base placements and layers, including placements added later, unless it has an override for that item. Attribute override values may be `null` to remove an attribute inherited from Default. Legacy per-placement `visibility` mappings remain supported; new edits use `preview-states[].placements.<placement-id>.visible`. States are visual configurations; they do not define application navigation or executable behavior.

The Default state is the structural source of truth. Adding or deleting placements, changing layers, and grouping or ungrouping are available only in Default. In a named state, users may change placement visibility, Material attributes, placement transforms, and layer visibility. These edits are saved as state overrides through the normal Screen save flow.

When a Screen defines non-default preview states, each state ID must appear in a scenario step in a behavior spec linked to that Screen. Write the step as `- **SHOW** <state-id>` after that scenario's `THEN` step. `SHOW` records which preview state represents the scenario outcome; it does not make the state executable.

## Material placements

Each item in `materials` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique placement ID on this Screen. |
| `src` | string | Yes | Path to a reusable STML Material file under `materials/`. |
| `attributes` | mapping | No | Instance-specific values for overridable variables declared in the Material's STML front matter. |
| `position` | mapping | Yes | Position in CSS pixels from the parent canvas or group coordinate space. Top-level placements use Screen-canvas coordinates. |
| `size` | mapping | Yes | Material dimensions in CSS pixels: `{width, height}`, each at least `24`. |
| `rotation` | number | No | Clockwise rotation in degrees around the material's center. Defaults to `0`. |
| `scale` | number or mapping | No | Positive transform scale. A number applies uniformly; `{x, y}` sets positive X/Y factors. Defaults to `1`. |
| `affine` | mapping | No | Non-singular linear transform matrix `{a, b, c, d}`. Used to retain shear when group transforms are baked into placements during ungrouping. |
| `visible` | boolean | No | Default-state placement visibility. Defaults to `true`. |
| `visibility` | mapping | No | Legacy state-specific visibility values keyed by `preview-states[].id`. A missing value inherits the placement's Default visibility. New state edits are stored in the matching state override instead. |
| `note` | string | No | Optional implementation guidance. |
| `layer` | string | Yes at the Screen root | ID of a layer in the Screen's `layers` list. Top-level placements require a layer; placements inside a group inherit the group's layer and must not define one. |

Material markup and variable definitions are saved in the STML file; Screen YAML stores each instance's attribute overrides and transform. Edit a selected instance's variable fields to change only that placement. In the Studio, select one and drag it to move; use its handles to resize or rotate it. Open the Material file to edit its shared markup and variable definitions. A button Material is visual only and has no click behavior.

## Groups

A group is a Screen-local placement container with this shape:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique placement ID within the Screen, including IDs on nested descendants. |
| `type` | string | Yes | The literal value `group`. |
| `children` | list | Yes | Non-empty ordered list of Material placements or nested groups. |
| `position` | mapping | Yes | Top-left position in the parent coordinate space. |
| `size` | mapping | Yes | Group's unscaled width and height in CSS pixels, each at least `24`. The pivot is fixed at the center of this rectangle. |
| `rotation` | number | No | Clockwise rotation in degrees around the fixed group pivot. Defaults to `0`. |
| `scale` | number or mapping | No | Positive transform scale applied to the group and all descendants. A number applies uniformly; `{x, y}` sets positive X/Y factors. Defaults to `1`. |
| `affine` | mapping | No | Non-singular linear transform matrix `{a, b, c, d}`. Used to retain shear when group transforms are baked into groups during ungrouping. |
| `visible` | boolean | No | Default-state group visibility. A hidden group hides all descendants. Defaults to `true`. |
| `visibility` | mapping | No | Legacy state-specific visibility for the group. A hidden group hides all descendants; a missing value inherits the group's Default visibility. |
| `note` | string | No | Optional implementation guidance. |
| `layer` | string | Yes at the Screen root | Root group layer. Descendants inherit this layer; nested groups must not define `layer`. |

Children use coordinates relative to their containing group's top-left corner. Group transforms compose from outermost to innermost; each group's rotation and transform scale apply around its own fixed center pivot. The order of each `children` list controls stacking within that group. Group IDs and Material placement IDs share one unique-ID namespace for the Screen.

The Studio can create a group from a Ctrl multi-selection only when the selected placements are consecutive siblings in stacking order and belong to the same layer. Choose **X/Y** in the Screen toolbar to resize dimensions, or **Transform** to scale the rendered placement without changing its base dimensions. The toolbar choice is temporary; the resulting size or transform is saved in Screen YAML. Right-click a group and choose **Ungroup** to restore its children at that stack position while preserving composed transforms, including shear.

IDs must use lowercase letters, numbers, and hyphens and be unique across all placements and groups in the Screen. Each Material placement `src` must reference a discovered Material file. Do not use the former `elements` property or asset templates for Screen composition.

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
  - id: account-details
    type: group
    layer: base
    position:
      x: 420
      y: 48
    size:
      width: 240
      height: 96
    rotation: 0
    scale: 1
    children:
      - id: account-label
        src: materials/label.stml
        attributes:
          text: Account
        position:
          x: 0
          y: 0
        size:
          width: 180
          height: 40
      - id: account-action
        src: materials/button.stml
        attributes:
          text: Manage
        position:
          x: 0
          y: 48
        size:
          width: 180
          height: 48
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
layers:
  - id: base
    name: Base
materials:
  - id: confirmation
    src: materials/confirmation.stml
    layer: base
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
