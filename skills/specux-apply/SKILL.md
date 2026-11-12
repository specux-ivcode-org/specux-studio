---
name: specux-apply
description: Implement an agreed SpecUX design and plan as application UI and behavior, using Specs, Workflows, and CLI-rendered reference images. Use when asked to build or apply planned feature work.
---

# Apply a SpecUX Plan

Build the agreed experience from its Specs, Workflows, design artifacts, and implementation task list. Do not silently change product decisions.

## Shared SpecUX context

Use the `specux` skill for shared project discovery, format-version matching, CLI setup, command conventions, and SpecUX artifact responsibilities. Follow that guidance before running commands or authoring artifacts. Use the project's version-matched schemas and always invoke the CLI with `npx specux <command>`.

## Read and map the work

Read the relevant Specs and Workflows as primary implementation inputs. Use Specs for observable behavior and constraints; use Workflows for user actions, branches, and destinations. Map each applicable requirement and workflow path to implementation tasks and verification checks. Read the agreed design artifacts, `plan.md` if present, repository instructions, source files, and existing tests. Preserve unrelated user changes.

If requirements conflict or omit a consequential behavior decision, surface the conflict before implementing that part. If no written task plan exists, make a concise working breakdown from the request and current artifacts; proceed when the UX and requirements are clear.

## Capture visual references

Before building the UI, use the version-matched SpecUX CLI to render relevant existing Screens and visual states as reference images. Save them to a temporary/reference location, not project source unless requested. For example:

```sh
npx specux render <screen-id> --format image --output <reference-path>.png
npx specux render <screen-id> --format image --state <state-id> --output <state-reference-path>.png
```

For an active editor view, including unsaved edits or a Material preview, use connected-browser capture when available:

```sh
npx specux server screenshot --output <editor-reference-path>.png
```

This requires a running editor server and a connected browser. Inspect resulting images alongside the relevant Specs, Workflows, and design before implementing the UI. Images provide visual context, not a replacement for requirements or workflow behavior. If a relevant reference cannot be captured, state that and proceed only from available artifacts and source; never imply an image was inspected.

## Build the agreed experience

- Work through task dependencies and map acceptance criteria to repository architecture and conventions.
- Implement the UI, state, data behavior, and integrations required by the agreed design; preserve accessibility and responsive behavior.
- Keep Screen, Material, Theme, Workflow, and Spec responsibilities within their documented boundaries.
- For feature implementation, try to create or update both the applicable Workflow and Spec; explain if either genuinely does not apply. Keep them consistent with the implemented behavior.
- Keep changes focused and do not alter unrelated user work.

## Verify and report

Run the smallest relevant tests and checks; verify every acceptance criterion. For SpecUX changes, run `npx specux validate` and open affected workflows in Studio to confirm they render. Explain any unverified requirement or deviation from the plan, and update artifacts when appropriate.

Summarize what was implemented, how it maps to the design and planned tasks, and unresolved gaps. Do not claim completion for behavior that remains unimplemented or unverified.
