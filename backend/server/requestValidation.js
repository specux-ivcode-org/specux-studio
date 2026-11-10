const { requestError } = require("./httpUtils");

const MAX_ANNOTATIONS_PER_SCREEN = 200;
const MAX_ANNOTATIONS_PER_CONTEXT = 200;
const MAX_POINTS_PER_ANNOTATION = 2048;
const ANNOTATION_TOOLS = new Set(["pen", "circle", "rectangle", "arrow", "highlight", "note"]);
const EDITOR_VIEWS = new Set(["screen", "workflow", "spec", "theme", "project", "material-file"]);

/** Checks a canvas size against the supported positive integer dimensions. */
function isValidCanvasSize(size) {
  return size && Number.isInteger(size.width) && size.width >= 1 && size.width <= 16384 &&
    Number.isInteger(size.height) && size.height >= 1 && size.height <= 16384;
}

/** Validates the common ID, tool, and point-list shape of one annotation. */
function isValidAnnotationIdentity(annotation, ids) {
  return annotation && !Array.isArray(annotation) && typeof annotation === "object" &&
    typeof annotation.id === "string" && Boolean(annotation.id) && annotation.id.length <= 100 &&
    !ids.has(annotation.id) && ANNOTATION_TOOLS.has(annotation.tool);
}

/** Checks that an annotation has a bounded, non-empty point list. */
function hasValidAnnotationPoints(annotation) {
  return Array.isArray(annotation.points) && annotation.points.length > 0 &&
    annotation.points.length <= MAX_POINTS_PER_ANNOTATION;
}

/** Validates the common ID, tool, and point-list shape of one annotation. */
function validateAnnotationShape(annotation, ids, errorMessage) {
  // Enforce shared identity and point-list rules before recording the ID as used.
  if (!isValidAnnotationIdentity(annotation, ids) || !hasValidAnnotationPoints(annotation)) {
    throw requestError(errorMessage);
  }
  ids.add(annotation.id);
}

/** Checks that one point uses finite coordinates inside the selected canvas. */
function isValidAnnotationPoint(point, canvasSize) {
  return point && !Array.isArray(point) && typeof point === "object" &&
    Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= canvasSize.width &&
    point.y >= 0 && point.y <= canvasSize.height;
}

/** Validates and copies annotation points against their canvas dimensions. */
function normalizeAnnotationPoints(points, canvasSize, errorMessage) {
  // Copy only coordinates that lie within the declared canvas.
  const normalized = [];
  for (const point of points) {
    if (!isValidAnnotationPoint(point, canvasSize)) {
      throw requestError(errorMessage);
    }
    normalized.push({ x: point.x, y: point.y });
  }
  return normalized;
}

/** Copies optional annotation text after enforcing its size limit. */
function copyAnnotationText(annotation, clean, errorMessage) {
  if (annotation.text === undefined) return;
  if (typeof annotation.text !== "string" || annotation.text.length > 500) {
    throw requestError(errorMessage);
  }
  clean.text = annotation.text;
}

/** Checks the target's Element instance path and optional target text. */
function isValidAnnotationTarget(target) {
  if (!target || Array.isArray(target) || typeof target !== "object" ||
      !Array.isArray(target.instancePath)) return false;
  const validPath = target.instancePath.every((part) =>
    (Number.isInteger(part) && part >= 0) ||
    (typeof part === "string" && /^[a-z][a-z0-9-]*$/.test(part))
  );
  const validText = target.text === undefined ||
    (typeof target.text === "string" && target.text.length <= 500);
  return validPath && validText;
}

/** Validates and copies an optional Element target associated with an annotation. */
function normalizeAnnotationTarget(target) {
  // Validate target structure before copying only supported target fields.
  if (!isValidAnnotationTarget(target)) {
    throw requestError("Annotation targets must include a valid Element instancePath.");
  }
  return {
    instancePath: target.instancePath,
    ...(typeof target.elementId === "string" ? { elementId: target.elementId } : {}),
    ...(typeof target.name === "string" ? { name: target.name } : {}),
    ...(typeof target.materialId === "string" ? { materialId: target.materialId } : {}),
    ...(typeof target.materialSrc === "string" ? { materialSrc: target.materialSrc } : {}),
    ...(target.text !== undefined ? { text: target.text } : {})
  };
}

/** Normalizes one Screen annotation after validating its points and optional fields. */
function normalizeScreenAnnotation(annotation, ids, canvasSize) {
  // Validate the annotation identity and copy its canvas-bounded points.
  validateAnnotationShape(
    annotation,
    ids,
    "Each annotation must have a unique id, supported tool, and valid points."
  );
  const clean = {
    id: annotation.id,
    tool: annotation.tool,
    points: normalizeAnnotationPoints(
      annotation.points,
      canvasSize,
      "Annotation points must be within the Screen canvas pixel dimensions."
    )
  };

  // Copy optional text and Element-target metadata after the required fields are normalized.
  copyAnnotationText(
    annotation,
    clean,
    "Annotation text must be at most 500 characters."
  );
  if (annotation.target !== undefined) clean.target = normalizeAnnotationTarget(annotation.target);
  return clean;
}

