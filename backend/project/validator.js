const fs = require("node:fs/promises");
const path = require("node:path");
const validation = require("../../shared/validation");
const { isWithin, resolveProjectPath, safeRelativePath } = require("./paths");
const { addYamlErrorLocations, pushError } = require("./sourceLocations");
const { validateProjectMaterials } = require("./materialValidator");
const { validateProjectScreens } = require("./screenValidator");

const SPECUX_VERSION = "0.1.0-SNAPSHOT";

/** Validates the CLI version declared in the project manifest. */
function validateProjectVersion(project, errors) {
  if (typeof project.specux !== "string" || !project.specux) {
    errors.push("project.yml: specux must specify the SpecUX version.");
  } else if (project.specux !== SPECUX_VERSION) {
    errors.push(`project.yml: SpecUX version "${project.specux}" is not supported by this CLI (expected "${SPECUX_VERSION}").`);
  }
}

/** Validates optional project name and description values. */
function validateProjectDescription(project, errors) {
  if (project.name !== undefined && typeof project.name !== "string") {
    errors.push("project.yml: name must be a string.");
  }
  if (project.description !== undefined && typeof project.description !== "string") {
    errors.push("project.yml: description must be a string.");
  }
}

/** Validates project-manifest properties and reports retired workflow declarations. */
function validateProjectProperties(project, errors) {
  // Restrict the manifest to supported keys and require its Screen list.
  const projectProperties = new Set([
    "name", "description", "specux", "screens", "theme", "spec", "workflows"
  ]);
  for (const property of Object.keys(project)) {
    if (!projectProperties.has(property)) {
      errors.push(`project.yml: unsupported property "${property}".`);
    }
  }
  if (!Array.isArray(project.screens)) errors.push("project.yml: screens must be a list.");
  if (Object.hasOwn(project, "workflows")) {
    errors.push("project.yml: workflows are no longer supported; use project.spec or a Screen behavior spec.");
  }
}

/** Validates and records the project-level behavior spec path. */
function validateProjectSpec(project, referencedSpecPaths, errors) {
  if (project.spec === undefined) return;
  try {
    validation.validateSpecPath(project.spec);
    if (!project.spec.startsWith("specs/")) {
      throw new Error('Project behavior specs must be saved under "specs/".');
    }
    referencedSpecPaths.add(project.spec);
  } catch (error) {
    pushError(errors, "project.yml spec", error);
  }
}

/** Validates required Theme configuration and all project manifest fields. */
function validateProjectManifest(project, referencedSpecPaths, errors) {
  validateProjectVersion(project, errors);
  validateProjectDescription(project, errors);
  validateProjectProperties(project, errors);
  validateProjectSpec(project, referencedSpecPaths, errors);
  if (typeof project.theme !== "string" || !project.theme) {
    errors.push("project.yml: theme must name a Theme YAML file.");
  }
}

/** Validates a project entry's mapping and identifier before indexing its path. */
function validateEntryIdentity(entry, index, kind, errors) {
  if (!validation.isMapping(entry)) {
    errors.push(`project.yml: ${kind}[${index}] must be a mapping.`);
    return false;
  }
  if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
    errors.push(`project.yml: ${kind}[${index}] id must use lowercase letters, numbers, and hyphens.`);
    return false;
  }
  return true;
}

/** Reports properties outside the supported project-entry shape. */
function validateEntryProperties(entry, index, kind, errors) {
  for (const property of Object.keys(entry)) {
    if (!["id", "file"].includes(property)) {
      errors.push(`project.yml: ${kind}[${index}] has unsupported property "${property}".`);
    }
  }
}

/** Validates and records an entry's required, unique file path. */
function indexEntryFile(entry, kind, files, errors) {
  const locationKey = "file";
  if (typeof entry[locationKey] !== "string" || !entry[locationKey]) {
    errors.push(`project.yml: ${kind} "${entry.id}" must define ${locationKey}.`);
    return false;
  }
  if (files.has(entry[locationKey])) {
    errors.push(`project.yml: ${kind} references "${entry[locationKey]}" more than once.`);
  }
  files.add(entry[locationKey]);
  return true;
}

/** Indexes valid project entries and reports duplicate IDs and paths. */
function indexProjectEntries(entries, kind, errors) {
  const ids = new Set();
  const files = new Set();
  const validEntries = [];
  const sourceEntries = Array.isArray(entries) ? entries : [];
  for (const [index, entry] of sourceEntries.entries()) {
    if (!validateEntryIdentity(entry, index, kind, errors)) continue;
    validateEntryProperties(entry, index, kind, errors);
    if (ids.has(entry.id)) errors.push(`project.yml: ${kind} defines id "${entry.id}" more than once.`);
    ids.add(entry.id);
    if (indexEntryFile(entry, kind, files, errors)) validEntries.push(entry);
  }
  return validEntries;
}

/** Checks that each project Screen entry uses its canonical Screen YAML path. */
function validateScreenEntryPaths(screenEntries, errors) {
  for (const entry of screenEntries) {
    if (entry.file !== `screens/${entry.id}/screen.yml`) {
      errors.push(`project.yml: Screen "${entry.id}" file must be "screens/${entry.id}/screen.yml".`);
    }
  }
}

/** Loads every valid Screen document referenced by the project manifest. */
async function loadProjectScreens(screenEntries, readYaml, screens) {
  for (const entry of screenEntries) {
    const data = await readYaml(entry.file);
    if (data) screens.push({ id: entry.id, file: entry.file, data });
  }
}

