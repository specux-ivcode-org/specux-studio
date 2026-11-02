# SpecUX

The SpecUX Standard.

The `schema/` directory contains the SpecUX artifact schemas and authoring guidance. Other project documentation lives in `doc/`. Browser code lives in `frontend/`, server and CLI code in `backend/`, and YAML/validation code shared by both in `shared/`. The editor's sample SpecUX project remains in `specux/`. Run `npm install` once, then `npm start` to launch the local editor at `http://127.0.0.1:3000/`.

## Install

Install the CLI package and SpecUX authoring skill from the <copilot-ref kind="repo" target-id="https://github.com/specux-ivcode-org/specux-studio" label="specux-ivcode-org/specux-studio" /> repository:

```sh
npm install --save-dev git+https://github.com/specux-ivcode-org/specux-studio.git#main
npx skills add https://raw.githubusercontent.com/specux-ivcode-org/specux-studio/main/skills/specux/SKILL.md
```

Both commands install project-locally: npm records the CLI dependency in the current project's `package.json`, and the skill installer adds the skill to the current project for your detected coding agent. For GitHub Copilot, the skill is installed under `.agents/skills/specux/`. The commands use the repository's `main` branch; this lets different projects use different SpecUX versions. Run the CLI with `npx specux <command>`.

See [Editor Requirements](doc/editor.md) for the current editor behavior and prototype status.

See the [CLI documentation](doc/cli.md) for the commands and AI-assisted project workflow.
