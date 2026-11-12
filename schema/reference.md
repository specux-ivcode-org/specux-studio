# SpecUX Authoring Reference

This reference is versioned with the SpecUX CLI. Read the target project's `specux` version from `project.yml` and use a CLI with the same value. Use `specux schema project`, `screen`, `material`, `theme`, `spec`, and `workflow` for the complete artifact schemas.

## Project discovery

- Work in the existing project the user identified. The project root is the directory containing `project.yml`, which may be in an `specux/` subdirectory.
- Read `project.yml` to find Screen IDs and files, the Theme, and any project-wide behavior spec. Reusable Material files are discovered under `materials/`.
- Keep each Screen in `screens/<screen-id>/screen.yml`. Put the Screen spec in `screens/<screen-id>/specs/screen.md`; project-wide specs remain in `specs/`.
- Do not initialize a second project or change the project's SpecUX version as a shortcut.

## Create or revise a Screen

1. Read the relevant `specux schema` guidance before authoring or changing an artifact. This includes `project`, `screen`, `material`, `theme`, `spec`, and `workflow`.
2. A Screen ID belongs in `project.yml`, not the Screen YAML file. A Screen can be empty while it is being built. Create or reuse an STML Material template, then add an instance referencing it to the Screen's `materials` list.
3. Define shared visual markup and YAML attribute mappings in the Material's STML file. Reference declared values as `${attributes.<name>}` in the HTML. Set instance-specific values in its `attributes` mapping and each Screen instance's absolute `position`, `size`, and optional `rotation`; instance data and transforms belong to the placement, not the shared Material.
4. Materials are visual only: do not model inputs, actions, layout groups, or slots.
5. Keep visual variations such as a message-visible or empty state on the same Screen. Define named Screen States in the Screen file's `preview-states` field; every non-default state needs a concise description. Include `- **SHOW** <state-id>` in a scenario after `THEN` in the Screen-level spec. Set a Material's `visibility` mapping for states where it should be hidden; unspecified states are visible. These are visual configurations, not executable application behavior.

## Behavior specs

Materials do not accept input or trigger actions. Do not invent behavior specs for Label or Button Materials.

- Use a project-level spec for behavior shared across Screens and a Screen-level spec for that Screen's behavior and Screen State activation.
- Add Markdown links such as `[Home](specux://screen/home/screen.yml)`, `[Dialog state](specux://screen/home/screen.yml?state=dialog-open)`, `[Save button](specux://screen/home/screen.yml?placement=save-button)`, or `[Nested save button](specux://screen/home/screen.yml?placement=dialog.actions.save-button)` to control the behavior spec editor's preview. Use dot-separated placement IDs from the outermost group to the nested target; existing single placement IDs remain supported. Element specs in `screens/<screen-id>/specs/element-<placement-id>.md` must link to their owning placement; do not use `element-id` YAML front matter.
- Grouping and ungrouping update existing placement links in behavior specs to follow the same target. If a link targets a group that is ungrouped, remove only its `placement` parameter and preserve its Screen and state context.
- Keep shared Material markup and variable definitions in its STML file and instance-specific attribute values and transforms in Screen YAML; do not add individual Material behavior specs.
- Write each spec in OpenSpec format with `## Purpose`, `## Requirements`, named `### Requirement:` headings, immediate normative statements, and named `#### Scenario:` sections. Scenario steps use bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` bullet keywords. Screen specs use `SHOW <state-id>` after `THEN` and reference every non-default Screen State. Keep requirements observable and testable; do not include implementation plans or repeat visual details already shown by the mockup.
- Replace example draft content with behavior derived from the user's intent and project context. Do not save an unchanged example draft.

Before finishing, inspect the complete Screen and verify every Material reference resolves to a valid STML file and each placement has intentional absolute transform values.

## Validate, render, and coordinate with the editor

1. Run `specux validate` and fix every reported issue.
2. Render each changed Screen to inspect the complete composition:

   ```sh
   specux render <screen-id> --format image [--state <screen-state-id>] --output <image-file>
   ```

   Use `--format html` to inspect generated markup. If Chromium is not found, set `SPECUX_BROWSER` to its executable path.
3. Before opening or refreshing the editor, run `specux server status`. If unavailable, start it with `specux server start`; keep it running. The default URL is `http://127.0.0.1:3000/`. Use `--port` or `--project` when needed.
4. After direct project-file edits, run `specux server update` to notify connected browser tabs. Tabs with unsaved edits are left untouched and prompted to save or reset before refreshing.
5. Do not report completion until validation succeeds and the rendered Screen has been checked when rendering is available. Clearly state any check that could not be run.

Use `specux server selected` when the user asks about the browser editor's current selection or has drawn temporary Screen annotations; its JSON includes the marks, Material paths, and nearby target text when available. Use `specux render <screen> --format image --annotations --output <file>` to capture a full Screen image with the marks overlaid. Use `specux server annotations clear` to remove marks from the selected Screen when requested. Annotations are temporary server memory, not project files. Edit project files directly; the CLI provides schema guidance, validation, rendering, and editor coordination. Preserve unrelated user changes and avoid committing generated renders unless requested.

## Final validation checklist

- [ ] Does every Material reference resolve to a valid STML definition with one HTML root element?
- [ ] Does every Material have an absolute position and a valid size and rotation?
- [ ] Are alternate visual states represented as Screen States with Material visibility?
- [ ] Does the installed CLI version from `specux version` match the project's `specux` value?
- [ ] Does `specux validate` succeed without errors?
- [ ] Have changed Screens been rendered and visually inspected when rendering is available?
- [ ] Have changed project files been saved, and has the editor been refreshed or notified when applicable?
