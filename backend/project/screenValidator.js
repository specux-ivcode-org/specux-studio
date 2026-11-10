const fs = require("node:fs/promises");
const validation = require("../../shared/validation");
const { resolveProjectPath } = require("./paths");
const { pushError } = require("./sourceLocations");
const { validateScreenStateOverrides } = require("./screenStateValidator");
const { validateScreenPlacement } = require("./screenPlacementValidator");

/** Lists conventionally named Element behavior specs under one Screen. */
async function listElementSpecPaths(projectRoot, screenId) {
  const relativeDirectory = `screens/${screenId}/specs`;
  let directory;
  try {
    directory = await resolveProjectPath(projectRoot, relativeDirectory, "directory");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => /^element-[a-z][a-z0-9-]*\.md$/.test(entry.name))
    .map((entry) => `${relativeDirectory}/${entry.name}`);
}

/** Validates the basic descriptive metadata on a Screen document. */
function validateScreenMetadata(screen, errors) {
  if (typeof screen.data.name !== "string") {
    errors.push(`${screen.file}: name must be a string.`);
  }
  if (typeof screen.data.description !== "string") {
    errors.push(`${screen.file}: description must be a string.`);
  }
  if (screen.data.note !== undefined && typeof screen.data.note !== "string") {
    errors.push(`${screen.file}: note must be a string.`);
  }
}

/** Loads validated Screen State definitions, falling back to Default after errors. */
function getScreenPreviewStates(screen, errors) {
  let previewStates = [{ id: "default", name: "Default" }];
  try {
    previewStates = validation.validatePreviewStates(screen.data, screen.file);
  } catch (error) {
    pushError(errors, screen.file, error);
  }
  return {
    previewStates,
    previewStateIds: new Set(previewStates.map((state) => state.id))
  };
}

/** Validates and records a Screen-level behavior spec path. */
function validateScreenSpec(screen, referencedSpecPaths, linkedSpecPaths, errors) {
  if (screen.data.spec === undefined) return;
  try {
    validation.validateSpecPath(screen.data.spec);
    if (screen.data.spec !== `screens/${screen.id}/specs/screen.md`) {
      throw new Error(`Screen behavior specs must be saved as "screens/${screen.id}/specs/screen.md".`);
    }
    referencedSpecPaths.add(screen.data.spec);
    linkedSpecPaths.add(screen.data.spec);
  } catch (error) {
    pushError(errors, `${screen.file} spec`, error);
  }
}

/** Reports the retired elements property when present on a Screen. */
function validateRetiredElements(screen, errors) {
  if (Object.hasOwn(screen.data, "elements")) {
    errors.push(`${screen.file}: Screen elements are no longer supported; use materials.`);
  }
}

/** Validates one Screen layer mapping and detects duplicate IDs. */
function validateScreenLayer(layer, index, screen, layerIds, errors) {
  const location = `${screen.file} layers[${index}]`;
  if (!validation.isMapping(layer)) {
    errors.push(`${location}: Layer must be a mapping.`);
    return;
  }
  try {
    validation.validateElementId(layer.id, location);
    if (layerIds.has(layer.id)) {
      errors.push(`${location}: Layer id "${layer.id}" is already used on this Screen.`);
    }
    layerIds.add(layer.id);
  } catch (error) {
    pushError(errors, location, error);
  }
  if (typeof layer.name !== "string" || !layer.name.trim()) {
    errors.push(`${location}: Layer name must be a non-empty string.`);
  }
  if (layer.visible !== undefined && typeof layer.visible !== "boolean") {
    errors.push(`${location}: Layer visible must be a boolean.`);
  }
  for (const property of Object.keys(layer)) {
    if (!["id", "name", "visible"].includes(property)) {
      errors.push(`${location}: unsupported property "${property}".`);
    }
  }
}

/** Validates all Screen layers and returns their IDs for placement validation. */
function validateScreenLayers(screen, errors) {
  const layerIds = new Set();
  if (screen.data.layers === undefined) return layerIds;
  if (!Array.isArray(screen.data.layers)) {
    errors.push(`${screen.file}: Screen layers must be a list.`);
    return layerIds;
  }
  screen.data.layers.forEach((layer, index) =>
    validateScreenLayer(layer, index, screen, layerIds, errors)
  );
  return layerIds;
}

/** Validates the list shape for top-level Material placements on a Screen. */
function hasScreenMaterials(screen, errors) {
  if (Array.isArray(screen.data.materials)) return true;
  errors.push(`${screen.file}: Screen "${screen.id}" materials must be a list.`);
  return false;
}

