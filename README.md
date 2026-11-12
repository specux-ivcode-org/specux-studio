# SpecUX

The SpecUX Standard.

The `schema/` directory contains the SpecUX artifact schemas and authoring guidance. Other project documentation lives in `doc/`. Browser code lives in `frontend/`, server and CLI code in `backend/`, and YAML/validation code shared by both in `shared/`. The editor's sample SpecUX project remains in `specux/`. Run `npm install` once, then `npm start` to launch the local editor at `http://127.0.0.1:3000/`.

## Install

Install the CLI package and the SpecUX context and action skills from the <copilot-ref kind="repo" target-id="https://github.com/specux-ivcode-org/specux-studio" label="specux-ivcode-org/specux-studio" /> repository:

```sh
npm install --save-dev git+https://github.com/specux-ivcode-org/specux-studio.git#main
npx skills add https://github.com/specux-ivcode-org/specux-studio/tree/main/skills --skill specux --skill specux-apply --skill specux-design --skill specux-plan
```

Both commands install project-locally: npm records the CLI dependency in the current project's `package.json`, and the skill installer adds the general SpecUX context skill plus separate Design, Plan, and Apply skills to the current project for your detected coding agent. To install only selected skills, list their names after `--skill`. For GitHub Copilot, they are installed under `.agents/skills/`. The commands use the repository's `main` branch; this lets different projects use different SpecUX versions. Run the CLI with `npx specux <command>`.

See [Editor Requirements](doc/editor.md) for the current editor behavior and prototype status.

See the [Manual Regression Tests](manual-regression-tests/README.md) for browser-based regression checks.

See the [CLI documentation](doc/cli.md) for the commands and AI-assisted project workflow.
