# Agent instructions

## Keep schema documentation in sync

- Always check the relevant files under `schema/` when changing project file formats, validation rules, authoring conventions, or behavior documented as part of a schema.
- Update every affected schema file in the same change as the implementation, tests, and examples. Do not leave schema documentation for a follow-up.
- Use the matching schema file for the affected format, such as `schema/screen.md`, `schema/spec.md`, or `schema/workflow.md`. Update multiple schema files when a change crosses formats.
- Before finishing, verify that the documented fields, link formats, constraints, and examples agree with the code and tests.
