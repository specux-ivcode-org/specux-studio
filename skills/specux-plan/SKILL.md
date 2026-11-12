---
name: specux-plan
description: Turn agreed SpecUX designs, Specs, and Workflows into an implementation-ready task list with traceability, dependencies, and verification. Use when preparing feature work for application implementation.
---

# Plan SpecUX Application Work

This skill prepares agreed UX and behavior for implementation. Do not redesign the experience here. Resolve missing consequential product decisions with the user or route them to the `specux-design` skill.

## Shared SpecUX context

Use the `specux` skill for shared project discovery, format-version matching, CLI setup, command conventions, and SpecUX artifact responsibilities. Follow that guidance before running commands or authoring artifacts. Use the project's version-matched schemas.

## Gather planning inputs

Read the agreed UX/design artifacts, relevant Specs and Workflows, the feature request, repository instructions, and relevant application architecture. If the experience is not agreed, first use `specux-design`. Confirm the target workspace and preserve unrelated changes.

Use Specs and Workflows as the source for planning coverage. Inventory each applicable spec requirement and each workflow action, branch, and destination. Use requirements to identify what the application must do; use workflow paths to identify user-facing implementation slices and states. Group work into coherent, independently verifiable outcomes rather than mapping one requirement or node mechanically to one task.

For feature work, try to create or update both the applicable workflow and spec, explaining if either genuinely does not apply. Consult version-matched schemas, run `npx specux validate` after changing artifacts, and open affected workflows in Studio to confirm they render.

## Create the task list

Create a reviewable `plan.md` when work is substantial, spans multiple implementation steps, or the user requests a saved plan. Use the requested or repository-established location. Make the task list the primary deliverable. Include:

- Goal, scope, non-goals, and links to agreed design and SpecUX artifacts
- Acceptance criteria derived from the agreed design and relevant requirements
- Concrete stable-ID tasks, each with a clear outcome and verification method
- For every task, the source workflow action(s) and spec requirement(s) it covers
- Actual task dependencies; identify independent tasks
- Relevant application components, data/integration boundaries, and migration needs
- Tests, accessibility and responsive checks, and SpecUX validation/render checks
- Screen and state IDs for CLI-rendered visual references that Apply should capture
- Risks, assumptions, and blocking decisions

Use a table such as `ID | Task / outcome | Workflow and spec coverage | Depends on | Verification`. Every workflow path and spec requirement must map to at least one task, and every acceptance criterion must map to tasks and verification. Keep image-reference targets separate from build tasks. Do not duplicate design documents or restate the UX as a new proposal.

## Ready for Apply

The plan is ready when the experience and behavior are agreed, artifacts are valid or documented as exceptions, consequential decisions are resolved, and every required outcome has actionable tasks with dependencies and verification. Otherwise, return to Design or ask the user instead of marking it ready.

For plan-only requests, stop after presenting or saving the plan. When implementation is requested, hand the completed tasks to `specux-apply`.
