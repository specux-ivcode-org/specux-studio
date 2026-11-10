const validation = require("../../shared/validation");
const { pushError } = require("./sourceLocations");

const STATE_OVERRIDE_PROPERTIES = new Set([
  "visible", "attributes", "position", "size", "rotation", "scale", "affine"
]);

/** Validates the layer visibility overrides declared by one Screen State. */
function validateLayerOverrides(screen, previewState, layerIds, errors) {
  for (const [layerId, layerOverride] of Object.entries(previewState.layers || {})) {
    if (!layerIds.has(layerId)) {
      errors.push(`${screen.file} Screen State "${previewState.id}" references unknown layer "${layerId}".`);
    }
    if (!validation.isMapping(layerOverride) ||
        Object.keys(layerOverride).some((key) => key !== "visible") ||
        typeof layerOverride.visible !== "boolean") {
      errors.push(`${screen.file} Screen State "${previewState.id}" layer "${layerId}" must contain a boolean visible value.`);
    }
  }
}

/** Validates the visible value of a placement override. */
function validateVisibleOverride(override, location, errors) {
  if (override.visible !== undefined && typeof override.visible !== "boolean") {
    errors.push(`${location} visible override must be a boolean.`);
  }
}

/** Validates the position value of a placement override. */
function validatePositionOverride(override, location, errors) {
  if (override.position !== undefined &&
      (!validation.isMapping(override.position) ||
       !Number.isFinite(override.position.x) || !Number.isFinite(override.position.y))) {
    errors.push(`${location} position override must contain numeric x and y values.`);
  }
}

/** Validates the size value of a placement override. */
function validateSizeOverride(override, location, errors) {
  if (override.size !== undefined &&
      (!validation.isMapping(override.size) ||
       !Number.isFinite(override.size.width) || override.size.width < 24 ||
       !Number.isFinite(override.size.height) || override.size.height < 24)) {
    errors.push(`${location} size override must contain width and height values of at least 24.`);
  }
}

/** Validates rotation, scale, and affine placement overrides. */
function validateTransformOverrides(override, location, errors, groupValidation) {
  if (override.rotation !== undefined && !Number.isFinite(override.rotation)) {
    errors.push(`${location} rotation override must be a number.`);
  }
  if (override.scale !== undefined && !groupValidation.isValidScale(override.scale)) {
    errors.push(`${location} scale override must be a positive number or positive x/y factors.`);
  }
  if (override.affine !== undefined && !groupValidation.isValidAffineMatrix(override.affine)) {
    errors.push(`${location} affine override must contain a non-singular a/b/c/d matrix.`);
  }
}

/** Validates Material attribute overrides and reports validation errors at their location. */
function validateAttributeOverride(override, material, location, materialFiles, groupValidation, errors) {
  if (override.attributes === undefined) return;
  if (!validation.isMapping(override.attributes) || groupValidation.isScreenGroup(material)) {
    errors.push(`${location} attributes override must be a mapping on a Material placement.`);
    return;
  }

  // Ignore null entries used to remove optional overrides before validating remaining values.
  const attributes = Object.fromEntries(
    Object.entries(override.attributes).filter(([, value]) => value !== null)
  );
  const materialDefinition = materialFiles.get(material.src);
  if (!materialDefinition) return;
  try {
    validation.validateMaterialInstanceAttributes(
      { attributes },
      materialDefinition.data,
      location
    );
  } catch (error) {
    pushError(errors, location, error);
  }
}

/** Reports properties not supported on a placement override. */
function validateOverrideProperties(override, location, errors) {
  for (const property of Object.keys(override)) {
    if (!STATE_OVERRIDE_PROPERTIES.has(property)) {
      errors.push(`${location} has unsupported override "${property}".`);
    }
  }
}

/** Validates the full mapping for one placement's Screen State override. */
function validatePlacementOverride(previewState, placementId, context) {
  // Resolve the referenced placement before validating the override mapping.
  const { screen, placementsById, materialFiles, errors, groupValidation } = context;
  const material = placementsById.get(placementId);
  const location = `${screen.file} Screen State "${previewState.id}" placement "${placementId}"`;
  if (!material) {
    errors.push(`${location} does not reference a placement on this Screen.`);
    return;
  }
  const override = previewState.placements[placementId];
  if (!validation.isMapping(override)) {
    errors.push(`${location} override must be a mapping.`);
    return;
  }

  // Validate supported override fields independently so all issues can be reported together.
  validateOverrideProperties(override, location, errors);
  validateVisibleOverride(override, location, errors);
  validatePositionOverride(override, location, errors);
  validateSizeOverride(override, location, errors);
  validateTransformOverrides(override, location, errors, groupValidation);
  validateAttributeOverride(override, material, location, materialFiles, groupValidation, errors);
}

/** Validates every placement override declared by one Screen State. */
function validatePlacementOverrides(previewState, context) {
  for (const placementId of Object.keys(previewState.placements || {})) {
    validatePlacementOverride(previewState, placementId, context);
  }
}

/** Validates layer and placement overrides for every named Screen State. */
async function validateScreenStateOverrides(context) {
  // Load group transform rules once and apply every Screen State's layer and placement overrides.
  const groupValidation = await import("../../shared/ScreenGroups.mjs");
  for (const previewState of context.previewStates) {
    validateLayerOverrides(context.screen, previewState, context.layerIds, context.errors);
    validatePlacementOverrides(previewState, { ...context, groupValidation });
  }
}

module.exports = { validateScreenStateOverrides };
