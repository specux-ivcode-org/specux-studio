const fs = require("node:fs/promises");
const path = require("node:path");
const { SPECUX_VERSION, validateProject } = require("../project");
const {
  locateProjectRoot,
  parseOptions,
  printValidationResult,
  repositoryRoot,
  schemaFiles
} = require("./support");

/** Prints one requested schema or all supported schema documents. */
async function runSchemaCommand(args) {
  // Validate the requested schema name and select one or all schema documents.
  if (args.length > 1) throw new Error("Usage: specux schema [project|screen|material|theme|spec|workflow|reference]");
  const type = args[0];
  const docs = type ? [schemaFiles.get(type)] : [...schemaFiles.values()];
  if (type && !docs[0]) {
    throw new Error(`Unknown schema type "${type}". Use project, screen, material, theme, spec, workflow, or reference.`);
  }

  // Read the selected documents and write them with separators for multi-schema output.
  const content = await Promise.all(docs.map((file) =>
    fs.readFile(path.join(repositoryRoot, "schema", file), "utf8")
  ));
  process.stdout.write(content.join("\n\n---\n\n"));
}

/** Prints the CLI version after rejecting unexpected arguments. */
function runVersionCommand(args) {
  if (args.length) throw new Error("Usage: specux version");
  console.log(SPECUX_VERSION);
}

/** Validates the selected project and returns its validation exit status. */
async function runValidateCommand(args) {
  // Resolve the selected project, validate it, and convert findings to a CLI status.
  const { positional, options } = parseOptions(args, new Set(["--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const result = await validateProject(projectRoot);
  return printValidationResult(result);
}

/** Builds the starter project file paths and their initial contents. */
async function createStarterFiles() {
  // Generate the starter manifest, Screen, Materials, and Theme in memory.
  const YAML = await import("../../shared/yaml.mjs");
  return [
    ["project.yml", YAML.stringify({
      name: "SpecUX Project",
      specux: SPECUX_VERSION,
      screens: [{ id: "home", file: "screens/home/screen.yml" }],
      theme: "theme.yml"
    })],
    ["screens/home/screen.yml", YAML.stringify({
      name: "Home",
      description: "Starter Screen for the SpecUX project.",
      layers: [{ id: "base", name: "Base" }],
      materials: [
        {
          id: "welcome",
          src: "materials/label.stml",
          attributes: { text: "Welcome to SpecUX" },
          position: { x: 48, y: 48 },
          size: { width: 360, height: 56 },
          rotation: 0,
          layer: "base"
        },
        {
          id: "get-started",
          src: "materials/button.stml",
          attributes: { text: "Get started" },
          position: { x: 48, y: 128 },
          size: { width: 160, height: 48 },
          rotation: 0,
          layer: "base"
        }
      ]
    })],
    ["materials/label.stml", [
      "---",
      "id: label",
      "name: Label",
      "type: label",
      "attributes:",
      "  text:",
      "    type: string",
      "    default: Label",
      "    overridable: true",
      "---",
      '<div class="material-visual material-visual-label">${attributes.text}</div>',
      ""
    ].join("\n")],
    ["materials/button.stml", [
      "---",
      "id: button",
      "name: Button",
      "type: button",
      "attributes:",
      "  text:",
      "    type: string",
      "    default: Button",
      "    overridable: true",
      "---",
      '<div class="material-visual material-visual-button">${attributes.text}</div>',
      ""
    ].join("\n")],
    ["theme.yml", YAML.stringify({
      tokens: {
        primary: "#4569e8",
        ink: "#1e293b",
        background: "#f3f6fa"
      }
    })]
  ];
}

/** Finds starter files that already exist so initialization does not overwrite them. */
async function findInitConflicts(projectDirectory, files) {
  const conflicts = [];
  for (const [relativePath] of files) {
    try {
      await fs.lstat(path.join(projectDirectory, relativePath));
      conflicts.push(relativePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return conflicts;
}

/** Creates starter files and removes already-written files if any write fails. */
async function writeStarterFiles(projectDirectory, files) {
  // Create files without overwriting existing content, tracking each successful write.
  const createdFiles = [];
  try {
    for (const [relativePath, content] of files) {
      const target = path.join(projectDirectory, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: "wx" });
      createdFiles.push(target);
    }
  } catch (error) {
    // Remove partial output and preserve both the write and cleanup failures if needed.
    const cleanupErrors = [];
    for (const target of createdFiles) {
      try {
        await fs.rm(target);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "SpecUX initialization failed and some created files could not be removed."
      );
    }
    throw error;
  }
}

/** Creates the starter project files, refusing conflicts and cleaning up partial output. */
async function runInitCommand(args) {
  // Resolve the destination and prepare the complete starter file set.
  const { positional, options } = parseOptions(args, new Set(["--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);

  const workingDirectory = path.resolve(process.cwd(), options.project || ".");
  const projectDirectory = path.join(workingDirectory, "specux");
  const files = await createStarterFiles();

  // Refuse to overwrite any starter path before writing the project.
  const conflicts = await findInitConflicts(projectDirectory, files);
  if (conflicts.length) {
    throw new Error(
      `Cannot initialize SpecUX because these files already exist in "${projectDirectory}": ${conflicts.join(", ")}.`
    );
  }

  // Write the starter files and give the user the next validation step.
  await writeStarterFiles(projectDirectory, files);
  console.log(`Created SpecUX starter project in "${projectDirectory}".`);
  console.log('Run "specux validate" to check the new project.');
}

module.exports = { runInitCommand, runSchemaCommand, runValidateCommand, runVersionCommand };
