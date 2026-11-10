const validation = require("../../shared/validation");
const { pushError } = require("./sourceLocations");

const GROUP_PROPERTIES = new Set([
  "id", "type", "children", "position", "size", "rotation", "scale", "affine",
  "visible", "visibility", "note", "layer"
]);
const MATERIAL_PROPERTIES = new Set([
  "id", "src", "attributes", "position", "size", "rotation", "scale", "affine",
  "visible", "visibility", "note", "layer"
]);

/** Formats a top-level or nested placement path for validation errors. */
function getPlacementLocation(screen, path) {
  return `${screen.file} materials[${path[0]}]` +
    path.slice(1).map((index) => `.children[${index}]`).join("");
}

/** Validates Screen State visibility overrides on one placement. */
function validateVisibility(placement, location, previewStateIds, errors) {
  if (placement.visibility === undefined) return;
  if (!validation.isMapping(placement.visibility)) {
    errors.push(`${location}: visibility must be a mapping of Screen State IDs to booleans.`);
    return;
  }
  for (const [stateId, visible] of Object.entries(placement.visibility)) {
    if (!previewStateIds.has(stateId)) {
      errors.push(`${location}: visibility references unknown Screen State "${stateId}".`);
    }
    if (typeof visible !== "boolean") {
      errors.push(`${location}: visibility for Screen State "${stateId}" must be a boolean.`);
    }
  }
}

/** Validates placement identity and indexes it for state override lookup. */
function validatePlacementIdentity(material, location, context) {
  try {
    validation.validateElementId(material.id, location);
    if (context.materialIds.has(material.id)) {
      context.errors.push(`${location}: Material id "${material.id}" is already used on this Screen.`);
    }
    context.materialIds.add(material.id);
    context.placementsById.set(material.id, material);
  } catch (error) {
    pushError(context.errors, location, error);
  }
}

/** Validates fields shared by group and Material placements. */
function validatePlacementMetadata(material, location, context) {
  // Validate common descriptive and visibility fields before checking retired behavior fields.
  if (material.note !== undefined && typeof material.note !== "string") {
    context.errors.push(`${location}: note must be a string.`);
  }
  if (material.visible !== undefined && typeof material.visible !== "boolean") {
    context.errors.push(`${location}: visible must be a boolean.`);
  }
  validateVisibility(material, location, context.previewStateIds, context.errors);
  if (Object.hasOwn(material, "spec") || Object.hasOwn(material, "interactions")) {
    context.errors.push(`${location}: Materials are visual only; do not define behavior or interactions here.`);
  }
}

/** Validates the position and size fields shared by placement types. */
function validatePlacementGeometry(material, location, errors) {
  if (!validation.isMapping(material.position) ||
      !Number.isFinite(material.position.x) || !Number.isFinite(material.position.y)) {
    errors.push(`${location}: position must contain numeric x and y values.`);
  }
  if (!validation.isMapping(material.size) ||
      !Number.isFinite(material.size.width) || material.size.width < 24 ||
      !Number.isFinite(material.size.height) || material.size.height < 24) {
    errors.push(`${location}: size must contain width and height values of at least 24.`);
  }
}

/** Validates optional rotation, scale, and affine placement values. */
function validatePlacementTransforms(material, location, context) {
  const { errors, groupValidation } = context;
  if (material.rotation !== undefined && !Number.isFinite(material.rotation)) {
    errors.push(`${location}: rotation must be a number.`);
  }
  if (material.scale !== undefined && !groupValidation.isValidScale(material.scale)) {
    errors.push(`${location}: scale must be a positive number or positive x/y factors.`);
  }
  if (material.affine !== undefined && !groupValidation.isValidAffineMatrix(material.affine)) {
    errors.push(`${location}: affine must contain a non-singular a/b/c/d matrix.`);
  }
}

/** Validates a top-level layer assignment or confirms a child inherits its parent layer. */
function validatePlacementLayer(material, path, parentLayer, layerIds, location, errors) {
  const layer = path.length === 1 ? material.layer : parentLayer;
  if (path.length === 1 && (typeof layer !== "string" || !layerIds.has(layer))) {
    errors.push(`${location}: layer must reference a layer defined on this Screen.`);
  }
  if (path.length > 1 && Object.hasOwn(material, "layer")) {
    errors.push(`${location}: nested placements inherit their layer from the group.`);
  }
  return layer;
}

/** Rejects unsupported properties for one placement kind. */
function validatePlacementProperties(material, location, allowedProperties, errors) {
  for (const property of Object.keys(material)) {
    if (!allowedProperties.has(property)) {
      errors.push(`${location}: unsupported property "${property}".`);
    }
  }
}

/** Validates a group placement and recursively validates its children. */
function validateGroupPlacement(material, path, parentLayer, location, context) {
  // Validate group-specific fields and transforms before inspecting child placements.
  const { errors, layerIds } = context;
  validatePlacementProperties(material, location, GROUP_PROPERTIES, errors);
  const layer = validatePlacementLayer(material, path, parentLayer, layerIds, location, errors);
  validatePlacementGeometry(material, location, errors);
  validatePlacementTransforms(material, location, context);
  if (!Array.isArray(material.children) || material.children.length === 0) {
    errors.push(`${location}: group children must be a non-empty list.`);
    return;
  }
  material.children.forEach((child, index) =>
    validateScreenPlacement(child, [...path, index], layer, context)
  );
}

/** Validates a Material file reference and its declared instance attributes. */
function validateMaterialSource(material, location, materialFiles, errors) {
  // Validate declared attributes when the referenced Material is available.
  const materialDefinition = materialFiles.get(material.src);
  if (materialDefinition) {
    try {
      validation.validateMaterialInstanceAttributes(material, materialDefinition.data, location);
    } catch (error) {
      pushError(errors, location, error);
    }
  }

  // Report missing or malformed source paths separately from attribute mismatches.
  if (typeof material.src !== "string" || !materialFiles.has(material.src)) {
    errors.push(`${location}: src must reference a discovered Material STML file.`);
  }
}

/** Validates a Material placement including source, geometry, and transforms. */
function validateMaterialPlacement(material, path, parentLayer, location, context) {
  const { errors, layerIds, materialFiles } = context;
  validatePlacementProperties(material, location, MATERIAL_PROPERTIES, errors);
  validatePlacementLayer(material, path, parentLayer, layerIds, location, errors);
  validateMaterialSource(material, location, materialFiles, errors);
  validatePlacementGeometry(material, location, errors);
  validatePlacementTransforms(material, location, context);
}

/** Validates a Screen group or Material placement and its nested children. */
function validateScreenPlacement(material, path, parentLayer, context) {
  // Require a mapping and record its unique identity before branching by placement kind.
  const location = getPlacementLocation(context.screen, path);
  if (!validation.isMapping(material)) {
    context.errors.push(`${location}: Material must be a mapping.`);
    return;
  }
  validatePlacementIdentity(material, location, context);
  validatePlacementMetadata(material, location, context);

  // Validate nested groups recursively; ordinary placements follow Material rules.
  if (context.groupValidation.isScreenGroup(material)) {
    validateGroupPlacement(material, path, parentLayer, location, context);
    return;
  }
  validateMaterialPlacement(material, path, parentLayer, location, context);
}

module.exports = { validateScreenPlacement };