/** Validates all top-level placements and their Screen State overrides. */
async function validateScreenMaterials(screen, context, layerIds, previewStateIds) {
  // Build shared placement context and validate each top-level Material or group.
  if (!hasScreenMaterials(screen, context.errors)) return;
  const materialIds = new Set();
  const placementsById = new Map();
  const placementContext = {
    ...context,
    screen,
    layerIds,
    previewStateIds,
    materialIds,
    placementsById
  };
  for (const [index, material] of screen.data.materials.entries()) {
    validateScreenPlacement(material, [index], null, placementContext);
  }

  // Check state overrides only after every placement has been indexed.
  await validateScreenStateOverrides({
    screen,
    previewStates: context.previewStates,
    layerIds,
    placementsById,
    materialFiles: context.materialFiles,
    errors: context.errors
  });
}

/** Loads one Element spec and verifies that it links to its owning Screen and placement. */
async function validateElementSpec(specPath, screen, context, elementSpecIds, linkedSpecPaths) {
  // Reject invalid paths before resolving the Element spec file.
  try {
    validation.validateSpecPath(specPath);
  } catch (error) {
    pushError(context.errors, `Behavior spec "${specPath}"`, error);
    return;
  }

  // Load the spec, verify its Screen and placement link, and record its relationships.
  try {
    const target = await resolveProjectPath(context.projectRoot, specPath, "file");
    const content = await fs.readFile(target, "utf8");
    context.specContents.set(specPath, content);
    validation.validateSpecContent(content);
    const identity = validation.getElementSpecIdentity(specPath);
    if (!identity || identity.screenId !== screen.id) {
      throw new Error(`${specPath} is not a valid Element spec path for Screen "${screen.id}".`);
    }
    const { elementId } = identity;
    validation.validateElementSpecPath(specPath, elementId);
    const references = validation.parseSpecScreenReferences(content, specPath);
    if (!references.some((reference) =>
      reference.screenId === screen.id && reference.placementId === elementId
    )) {
      throw new Error(`${specPath} must include a SpecUX Screen link to its Element "${elementId}".`);
    }
    if (elementSpecIds.has(elementId)) {
      throw new Error(`Element "${elementId}" has more than one behavior spec.`);
    }
    elementSpecIds.add(elementId);
    context.referencedSpecPaths.add(specPath);
    linkedSpecPaths.add(specPath);
  } catch (error) {
    pushError(context.errors, `Behavior spec "${specPath}"`, error);
  }
}

/** Discovers and validates Element behavior specs for one Screen. */
async function validateScreenElementSpecs(screen, context, linkedSpecPaths) {
  const elementSpecIds = new Set();
  let elementSpecPaths = [];
  try {
    elementSpecPaths = await listElementSpecPaths(context.projectRoot, screen.id);
  } catch (error) {
    pushError(context.errors, `${screen.file} Element specs`, error);
  }
  for (const specPath of elementSpecPaths) {
    await validateElementSpec(specPath, screen, context, elementSpecIds, linkedSpecPaths);
  }
}

/** Validates metadata, layers, placements, and behavior specs for one Screen. */
async function validateScreen(screen, context, linkedSpecsByScreen) {
  // Normalize Screen structure and prepare linked-spec and state lookup context.
  context.normalizeScreenLayers(screen.data);
  validateScreenMetadata(screen, context.errors);
  const linkedSpecPaths = new Set();
  linkedSpecsByScreen.set(screen.file, linkedSpecPaths);
  const { previewStates, previewStateIds } = getScreenPreviewStates(screen, context.errors);
  context.previewStates = previewStates;

  // Validate the Screen's metadata and placement definitions before its Element specs.
  validateScreenSpec(screen, context.referencedSpecPaths, linkedSpecPaths, context.errors);
  validateRetiredElements(screen, context.errors);
  const layerIds = validateScreenLayers(screen, context.errors);
  await validateScreenMaterials(screen, context, layerIds, previewStateIds);
  await validateScreenElementSpecs(screen, context, linkedSpecPaths);
}

/** Validates Screen metadata, layers, placements, and linked Element specs. */
async function validateProjectScreens(context) {
  // Load shared Screen helpers and prepare collaborators for per-Screen validation.
  const { normalizeScreenLayers } = await import("../../shared/ScreenLayers.mjs");
  const groupValidation = await import("../../shared/ScreenGroups.mjs");
  const linkedSpecsByScreen = new Map();
  const screenContext = { ...context, normalizeScreenLayers, groupValidation };

  // Validate each Screen and return the behavior specs linked to it.
  for (const screen of context.screens) {
    await validateScreen(screen, screenContext, linkedSpecsByScreen);
  }
  return linkedSpecsByScreen;
}

module.exports = { validateProjectScreens };
