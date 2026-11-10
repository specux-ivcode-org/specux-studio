/** Appends a source-qualified validation error with a location when available. */
function pushError(errors, source, error) {
  const location = Number.isInteger(error.line) && Number.isInteger(error.column)
    ? ` (line ${error.line}, column ${error.column})`
    : "";
  errors.push(`${source}: ${error.message || String(error)}${location}`);
}

/** Converts a source-string offset to one-based line and column coordinates. */
function getSourcePosition(source, offset, lineOffset = 0) {
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length + lineOffset,
    column: offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"))
  };
}

/** Recursively finds the YAML scalar node whose decoded value matches the target. */
function findYamlScalarNode(document, value) {
  /** Searches one YAML mapping or sequence entry and its descendants. */
  function visitPair(item) {
    if (item.key && item.value?.toJSON() === value) return item.value;
    const found = visit(item.key) || visit(item.value);
    if (found) return found;
    return !item.key ? visit(item) : null;
  }

  /** Searches a YAML node and its descendants for the matching scalar. */
  function visit(node) {
    if (!node) return null;
    if (!Array.isArray(node.items)) return node.toJSON?.() === value ? node : null;
    for (const item of node.items) {
      const found = visitPair(item);
      if (found) return found;
    }
    return null;
  }
  return visit(document.contents);
}

/** Follows mapping keys and sequence indexes to the YAML node at a data path. */
function getYamlNode(document, pathSegments) {
  let node = document.contents;
  let keyNode = null;
  for (const segment of pathSegments) {
    if (Array.isArray(node?.items)) {
      if (typeof segment === "number") {
        node = node.items[segment];
        keyNode = null;
      } else {
        // Find the mapping entry for the current path segment.
        const pair = node.items.find((item) => item.key?.toJSON() === segment);
        if (!pair) return keyNode || node;
        node = pair.value;
        keyNode = pair.key;
      }
    } else {
      return keyNode || node;
    }
  }
  return keyNode || node;
}

/** Resolves indexed Screen, layer, or Material error context into YAML path segments. */
function getIndexedErrorContext(detail) {
  const indexedContext = detail.match(
    /^(screens|layers|materials)\[(\d+)\](?:\.children\[(\d+)\])*/
  );
  if (!indexedContext) return null;
  const pathSegments = [indexedContext[1], Number(indexedContext[2])];
  const children = [...indexedContext[0].matchAll(/\.children\[(\d+)\]/g)];
  for (const child of children) pathSegments.push("children", Number(child[1]));
  return {
    pathSegments,
    message: detail.slice(indexedContext[0].length).replace(/^[\s:]+/, "")
  };
}

/** Resolves a named Screen State error context into YAML path segments. */
function getStateErrorContext(detail, document) {
  if (!detail.startsWith("Screen State ")) return null;
  const pathSegments = [];
  const stateId = detail.match(/^Screen State "([^"]+)"/)?.[1];
  const states = document.toJS()["preview-states"];
  const stateIndex = states?.findIndex((state) => state.id === stateId) ?? -1;
  if (stateIndex >= 0) pathSegments.push("preview-states", stateIndex);
  const layerId = detail.match(/layer "([^"]+)"/)?.[1];
  const placementId = detail.match(/placement "([^"]+)"/)?.[1];
  if (layerId) pathSegments.push("layers", layerId);
  if (placementId) pathSegments.push("placements", placementId);
  return {
    pathSegments,
    message: detail.replace(/^Screen State "[^"]+"\s*/, "")
  };
}

/** Resolves an error requiring a Screen State link into its YAML path. */
function getShowStateErrorContext(detail, document) {
  if (!detail.includes("must reference every non-default Screen State with SHOW:")) return null;
  const stateId = detail.match(/SHOW:\s*([a-z][a-z0-9-]*)/)?.[1];
  const states = document.toJS()["preview-states"];
  const stateIndex = states?.findIndex((state) => state.id === stateId) ?? -1;
  return {
    pathSegments: stateIndex >= 0 ? ["preview-states", stateIndex, "id"] : [],
    message: detail
  };
}

