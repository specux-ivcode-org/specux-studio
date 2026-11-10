const fs = require("node:fs/promises");
const path = require("node:path");
const { isWithin } = require("../project/paths");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const frontendRoot = path.join(repositoryRoot, "frontend");
const BOOLEAN_OPTIONS = new Map([
  ["--apply", "apply"],
  ["--annotations", "annotations"]
]);
const VALUE_OPTIONS = new Map([
  ["--port", { key: "port", parse: parsePort }],
  ["--format", { key: "format", parse: parseFormat }],
  ["--project", { key: "project", parse: (value) => value }],
  ["--screen", { key: "screen", parse: (value) => value }],
  ["--output", { key: "output", parse: (value) => value }],
  ["--state", { key: "state", parse: (value) => value }]
]);
const schemaFiles = new Map([
  ["project", "project.md"],
  ["screen", "screen.md"],
  ["material", "material.md"],
  ["theme", "theme.md"],
  ["spec", "spec.md"],
  ["workflow", "workflow.md"],
  ["reference", "reference.md"]
]);

/** Returns the help text listing supported commands and their options. */
function usage() {
  return [
    "SpecUX CLI",
    "",
    "Usage:",
    "  specux server start [--port <port>] [--project <directory>]",
    "  specux server status [--port <port>]",
    "  specux server state [--port <port>]",
    "  specux server screenshot --output <file> [--port <port>]",
    "  specux server annotations [clear] [--port <port>] [--screen <id>]",
    "  specux server update [--port <port>]",
    "  specux init [--project <directory>]",
    "  specux validate [--project <directory>]",
    "  specux version",
    "  specux schema [project|screen|material|theme|spec|workflow|reference]",
    "  specux render <screen> --format <html|image> [--state <id>] [--output <file>] [--annotations] [--project <directory>]"
  ].join("\n");
}

/** Separates positional arguments from allowed flags and validates option values. */
function parseOptions(args, allowedFlags) {
  // Separate positional arguments and decode each permitted option.
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (!allowedFlags.has(argument)) throw new Error(`Unknown option "${argument}".`);
    const booleanOption = BOOLEAN_OPTIONS.get(argument);
    if (booleanOption) {
      options[booleanOption] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Option "${argument}" requires a value.`);
    index += 1;
    const option = VALUE_OPTIONS.get(argument);
    options[option.key] = option.parse(value);
  }

  // Return both groups for command-specific validation and dispatch.
  return { positional, options };
}

/** Parses a port option and rejects values outside the supported range. */
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port "${value}". Use a number from 0 to 65535.`);
  }
  return port;
}

/** Restricts render format options to HTML or image output. */
function parseFormat(value) {
  if (!["html", "image"].includes(value)) {
    throw new Error(`Unsupported render format "${value}". Use "html" or "image".`);
  }
  return value;
}

/** Reports whether a path names a regular file, treating missing paths as false. */
async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

/** Finds a project.yml in the selected directory, an ancestor, or the bundled example. */
async function locateProjectRoot(startDirectory = process.cwd(), projectOption) {
  // Prefer an explicitly selected directory and support its nested specux project layout.
  if (projectOption) {
    const selected = path.resolve(startDirectory, projectOption);
    if (await isFile(path.join(selected, "project.yml"))) return selected;
    if (await isFile(path.join(selected, "specux", "project.yml"))) return path.join(selected, "specux");
    throw new Error(`No project.yml found in "${selected}" or its specux/ subdirectory.`);
  }

  // Walk upward from the working directory to find a project manifest.
  let directory = path.resolve(startDirectory);
  while (true) {
    if (await isFile(path.join(directory, "project.yml"))) return directory;
    if (await isFile(path.join(directory, "specux", "project.yml"))) return path.join(directory, "specux");
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  // Fall back to the bundled example only when the search starts inside this repository.
  if (isWithin(repositoryRoot, path.resolve(startDirectory)) &&
      await isFile(path.join(repositoryRoot, "specux", "project.yml"))) {
    return path.join(repositoryRoot, "specux");
  }
  throw new Error("Could not find project.yml. Run this command inside a SpecUX project or use --project <directory>.");
}

/** Prints validation errors when present and returns the CLI exit status. */
function printValidationResult(result) {
  // Report success directly when validation produced no errors.
  if (!result.errors.length) {
    console.log("SpecUX project is valid.");
    return 0;
  }

  // Print every validation issue and return a failing CLI status.
  console.error(`Found ${result.errors.length} validation error${result.errors.length === 1 ? "" : "s"}:`);
  for (const error of result.errors) console.error(`- ${error}`);
  return 1;
}

/** Selects and validates the editor server port from options or environment defaults. */
function resolveServerPort(options) {
  const port = options.port ?? Number(process.env.SPECUX_PORT || process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid server port "${port}".`);
  }
  return port;
}

module.exports = {
  frontendRoot,
  locateProjectRoot,
  parseOptions,
  printValidationResult,
  repositoryRoot,
  resolveServerPort,
  schemaFiles,
  usage
};