/** Checks required metadata and bounds for a Screen annotation set. */
function hasValidAnnotationSetMetadata(body) {
  return body && !Array.isArray(body) && typeof body === "object" &&
    typeof body.screenId === "string" && /^[a-z][a-z0-9-]*$/.test(body.screenId) &&
    body.coordinateSpace === "screen canvas pixels" &&
    typeof body.previewStateId === "string" && /^[a-z][a-z0-9-]*$/.test(body.previewStateId);
}

/** Checks one editor preview descriptor before it is added to the dimension map. */
function hasValidEditorPreviewIdentity(preview, previewSizes) {
  return preview && !Array.isArray(preview) && typeof preview === "object" &&
    typeof preview.id === "string" && Boolean(preview.id) && preview.id.length <= 100 &&
    !previewSizes.has(preview.id);
}

/** Checks the label, coordinate space, and canvas fields of an editor preview. */
function hasValidEditorPreviewDetails(preview) {
  return typeof preview.label === "string" && preview.label.length <= 200 &&
    preview.coordinateSpace === "preview content pixels" &&
    isValidCanvasSize(preview.canvasSize);
}

/** Checks one editor preview descriptor before it is added to the dimension map. */
function isValidEditorPreview(preview, previewSizes) {
  return hasValidEditorPreviewIdentity(preview, previewSizes) &&
    hasValidEditorPreviewDetails(preview);
}

/** Validates preview entries and creates a map of normalized preview dimensions. */
function validateEditorPreviews(context) {
  // Bound the preview list before building its normalized ID-to-size lookup.
  const hasPreviewSizes = Array.isArray(context?.previews);
  const previews = hasPreviewSizes ? context.previews : [];
  if (previews.length > 12) {
    throw requestError("Editor annotations may include at most 12 previews.");
  }
  const previewSizes = new Map();
  for (const preview of previews) {
    if (!isValidEditorPreview(preview, previewSizes)) {
      throw requestError("Editor preview annotations must include valid preview dimensions.");
    }
    previewSizes.set(preview.id, {
      id: preview.id,
      label: preview.label,
      coordinateSpace: "preview content pixels",
      canvasSize: { ...preview.canvasSize }
    });
  }

  // Return whether preview metadata was supplied alongside the validated dimensions.
  return { hasPreviewSizes, previewSizes };
}

/** Checks identity and metadata fields of an editor annotation context. */
function hasValidEditorContextIdentity(context) {
  return typeof context.key === "string" && Boolean(context.key) && context.key.length <= 2048 &&
    ["screen", "workflow", "spec", "theme", "project", "material"].includes(context.type) &&
    EDITOR_VIEWS.has(context.view) &&
    (context.file === null || (typeof context.file === "string" && context.file.length <= 2048)) &&
    typeof context.mode === "string" && context.mode.length <= 40;
}

/** Checks editor annotation coordinate space, canvas, and annotation-list metadata. */
function hasValidEditorContextCanvas(context, hasPreviewSizes, annotations) {
  return ["editor viewport pixels", "editor preview pixels"].includes(context.coordinateSpace) &&
    isValidCanvasSize(context.canvasSize) &&
    (context.coordinateSpace !== "editor preview pixels" || hasPreviewSizes) &&
    Array.isArray(annotations) && annotations.length <= MAX_ANNOTATIONS_PER_CONTEXT;
}

/** Normalizes one editor annotation using its viewport or preview canvas. */
function normalizeEditorAnnotation(annotation, ids, context, previewSizes) {
  // Select the coordinate bounds from the editor viewport or referenced preview.
  validateAnnotationShape(
    annotation,
    ids,
    "Each editor annotation must have a unique id, supported tool, and valid points."
  );
  const previewId = annotation.previewId;
  const annotationCanvasSize = context.coordinateSpace === "editor preview pixels"
    ? previewSizes.get(previewId)?.canvasSize
    : context.canvasSize;
  if (!annotationCanvasSize) throw requestError("Editor annotation references an unknown preview.");
  const clean = {
    id: annotation.id,
    tool: annotation.tool,
    points: normalizeAnnotationPoints(
      annotation.points,
      annotationCanvasSize,
      "Editor annotation points must be within their preview dimensions."
    )
  };

  // Preserve only optional preview and text metadata after the points are normalized.
  if (previewId !== undefined) clean.previewId = previewId;
  copyAnnotationText(
    annotation,
    clean,
    "Editor annotation text must be at most 500 characters."
  );
  return clean;
}

/** Accepts only local SpecUX Screen preview URLs without credentials, ports, or fragments. */
function isSpecuxPreviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "specux:" && url.hostname === "screen" &&
      !url.username && !url.password && !url.port && !url.hash;
  } catch {
    return false;
  }
}

/** Accepts a state ID or a text selection with valid start and end positions. */
function isValidStateSelection(value) {
  if (typeof value === "string") return true;
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      value.type !== "text" || typeof value.text !== "string" ||
      !value.range || typeof value.range !== "object") return false;
  return ["start", "end"].every((key) => {
    const position = value.range[key];
    return position && Number.isInteger(position.line) && position.line > 0 &&
      Number.isInteger(position.column) && position.column > 0;
  });
}