/** Maps a validation message to the most relevant YAML node's source location. */
function getYamlErrorPath(document, source, lineOffset, detail) {
  // Map validation context to the nearest meaningful YAML path.
  const context = getIndexedErrorContext(detail) ||
    getStateErrorContext(detail, document) ||
    getShowStateErrorContext(detail, document);
  const pathSegments = context?.pathSegments || [];
  const message = context?.message || detail;

  const unsupportedProperty = message.match(/unsupported (?:property|override) "([^"]+)"/);
  const propertyNames = [
    "preview-states", "materials", "layers", "position", "description", "visibility",
    "children", "attributes", "rotation", "affine", "visible", "size", "scale",
    "theme", "screens", "specux", "spec", "layer", "note", "name", "type", "src",
    "file", "id", "workflows", "elements", "tokens", "modes"
  ];
  const property = unsupportedProperty?.[1] ||
    propertyNames.find((name) => new RegExp(`\\b${name}\\b`).test(message));
  if (property) pathSegments.push(property);

  // Convert the selected YAML node's source offset to one-based coordinates.
  const node = getYamlNode(document, pathSegments);
  const offset = node?.range?.[0];
  if (!Number.isInteger(offset)) return null;
  const before = source.slice(0, offset);
  const line = before.split(/\r?\n/).length + lineOffset;
  const column = offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  return { line, column };
}

/** Finds the YAML location for an error that already names its source file. */
function findSourceErrorLocation(error, yamlDocuments) {
  for (const [filePath, yamlSource] of yamlDocuments) {
    const prefix = `${filePath}:`;
    const sourcePrefix = error.startsWith(prefix)
      ? prefix
      : error.startsWith(`${filePath} `) ? `${filePath} ` : null;
    if (!sourcePrefix) continue;
    const detail = error.slice(sourcePrefix.length).trimStart();
    return getYamlErrorPath(
      yamlSource.document,
      yamlSource.source,
      yamlSource.lineOffset || 0,
      detail
    );
  }
  return undefined;
}

/** Finds the YAML node location of a path referenced by an error message. */
function findReferencedPathLocation(targetPath, yamlDocuments) {
  for (const [filePath, yamlSource] of yamlDocuments) {
    const node = findYamlScalarNode(yamlSource.document, targetPath);
    if (!node?.range) continue;
    const position = getSourcePosition(
      yamlSource.source,
      node.range[0],
      yamlSource.lineOffset || 0
    );
    return `${filePath}:${position.line}:${position.column}`;
  }
  return null;
}

/** Adds a source coordinate to a single validation error when its YAML node is known. */
function addYamlErrorLocation(error, yamlDocuments) {
  // Preserve locations already attached by a parser or earlier validation pass.
  if (/\(line \d+, column \d+\)$/.test(error) || /:\d+:\d+:/.test(error)) return error;

  // Prefer a source-specific YAML node for errors that identify their originating file.
  const sourceLocation = findSourceErrorLocation(error, yamlDocuments);
  if (sourceLocation !== undefined) {
    return sourceLocation
      ? `${error} (line ${sourceLocation.line}, column ${sourceLocation.column})`
      : error;
  }
  const targetPath = error.match(/^([^:]+):/)?.[1] ||
    [...error.matchAll(/"([^"]+\.(?:yml|yaml|md|stml))"/g)].map((match) => match[1])[0];
  if (!targetPath) return error;

  // Otherwise locate a referenced path value to help users find the broken link.
  const referenceLocation = findReferencedPathLocation(targetPath, yamlDocuments);
  return referenceLocation ? `${error} (referenced at ${referenceLocation})` : error;
}

/** Adds source coordinates to project validation errors when their YAML node is known. */
function addYamlErrorLocations(errors, yamlDocuments) {
  return errors.map((error) => addYamlErrorLocation(error, yamlDocuments));
}

module.exports = { addYamlErrorLocations, getSourcePosition, pushError };
