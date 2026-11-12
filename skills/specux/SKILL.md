---
name: specux
description: Explain SpecUX concepts, project structure, artifact responsibilities, versioning, and CLI capabilities. Use for general SpecUX questions that are not specifically UX design, implementation planning, or application building.
---

# SpecUX Context

Use this skill to explain the SpecUX standard and help users understand how a SpecUX project is organized and validated. For a specific action, use the matching focused skill: `specux-design` for collaborative UX design, `specux-plan` for implementation task breakdowns, and `specux-apply` for building the application UI and behavior.

## Core concepts

SpecUX is a versioned, file-based standard for describing application Screens, reusable visual Materials, Themes, user workflows, and functional behavior requirements. A project is identified by `project.yml`, which declares its SpecUX format version and references project artifacts. It may be in the workspace root or in a `specux/` subdirectory.

- **Screens** describe visual compositions and placements.
- **Materials** are reusable visual templates. They are visual-only and do not define application actions or behavior.
- **Themes** define visual tokens for consistent presentation.
- **Workflows** describe user actions, choices, and destinations.
- **Specs** define observable functional requirements and constraints.

Keep these responsibilities distinct: a workflow is not a functional contract, and a spec is not a Screen layout or an action-by-action flow. Use a project-, Screen-, or Element-level spec according to where behavior belongs.

## Project and CLI

Use the project-local SpecUX CLI whose format version matches the `specux` value in `project.yml`.

1. Identify the intended workspace. Look for `project.yml` in the current directory, its parents, or an `specux/` subdirectory. If more than one exists, use the project the user identified.
2. Read the project's `specux` value and check the local CLI:

```sh
npm ls specux-editor --depth=0
npx --no-install specux version
```

3. If the CLI is missing or its supported version does not match, do not change the project's declared version and do not silently use a global or mismatched CLI. Development mode currently supports `0.1.0-SNAPSHOT`; for a project on that version, install the development CLI from the host workspace root:

   ```sh
   npm install --save-dev git+https://github.com/specux-ivcode-org/specux-studio.git#main
   ```

   Rerun both checks and confirm the installed CLI reports the matching version. If the project's version is missing or unavailable, stop and ask how to proceed.
4. If there is no `project.yml`, install the development CLI using the same command, then run `npx specux init`. Do not initialize a second project when one already exists.

Run commands with `npx specux <command>`.

The CLI provides version-matched schemas, project validation, Screen rendering, editor-state inspection, browser screenshots, and editor refresh coordination. It is not a project-file editing layer: edit project files directly, then use the CLI to validate, render, or notify the editor as appropriate.

Useful commands:

```sh
npx specux schema reference
npx specux schema project
npx specux schema screen
npx specux schema material
npx specux schema theme
npx specux schema spec
npx specux schema workflow
npx specux validate
npx specux render <screen-id> --format image --output <image-file>
npx specux server status
npx specux server state
npx specux server update
```

Use the `schema reference` and relevant artifact schemas before authoring. Read `doc/cli.md` or run `npx specux schema reference` for command behavior and current format guidance. If the project version is missing or unavailable in the installed CLI, stop and ask how to proceed rather than changing project metadata.
