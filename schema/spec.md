# Behavior Spec File

A behavior spec is a Markdown file linked from `project.yml` or a Screen YAML file through its optional `spec` property. A project-level spec covers requirements across multiple Screens or throughout the project and is saved under `specux/specs/`. A Screen-level spec covers page behavior and, when Screen States exist, documents their activation conditions; save it as `specux/screens/<screen-id>/specs/screen.md`. Materials are visual only and do not have individual behavior specs. All paths are relative to `specux/`.

The project may reference one project-wide spec, and each Screen may reference one Screen-level spec. Both use OpenSpec's structured behavior-spec format. Specs are declarative, testable guidance about observable behavior, not executable code or implementation plans.

Every spec must contain a non-empty `## Purpose` section followed by a `## Requirements` section with at least one requirement. Each requirement:

- Uses a `### Requirement: <name>` heading with a descriptive name shorter than 50 characters.
- Is followed immediately by a normative statement using `SHALL`, `MUST`, `SHOULD`, or `MAY`.
- Contains at least one `#### Scenario: <name>` with observable, verifiable behavior.
- Expresses scenario steps as bullets using bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` keywords. Every scenario must include at least one `WHEN` and one `THEN`. A spec linked to a Screen or one of its Elements may also use `SHOW <state-id>` after `THEN` to identify the Screen State representing that scenario's outcome.

Keep requirements focused on behavior, outcomes, constraints, and edge cases. Do not repeat visual details already clear from the Screen mockup unless needed to explain behavior. Avoid implementation details such as libraries, internal functions, or step-by-step coding plans.

## Workflow links

Link a behavior spec to a Screen workflow with a regular Markdown link. Place the link in any relevant section or scenario, outside fenced code blocks. The `node` query parameter must identify the Mermaid node that the spec reference describes:

```markdown
[Save item workflow](specux://screen/home/workflows/add-item.mmd?node=saveItem)
```

The Studio attaches the spec link to that workflow node. Selecting its spec icon previews the Markdown in the workflow editor's dedicated spec surface, separate from the Screen canvas, and navigates to the link's enclosing section without changing the node's Screen-preview link. When a spec links to the same workflow node from multiple sections, the preview's up/down selector navigates between those sections.

When viewing the behavior spec in the Spec editor, a link to a workflow opens that workflow diagram in the preview and focuses the linked node. The Spec editor's up/down selector traverses workflow and Screen links in document order.

When creating a new draft, the editor may prefill the example purpose, requirement, and scenario below. Treat that content as a placeholder, not as specified behavior. Do not save a new draft unless its content has been changed. Consult this schema and derive the final requirements from the user's intent and relevant SpecUX context.

```yaml
# In project.yml:
spec: specs/project-behavior.md
```

```yaml
# In a Screen YAML file:
spec: screens/home/specs/screen.md
```

For a Screen with non-default Screen States, reference every state from the Screen's spec:

```markdown
- **WHEN** the user opens the Add item dialog
- **THEN** the dialog is displayed over the dashboard
- **SHOW** add-item-open
```
