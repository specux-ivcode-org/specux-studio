# Material File Schema

A Material is a reusable, atomic HTML object stored as `specux/materials/<material-id>.stml`. Its STML file defines one visual object; a Screen places it using a reference and its own absolute transform.

The file contains YAML front matter followed by one HTML root element:

```stml
---
id: welcome-title
name: Label
type: label
preview-size:
  width: 240
  height: 56
attributes:
  text:
    type: string
    default: Label
    overridable: true
---
<div class="material-visual material-visual-label">${attributes.text}</div>
```

The `id` must match the filename without `.stml`. The front matter supports only these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Material identifier beginning with a lowercase letter and containing only lowercase letters, numbers, and hyphens. |
| `name` | string | Yes | Non-empty human-readable name. |
| `description` | string | No | Description of this visual object. |
| `type` | string | Yes | One of `label`, `button`, `surface`, `avatar`, `navigation-item`, `text-field`, `progress`, `divider`, or `checkbox`; identifies the Material's visual kind. |
| `preview-size` | mapping | No | Editor-only preview width and height in pixels, each an integer of at least 24. If omitted, the editor uses the default size for the Material type. |
| `attributes` | mapping | No | Variable definitions available to this Material's HTML. |

The HTML body must contain one balanced root element. Use `${attributes.<name>}` to reference a variable declared in the YAML front matter. Material attributes support `string`, `boolean`, `list`, and `number` types, with optional defaults and an `overridable` flag. Each Screen instance may set only overridable attribute values; omitted values use the declared default. The HTML must not reference undeclared attributes. Materials cannot define slots, undeclared placeholders, links, interactive controls, forms, scripts, or embedded documents. They are visual only and do not accept input or perform actions; represent a button with visual markup such as a styled `<div>`, not an interactive `<button>`. Inline styles and local resources may be used; local resource paths are relative to the `materials/` directory. Material styles must not set the CSS `z-index` property: Screen layer and placement order control stacking.

## Screen placement

A Screen references the Material file and stores instance attribute overrides and placement-specific transform. The same file can be referenced by multiple placements or Screens; each placement has its own `id`, optional `attributes`, position, size, rotation, and optional visibility.

The STML `preview-size` controls only the Material file editor's preview and does not change Screen placement sizes.

```yaml
materials:
  - id: welcome-title
    src: materials/label.stml
    attributes:
      text: Welcome back
    position:
      x: 48
      y: 48
    size:
      width: 320
      height: 56
    rotation: 0
```
