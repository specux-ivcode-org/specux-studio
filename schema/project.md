# Project Manifest Schema

Save the manifest at `specux/project.yml`, relative to the working directory.

The manifest and each entry are YAML mappings. Only the properties listed for each mapping are allowed; an unlisted property is invalid.

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | No | Project name. |
| `description` | string | No | Project description. |
| `specux` | string | Yes | SpecUX format version supported by the CLI. Use `0.1.0-SNAPSHOT` for the current pre-versioned format. |
| `screens` | list | Yes | Screen entries. |
| `theme` | string | Yes | Path to the Theme YAML file, relative to `specux/`. |
| `spec` | string | No | Path to the project's single OpenSpec-formatted behavior spec under `specs/`, relative to `specux/`. Use `specs/<lowercase-kebab-case-name>.md`. Use only for requirements that apply across multiple Screens or throughout the project, not for one Screen's behavior. |

Each Screen entry is a YAML mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Screen identifier. Must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. |
| `file` | string | Yes | Must be `screens/<screen-id>/screen.yml`. |

All manifest paths are relative to the `specux/` directory containing `project.yml`. Screen files live in `screens/<screen-id>/screen.yml`; reusable Materials and their local resources live under `materials/`. Screen behavior specs live in `screens/<screen-id>/specs/screen.md`, and project-wide specs remain in `specs/`. Use forward slashes. Do not use absolute paths, backslashes, empty path segments, `.` or `..` segments, or hidden path segments.

Screen IDs and paths must be unique. `screens` must be a YAML list and `theme` must be a non-empty string. Reusable Material STML files are discovered under `materials/`. See [`screen.md`](screen.md) and [`material.md`](material.md) for their schemas.

```yaml
name: Example application
description: A sample SpecUX project.
specux: "0.1.0-SNAPSHOT"
screens:
  - id: sign-in
    file: screens/sign-in/screen.yml
theme: theme.yml
spec: specs/project-behavior.md
```
