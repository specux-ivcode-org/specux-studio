# SpecUX CLI

**Status:** Implemented prototype.

The SpecUX CLI helps people and AI agents inspect and validate a SpecUX project while using the browser editor. Artifact authoring guidance is available under `schema/` and through `specux schema`. It is not a second file-editing layer: edit project files directly, then use the CLI to check the project, inspect a rendered Screen, and refresh the editor.

Run the commands as `specux ...` when the package's `bin` entry is available, or from this repository with `npm run specux -- ...` (or `node cli.js ...`). Commands that operate on a project discover `project.yml` in the current directory or a parent directory, including an `specux/` subdirectory. Use `--project <directory>` to select a different project.

## Commands

| Command | Purpose |
| --- | --- |
| `specux server start [--port <port>] [--project <directory>]` | Start the local editor server in the foreground. The command blocks until interrupted. Defaults to port `3000` (or `SPECUX_PORT` / `PORT`) and binds to `127.0.0.1`. |
| `specux server status [--port <port>]` | Check whether the editor server is reachable and print JSON with its URL, connected browser count, and selection availability. |
| `specux server selected [--port <port>]` | Print JSON containing the current browser-editor selection, its Screen's temporary annotations, and the time it was last updated. |
| `specux server annotations [clear] [--port <port>] [--screen <id>]` | Read temporary Screen annotations as JSON, or clear them for the selected Screen (or the Screen named by `--screen`). |
| `specux server update [--port <port>]` | Notify connected browser tabs after project files have changed. Tabs without unsaved edits refresh; tabs with unsaved edits are left untouched and prompted to save or reset before refreshing. |
| `specux init [--project <directory>]` | Create a starter project under `<directory>/specux` (defaults to the current directory). Refuses to overwrite any generated file that already exists. |
| `specux validate [--project <directory>]` | Validate project resources, discovered Assets, local file references, and references between resources. |
| `specux version` | Print the SpecUX format version supported by this CLI. `specux --version` is an alias. |
| `specux schema [project\|screen\|asset\|theme\|spec\|reference]` | Print Markdown authoring guidance. Use `reference` for the version-matched authoring workflow; without a type, print all guidance. |
| `specux render <screen> --format <html\|image> [--state <id>] [--output <file>] [--annotations] [--project <directory>]` | Render a Screen by ID, optionally using a named preview state, as HTML or a PNG image. Image output can include temporary editor annotations. |
| `specux prune [--apply] [--project <directory>]` | Report unreferenced files in discovered asset directories. No files are removed unless `--apply` is supplied. |

`--port` selects the local server port for `server` commands. Server commands default to port `3000` or the `SPECUX_PORT` / `PORT` environment setting.

## Temporary Screen annotations

In the Screen preview, choose **Annotate**, select a drawing tool, and mark an area. Pen, circle, rectangle, arrow, highlighter, and note marks are available. Undo, redo, and Clear manage the current Screen's marks. Notes can carry short instructions; you can also describe marks in your AI conversation.

Annotations are held in the running editor server's memory and are not saved to project files. They remain available to the AI while the editor page is open; refreshing or reopening the editor clears the annotations and cached browser snapshot. `specux server selected` includes the selected Screen's marks and any associated Element paths. Use `specux server annotations [--screen <id>]` to inspect them, or `specux server annotations clear [--screen <id>]` to clear them. Without `--screen`, `clear` uses the Screen currently selected in the editor.

## Initialization

Run `specux init` from the working directory where the `specux/` project folder should be created. Use `--project <directory>` to choose another working directory:

```sh
specux init
specux validate
specux server start
```

The command creates `project.yml`, a `home` Screen under `screens/home/`, a Screen-owned `page-layout` template Asset under `screens/home/assets/`, and a default Theme. It does not overwrite existing files; if any generated path already exists, initialization stops with an error.

## Rendering

Rendering validates the project before opening the Screen. A Chromium-based browser must be installed; set `SPECUX_BROWSER` to its executable path to choose a specific browser.

HTML is written to standard output unless `--output <file>` is given. Local project resources used by the rendered markup are embedded in the HTML output. Image rendering captures the full Screen height as a PNG file and requires `--output`:

```sh
specux render sign-in --format html --output sign-in.html
specux render sign-in --format image --output sign-in.png
specux render home --format image --state add-item-open --output home-dialog.png
```

`--state <id>` selects a Screen's `preview-states[].id` for either output format. If omitted, the `default` state is rendered. The command reports an error when the state ID is not defined on that Screen.

Add `--annotations` to use a PNG snapshot of the browser-rendered Screen preview, including its temporary annotation overlay. After each annotation change, the editor sends a snapshot to the local server, which writes it to a project-keyed temporary file. The CLI reads that file directly; rendering does not contact the server. The editor invalidates the snapshot when its selected Screen preview changes, so finish an annotation with the desired Screen, state, and viewport active before rendering. If `--state` is supplied, it must match the snapshot's state. The editor tab may be minimized after the snapshot is saved. If there is no current snapshot, the CLI reports that immediately rather than waiting for the browser:

```sh
specux render home --format image --annotations --output home-annotated.png
```

## Pruning

Pruning is non-destructive by default: `specux prune` reports unreferenced files without removing them. Applying the cleanup requires `--apply`. An Asset is a candidate when no Screen Element or local template resource references it. Applying prune removes only the candidate files; there is no Asset registry to update in `project.yml`. A project-level behavior spec is for requirements shared across Screens or throughout the project; Screen-level specs describe page behavior and state activation, while Element specs cover behavior specific to placed Elements.

## Intended workflow

1. Start the editor with `specux server start` and check it with `specux server status`.
2. Use `specux server selected` to get context about the item selected in the browser editor and any annotations on its Screen. Target text can identify a specific item inside an Asset; `specux render <screen> --format image --annotations` captures a full Screen image with the marks overlaid.
3. Read the version-matched authoring workflow with `specux schema reference`, then consult `specux schema [type]` for an artifact's format details.
4. Edit project files directly.
5. Run `specux validate` to catch malformed files and project-level issues.
6. Run `specux render <screen> --format image [--state <id>] --output <file>` to inspect the rendered result, including a named visual state when needed.
7. Run `specux server update` to refresh the browser editor after making changes.