/** Reads and validates all behavior specs referenced by the project or Screens. */
async function loadReferencedSpecs(referencedSpecPaths, specContents, projectRoot, errors) {
  for (const specPath of referencedSpecPaths) {
    if (specContents.has(specPath)) continue;
    try {
      const target = await resolveProjectPath(projectRoot, specPath, "file");
      const content = await fs.readFile(target, "utf8");
      validation.validateSpecContent(content);
      specContents.set(specPath, content);
    } catch (error) {
      pushError(errors, `Behavior spec "${specPath}"`, error);
    }
  }
}

/** Validates all Screen references within loaded behavior specs. */
function validateSpecScreenReferences(specContents, screens, errors) {
  for (const [specPath, content] of specContents) {
    try {
      validation.validateSpecScreenReferences(content, screens, specPath);
    } catch (error) {
      pushError(errors, `Behavior spec "${specPath}"`, error);
    }
  }
}

/** Validates named Screen State references in each Screen's linked behavior specs. */
function validateScreenSpecStateReferences(screens, linkedSpecsByScreen, specContents, errors) {
  for (const screen of screens) {
    const stateSources = [...(linkedSpecsByScreen.get(screen.file) || [])]
      .filter((specPath) => specContents.has(specPath))
      .map((specPath) => ({ path: specPath, content: specContents.get(specPath) }));
    try {
      validation.validateScreenSpecStateReferences(
        stateSources,
        validation.validatePreviewStates(screen.data, screen.file),
        screen.file
      );
    } catch (error) {
      pushError(errors, `${screen.file} Screen State specs`, error);
    }
  }
}

/** Loads and validates the configured project Theme file. */
async function validateProjectTheme(project, readYaml, errors) {
  if (typeof project.theme !== "string" || !project.theme) return;
  const theme = await readYaml(project.theme);
  if (!theme) return;
  try {
    validation.validateTheme(theme, project.theme);
  } catch (error) {
    pushError(errors, project.theme, error);
  }
}

/** Loads project files, validates their structure and references, and returns errors plus parsed data. */
async function validateProject(projectRoot) {
  // Prepare shared YAML parsing and indexes used across project validation phases.
  const YAML = await import("../../shared/yaml.mjs");
  const errors = [];
  const yamlDocuments = new Map();
  const materialFiles = new Map();
  const screens = [];
  const referencedSpecPaths = new Set();
  const specContents = new Map();

  /** Reads and parses a project YAML mapping, recording its source for error locations. */
  async function readYaml(relativePath) {
    // Resolve and parse a mapping while retaining source text for precise diagnostics.
    try {
      const target = await resolveProjectPath(projectRoot, relativePath, "file");
      const source = await fs.readFile(target, "utf8");
      const document = YAML.parseDocument(source);
      yamlDocuments.set(relativePath, { document, source });
      if (document.errors.length) {
        for (const issue of document.errors) {
          const position = issue.linePos?.[0];
          errors.push(
            `${relativePath}${position ? `:${position.line}:${position.col}` : ""}: ${issue.message}`
          );
        }
        return null;
      }
      const data = document.toJS();
      if (!validation.isMapping(data)) throw new Error("must contain a YAML mapping.");
      return data;
    } catch (error) {
      pushError(errors, relativePath, error);
      return null;
    }
  }

  /** Confirms a referenced project file exists and reports errors at its source position. */
  async function checkFile(relativePath, source, position) {
    // Confirm project references resolve to permitted files and attach source context.
    try {
      await resolveProjectPath(projectRoot, relativePath, "file");
      return true;
    } catch (error) {
      if (position) {
        error.line = position.line;
        error.column = position.column;
      }
      pushError(errors, source, error);
      return false;
    }
  }

  // Load the manifest first because every later validation step depends on it.
  const project = await readYaml("project.yml");
  if (!project) {
    return {
      errors: addYamlErrorLocations(errors, yamlDocuments),
      project: null,
      materialFiles,
      screens,
      referencedSpecPaths
    };
  }

  // Index manifest entries and load the referenced Screens and Materials.
  validateProjectManifest(project, referencedSpecPaths, errors);
  const screenEntries = indexProjectEntries(project.screens, "screens", errors);
  validateScreenEntryPaths(screenEntries, errors);
  await loadProjectScreens(screenEntries, readYaml, screens);
  await validateProjectMaterials({ projectRoot, YAML, errors, yamlDocuments, materialFiles, checkFile });

  // Validate Screen structures before resolving their behavior-spec references.
  const linkedSpecsByScreen = await validateProjectScreens({
    projectRoot, screens, materialFiles, errors, referencedSpecPaths, specContents
  });
  await loadReferencedSpecs(referencedSpecPaths, specContents, projectRoot, errors);

  // Check relationships among loaded specs, Screens, their states, and the Theme.
  validateSpecScreenReferences(specContents, screens, errors);
  validateScreenSpecStateReferences(screens, linkedSpecsByScreen, specContents, errors);
  await validateProjectTheme(project, readYaml, errors);

  // Attach known YAML locations and return both diagnostics and parsed project data.
  return {
    errors: addYamlErrorLocations(errors, yamlDocuments),
    project,
    materialFiles,
    screens,
    referencedSpecPaths
  };
}

module.exports = { SPECUX_VERSION, isWithin, resolveProjectPath, safeRelativePath, validateProject };
