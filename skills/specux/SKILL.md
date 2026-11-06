---
name: specux
description: Create, inspect, and update SpecUX projects using the version-matched SpecUX CLI reference. Use when asked to build or revise SpecUX Screens, assets, Themes, behavior specs, workflows, or project files.
---

# SpecUX

SpecUX is a versioned, file-based standard for describing application Screens, reusable or Screen-specific asset templates, Themes, and intended UI behavior. A SpecUX project is identified by its `project.yml`; the project-local `specux` CLI initializes, explains, validates, and renders those files. Always work with the CLI version that supports the project's declared SpecUX format version.

## Set up SpecUX

Keep the CLI and skill project-local, not global, so different projects on one machine can use different SpecUX versions. Install both from the <copilot-ref kind="repo" target-id="https://github.com/specux-ivcode-org/specux-studio" label="specux-ivcode-org/specux-studio" /> repository.

1. Identify the user's intended workspace. Look for `project.yml` in the current directory, its parents, and an `specux/` subdirectory. If more than one exists, select the one the user is asking about.
2. Check whether the SpecUX CLI is installed in the workspace's npm dependencies and whether that installed CLI is usable:

   ```sh
   npm ls specux-editor --depth=0
   npx --no-install specux version
   ```

   The second command prints the SpecUX format version supported by the installed CLI. A successful check does not by itself prove compatibility; compare it with the project's `specux` value in the next step.
3. If `project.yml` exists, read its `specux` value. This is the required format version. If the version is missing or unreadable, stop and ask the user; never change it just to fit an installed CLI. If the local CLI is missing or its supported format version does not match, install the CLI for the project's version before continuing.
4. Development mode currently provides only `0.1.0-SNAPSHOT`. For an existing project with that version and no matching local CLI, install the development build from the host workspace root (the directory whose `package.json` should own the dependency, not necessarily the directory containing `specux/project.yml`):

   ```sh
   npm install --save-dev git+https://github.com/specux-ivcode-org/specux-studio.git#main
   ```

   This installs the latest commit on the repository's `main` branch and records the exact resolved dependency in the workspace lockfile. Then rerun both checks in step 2 and confirm the CLI reports `0.1.0-SNAPSHOT`. No other SpecUX format versions are available in development mode yet; if an existing project declares another version, do not install a mismatched CLI or alter the project. Tell the user that version is unavailable and ask how they want to proceed.
5. If no `project.yml` exists, install the latest available SpecUX development build using the same command, then initialize a starter project in the intended workspace:

   ```sh
   npx specux init
   ```

   Initialization creates `specux/project.yml` with the format version supported by the installed CLI. Do not run `init` when a project already exists.
6. Once the local CLI version matches the project's version—or after initializing a new project—start here before authoring:

   ```sh
   npx specux schema reference
   ```


Run all SpecUX commands with `npx specux <command>` so they use the workspace-local CLI. Never silently fall back to a global or mismatched version.

## Materials

Treat Materials as reusable, configurable visual components. Default to small, focused components that can be composed into a Screen and reused in different contexts. When a component needs variations, expose suitable attributes rather than creating near-duplicate Materials.

Keep the library weighted toward small components. When a larger unit is made from multiple components, prefer composing and grouping those placements on the Screen rather than building one large Material. This is especially true for structures such as item rows: make the icon, text, border, and other parts separate placements, then group them when they should move or be managed together. Use a larger Material when the whole unit is itself a coherent, configurable component that is reused as one.

Before creating or editing a Material, run `npx specux schema material` for the version-matched file-format guidance. When composing placements or using Screen groups, consult `npx specux schema screen` for the Screen format and grouping rules.

| Guidance | Examples |
|---|---|
| Good: small, focused components | Button, text box, border |
| Usually better as a Screen group of smaller placements | Item row composed of an icon, text, and border |
| Okay: a larger component that is reused and configured as one unit | A reusable, configurable item row |
| Avoid: a whole Screen or major Screen region as one Material | Main Screen View |

## Spec scope

A spec defines **requirements**: what the system must do and the constraints it must satisfy. Many requirements describe how the system responds to a user action in a workflow, but a requirement does not need to correspond to an action. Specs can also define behavior such as backend communication, data validation or transformation, and text or content formatting. Requirements should have observable outcomes, but should not become a description of action order or visual composition.

A spec may cover a feature that involves several Screens. Choose its project-, Screen-, or Element-level owner based on where the functional behavior belongs; ownership does not turn the spec into a UI flow. Materials are visual-only and do not have behavior specs. Treat the user's intent as authoritative, and ask rather than inventing functional rules when outcomes are unclear.

Keep requirements focused on system responsibilities and constraints. For example, a spec can require submitting entered item details to a backend and formatting a returned timestamp in a defined way; it should not narrate the sequence of opening the dialog, submitting the item, and navigating to its details.

## Workflow scope

A workflow defines **user actions and how they connect**: what the user can do, in what order, and what choices or destinations follow. It is often focused on one Screen, but can include navigation to other Screens when that is part of the journey. It is a map of the user's actions, not a functional contract: it does not establish whether an action succeeds, define backend behavior or data rules, or set content-formatting requirements.

Use a workflow when showing the actions and their relationships helps explain the experience. Most workflows can stay within one Screen; include other Screens when the user journey actually moves between them. Do not create one for every requirement or use a diagram to fill gaps in the user's intent. Follow the current schema for file ownership and supported links.

## Using specs and workflows together

Use both when a feature has a meaningful sequence of user actions and requirements on how the system must behave. For example, the workflow can show the user opening Add Item, submitting the form, and navigating to the new item's Screen. The spec can define the required backend request, validation and error behavior, and formatting of returned text. The workflow says **what the user does**; the spec says **what the system is required to do** in response or independently.

When authoring:

1. Capture the user's actions and their sequence in a workflow when a diagram helps; keep it on one Screen unless the journey calls for navigation elsewhere.
2. Capture the user's stated requirements in a spec, including requirements tied to workflow actions and requirements that apply without a specific action.
3. Use judgment when workflow details imply unstated behavior. If the user wants full control, ask before filling gaps. Otherwise, make conservative, conventional inferences for low-risk details; call out meaningful assumptions for review, and ask when an ambiguity could materially change behavior.
4. Link relevant spec sections to workflow nodes where the connection helps show which requirements apply to an action.
5. Use `npx specux schema spec` and `npx specux schema workflow` for the version-matched syntax and file conventions. Run `npx specux validate`, and open each workflow in Studio to verify it renders.