/** Validates optional selection path and file fields. */
function hasValidSelectionPathMetadata(body) {
  const validPath = !Object.hasOwn(body, "path") ||
    (typeof body.path === "string" && body.path.startsWith("/") && !body.path.startsWith("//"));
  const validFile = !Object.hasOwn(body, "file") || body.file === null ||
    typeof body.file === "string";
  return validPath && validFile;
}

/** Validates optional selection type and name fields. */
function hasValidSelectionLabelMetadata(body) {
  const validType = !Object.hasOwn(body, "type") || body.type === null ||
    ["screen", "workflow", "spec", "theme", "project", "material"].includes(body.type);
  const validName = !Object.hasOwn(body, "name") || body.name === null ||
    typeof body.name === "string";
  return validType && validName;
}

/** Validates the optional client ID and preview fields on a selection payload. */
function hasValidSelectionClientMetadata(body) {
  const validClientId = !Object.hasOwn(body, "clientId") ||
    (typeof body.clientId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientId));
  const validPreview = !Object.hasOwn(body, "preview") ||
    body.preview === null || isSpecuxPreviewUrl(body.preview);
  return validClientId && validPreview;
}

/** Validates selected Screen State values. */
function hasValidSelectedMetadata(body) {
  return !Object.hasOwn(body, "selected") ||
    (Array.isArray(body.selected) && body.selected.every(isValidStateSelection));
}

/** Validates optional selection URL, type, identity, and selected-state fields. */
function hasValidSelectionMetadata(body) {
  return hasValidSelectionPathMetadata(body) &&
    hasValidSelectionLabelMetadata(body) &&
    hasValidSelectionClientMetadata(body) &&
    hasValidSelectedMetadata(body);
}

/** Validates the root selection payload shape independently from its optional metadata. */
function hasValidSelectionBody(body) {
  return body && !Array.isArray(body) && typeof body === "object" &&
    Object.hasOwn(body, "selection") &&
    (body.selection === null || (!Array.isArray(body.selection) && typeof body.selection === "object"));
}

/** Validates the complete selection payload and returns its normalized annotation context. */
function validateSelectionRequest(body) {
  // Validate optional annotation context before accepting the rest of the selection payload.
  const editorAnnotations = body && Object.hasOwn(body, "annotationContext")
    ? validateEditorAnnotationContext(body.annotationContext, body.annotations)
    : null;

  // Reject malformed selection identity or metadata as one invalid request.
  if (!hasValidSelectionBody(body) || !hasValidSelectionMetadata(body)) {
    throw requestError("Selection updates must contain an object or null and a valid URL path.");
  }
  return editorAnnotations;
}

/** Validates and copies a Screen annotation set, rejecting malformed or out-of-bounds data. */
function validateAnnotationSet(body) {
  // Check set-level identity, coordinate space, canvas, and list bounds first.
  if (!hasValidAnnotationSetMetadata(body) ||
      !isValidCanvasSize(body.canvasSize) ||
      !Array.isArray(body.annotations) || body.annotations.length > MAX_ANNOTATIONS_PER_SCREEN) {
    throw requestError(
      "Annotations must include a valid screenId, Screen State, canvas size, and canvas coordinate space."
    );
  }

  // Normalize every annotation while enforcing unique IDs across the set.
  const ids = new Set();
  const annotations = body.annotations.map((annotation) =>
    normalizeScreenAnnotation(annotation, ids, body.canvasSize)
  );
  return {
    screenId: body.screenId,
    annotations,
    coordinateSpace: "screen canvas pixels",
    canvasSize: { ...body.canvasSize },
    previewStateId: body.previewStateId
  };
}

/** Validates editor viewport or preview coordinates and normalizes its annotations. */
function validateEditorAnnotationContext(context, annotations) {
  // Validate preview dimensions first so annotations can resolve their coordinate canvases.
  const { hasPreviewSizes, previewSizes } = validateEditorPreviews(context);
  if (!context || Array.isArray(context) || typeof context !== "object" ||
      !hasValidEditorContextIdentity(context) ||
      !hasValidEditorContextCanvas(context, hasPreviewSizes, annotations)) {
    throw requestError("Editor annotations must include a valid editor context and viewport dimensions.");
  }

  // Normalize annotations against the validated context and preview dimensions.
  const ids = new Set();
  const cleanAnnotations = annotations.map((annotation) =>
    normalizeEditorAnnotation(annotation, ids, context, previewSizes)
  );

  // Return a copy containing only the supported context and annotation fields.
  return {
    context: {
      key: context.key,
      view: context.view,
      type: context.type,
      file: context.file,
      mode: context.mode,
      coordinateSpace: context.coordinateSpace,
      canvasSize: { ...context.canvasSize },
      ...(hasPreviewSizes ? { previews: [...previewSizes.values()] } : {})
    },
    annotations: cleanAnnotations
  };
}

module.exports = {
  isSpecuxPreviewUrl,
  isValidStateSelection,
  validateAnnotationSet,
  validateEditorAnnotationContext,
  validateSelectionRequest
};
