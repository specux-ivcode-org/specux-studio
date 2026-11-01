# Theme File Schema

A project has one Theme YAML file named by the `theme` property in `specux/project.yml`, typically `specux/theme.yml`. Theme files contain token values only; Material STML owns component markup and CSS.

Every YAML mapping accepts only the properties listed in this schema. Token names must use lowercase letters, numbers, and hyphens; each token value is a string containing a CSS custom-property value.

The Theme YAML file may define one shared token map or separate Light and Dark token maps:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `tokens` | mapping | No | Tokens for a single-mode Theme. Each value must be a string. Cannot be combined with `modes`. |
| `modes` | mapping | No | Mode-specific token definitions. Supported keys are `light` and `dark`. |

Each entry under `modes` is a mapping with this property:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `tokens` | mapping | No | Tokens for this mode. Each value must be a string. |

Token names become CSS custom properties named `--theme-<name>`. For example, `primary: "#4569e8"` defines `--theme-primary`. Values may be colors or other CSS custom-property values such as gradients and shadows.

When only one mode is defined, the editor uses that mode for either appearance preference. When both modes are defined, missing tokens in the active mode fall back to the other mode. A top-level `tokens` mapping without `modes` defines a single-mode Theme.

```yaml
modes:
  light:
    tokens:
      primary: "#4569e8"
      on-primary: "#ffffff"
      ink: "#1e293b"
      background: "#f3f6fa"
  dark:
    tokens:
      primary: "#91a7ff"
      on-primary: "#10182b"
      ink: "#edf2ff"
      background: "#101827"
```
