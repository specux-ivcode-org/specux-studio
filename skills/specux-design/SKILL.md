---
name: specux-design
description: Collaborate with users to design application UX and author version-matched SpecUX Screens, Materials, Themes, workflows, and behavior specs. Use when exploring or defining an experience before implementation planning.
---

# Design a SpecUX Experience

This skill owns collaborative UX design. Work with the user to define the experience and record agreed decisions in SpecUX artifacts. Do not turn this phase into an implementation task breakdown or build the application.

## Shared SpecUX context

Use the `specux` skill for shared project discovery, format-version matching, CLI setup, command conventions, and SpecUX artifact responsibilities. Follow that guidance before running commands or authoring artifacts. Use the version-matched `npx specux schema reference` and relevant format guidance before authoring.

## Understand the context

Inspect the existing product and relevant project artifacts. Identify users, their goals, product constraints, current navigation and patterns, and what should improve. Ask focused questions when goals, information priority, navigation, interaction, or important states have multiple reasonable interpretations. Recommend options where useful, but let the user decide consequential tradeoffs. Work incrementally: present a coherent UX direction, gather feedback, and revise it before treating it as agreed.

## Shape the experience

Collaborate on:

- User goals, tasks, and success criteria
- Screen structure, content hierarchy, and navigation
- Actions, transitions, choices, and feedback
- Important states such as loading, empty, error, disabled, selected, and success
- Responsive behavior, keyboard interaction, accessibility, and relevant visual direction
- Reusable Materials and Theme needs, without forcing implementation structure prematurely

### Screen and Material composition

Treat Materials as reusable, configurable visual components. Prefer small, focused components that compose into Screens and can be reused. When a component needs variations, expose suitable attributes rather than creating near-duplicates.

Prefer Screen composition and grouping for larger units made from smaller components, such as an item row made from an icon, text, and border. Use a larger Material when the whole unit is a coherent, configurable component reused as one. Avoid representing a whole Screen or major region as one Material.

Before authoring Materials, consult `npx specux schema material`; for placements and Screen groups, consult `npx specux schema screen`.

### Specs and workflows

A workflow describes user actions and how they connect, including choices and destinations; it is not a functional contract. A spec defines observable system requirements and constraints; it is not a narration of action order or visual composition. Specs can describe behavior such as backend communication, validation, transformation, and content formatting. Choose project-, Screen-, or Element-level ownership based on where behavior belongs. Materials are visual-only and do not have behavior specs.

For each feature design or revision, try to create or update both its workflow and spec. The workflow describes user actions; the spec describes functional requirements, including behavior tied to workflow actions and behavior that applies independently. If one artifact genuinely does not apply or cannot be completed, explain why. Use judgment for low-risk workflow details; call out meaningful assumptions and ask about ambiguities that could materially change behavior. Link relevant spec sections to workflow nodes where useful.

Keep requirements focused on observable system responsibilities. Most workflows should stay on one Screen unless the journey calls for navigation elsewhere. Follow current schemas for ownership and supported links. Run `npx specux schema spec` and `npx specux schema workflow` for authoring guidance.

## Record agreed design

Once the user agrees on the direction, create or update applicable Screens, Materials, Themes, workflows, and specs using current schemas. Put Screen composition, interaction behaviors, state coverage, and Material or Theme references in the appropriate artifacts instead of one catch-all document.

Run `npx specux validate` and open affected workflows in Studio to confirm they render. Keep unresolved decisions visible; do not present incomplete artifacts as approved. Do not make an implementation task breakdown here—hand the agreed experience to the `specux-plan` skill.

For design-only requests, stop after sharing the agreed direction and artifacts. When the user requests end-to-end delivery, continue to planning after consequential UX choices are agreed.
