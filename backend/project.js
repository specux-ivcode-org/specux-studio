const fs = require("node:fs/promises");
const path = require("node:path");
const validation = require("../shared/validation");

const SPECUX_VERSION = "0.1.0-SNAPSHOT";

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error(`"${String(relativePath)}" must be a normal relative project path.`);
  }
  return relativePath.split("/");
}

async function resolveProjectPath(projectRoot, relativePath, expectedType) {
  const root = await fs.realpath(projectRoot);
  const target = path.resolve(root, ...safeRelativePath(relativePath));
  if (!isWithin(root, target)) throw new Error(`"${relativePath}" resolves outside the project.`);
  const realTarget = await fs.realpath(target);
  if (!isWithin(root, realTarget)) throw new Error(`"${relativePath}" resolves outside the project.`);
  const stats = await fs.stat(realTarget);
  if (expectedType === "file" && !stats.isFile()) throw new Error(`"${relativePath}" is not a file.`);
  if (expectedType === "directory" && !stats.isDirectory()) throw new Error(`"${relativePath}" is not a directory.`);
  return realTarget;
}

function pushError(errors, source, error) {
  const location = Number.isInteger(error.line) && Number.isInteger(error.column)
    ? ` (line ${error.line}, column ${error.column})`
    : "";
  errors.push(`${source}: ${error.message || String(error)}${location}`);
}

function getSourcePosition(source, offset, lineOffset = 0) {
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length + lineOffset,
    column: offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"))
  };
}

function findYamlScalarNode(document, value) {
  function visit(node) {
    if (!node) return null;
    if (node.items && Array.isArray(node.items)) {
      for (const item of node.items) {
        if (item.key && item.value?.toJSON() === value) return item.value;
        const found = visit(item.key) || visit(item.value);
        if (found) return found;
        if (!item.key) {
          const nested = visit(item);
          if (nested) return nested;
        }
      }
      return null;
    }
    return node.toJSON?.() === value ? node : null;
  }
  return visit(document.contents);
}

function getYamlNode(document, pathSegments) {
  let node = document.contents;
  let keyNode = null;
  for (const segment of pathSegments) {
    if (Array.isArray(node?.items)) {
      if (typeof segment === "number") {
        node = node.items[segment];
        keyNode = null;
      } else {
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

function getYamlErrorPath(document, source, lineOffset, detail) {
  const pathSegments = [];
  let message = detail;
  const indexedContext = detail.match(
    /^(screens|layers|materials)\[(\d+)\](?:\.children\[(\d+)\])*/
  );
  if (indexedContext) {
    pathSegments.push(indexedContext[1], Number(indexedContext[2]));
    const children = [...indexedContext[0].matchAll(/\.children\[(\d+)\]/g)];
    for (const child of children) pathSegments.push("children", Number(child[1]));
    message = detail.slice(indexedContext[0].length).replace(/^[\s:]+/, "");
  } else if (detail.startsWith("Screen State ")) {
    const stateId = detail.match(/^Screen State "([^"]+)"/)?.[1];
    const states = document.toJS()["preview-states"];
    const stateIndex = states?.findIndex((state) => state.id === stateId) ?? -1;
    if (stateIndex >= 0) pathSegments.push("preview-states", stateIndex);
    const layerId = detail.match(/layer "([^"]+)"/)?.[1];
    const placementId = detail.match(/placement "([^"]+)"/)?.[1];
    if (layerId) pathSegments.push("layers", layerId);
    if (placementId) pathSegments.push("placements", placementId);
    message = detail.replace(/^Screen State "[^"]+"\s*/, "");
  } else if (detail.includes("must reference every non-default Screen State with SHOW:")) {
    const stateId = detail.match(/SHOW:\s*([a-z][a-z0-9-]*)/)?.[1];
    const states = document.toJS()["preview-states"];
    const stateIndex = states?.findIndex((state) => state.id === stateId) ?? -1;
    if (stateIndex >= 0) pathSegments.push("preview-states", stateIndex, "id");
  }

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

  const node = getYamlNode(document, pathSegments);
  const offset = node?.range?.[0];
  if (!Number.isInteger(offset)) return null;
  const before = source.slice(0, offset);
  const line = before.split(/\r?\n/).length + lineOffset;
  const column = offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  return { line, column };
}

function addYamlErrorLocations(errors, yamlDocuments) {
  return errors.map((error) => {
    if (/\(line \d+, column \d+\)$/.test(error) ||
        /:\d+:\d+:/.test(error)) return error;
    for (const [filePath, yamlSource] of yamlDocuments) {
      const prefix = `${filePath}:`;
      const sourcePrefix = error.startsWith(prefix)
        ? prefix
        : error.startsWith(`${filePath} `) ? `${filePath} ` : null;
      if (!sourcePrefix) continue;
      const detail = error.slice(sourcePrefix.length).trimStart();
      const location = getYamlErrorPath(
        yamlSource.document,
        yamlSource.source,
        yamlSource.lineOffset || 0,
        detail
      );
      if (!location) return error;
      return `${error} (line ${location.line}, column ${location.column})`;
    }
    const targetPath = error.match(/^([^:]+):/)?.[1] ||
      [...error.matchAll(/"([^"]+\.(?:yml|yaml|md|stml))"/g)].map((match) => match[1])[0];
    if (targetPath) {
      for (const [filePath, yamlSource] of yamlDocuments) {
        const node = findYamlScalarNode(yamlSource.document, targetPath);
        if (!node?.range) continue;
        const position = getSourcePosition(
          yamlSource.source,
          node.range[0],
          yamlSource.lineOffset || 0
        );
        return `${error} (referenced at ${filePath}:${position.line}:${position.column})`;
      }
    }
    return error;
  });
}

async function validateProject(projectRoot) {
  const YAML = await import("../shared/yaml.mjs");
  const { normalizeScreenLayers } =
    await import("../shared/ScreenLayers.mjs");
  const { isScreenGroup, isValidAffineMatrix, isValidScale } =
    await import("../shared/ScreenGroups.mjs");
  const errors = [];
  const yamlDocuments = new Map();
  const materialFiles = new Map();
  const screens = [];
  const referencedSpecPaths = new Set();
  const specContents = new Map();
  let project;
  let theme;

  async function readYaml(relativePath) {
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

  async function checkFile(relativePath, source, position) {
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

  async function listElementSpecPaths(screenId) {
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

  async function validateResources(sourceText, sourceFile, baseDirectory, lineOffset = 0) {
    const references = [];
    const tags = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    const attributes = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    for (const tag of sourceText.matchAll(tags)) {
      for (const attribute of tag[2].matchAll(attributes)) {
        const reference = attribute[1] ?? attribute[2] ?? attribute[3];
        references.push({
          value: reference,
          offset: tag.index + tag[0].indexOf(tag[2]) + attribute.index +
            attribute[0].lastIndexOf(reference)
        });
      }
    }
    const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const reference of sourceText.matchAll(cssUrls)) {
      const value = (reference[1] ?? reference[2] ?? reference[3]).trim();
      references.push({
        value,
        offset: reference.index + reference[0].indexOf(value)
      });
    }
    const seenReferences = new Set();
    for (const { value: reference, offset } of references) {
      if (!reference || reference.startsWith("#") || reference.startsWith("data:image/") ||
          reference.includes("${") || seenReferences.has(reference)) continue;
      seenReferences.add(reference);
      const position = getSourcePosition(sourceText, offset, lineOffset);
      const encodedPath = reference.split(/[?#]/, 1)[0];
      let resourcePath;
      try {
        resourcePath = decodeURIComponent(encodedPath);
      } catch {
        errors.push(
          `${sourceFile}: resource "${reference}" contains invalid URL escaping. ` +
          `(line ${position.line}, column ${position.column})`
        );
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") ||
          resourcePath.startsWith("/") || resourcePath.includes("\\") ||
          resourcePath.split("/").includes("..")) {
        errors.push(
          `${sourceFile}: resource "${reference}" must stay inside the project. ` +
          `(line ${position.line}, column ${position.column})`
        );
        continue;
      }
      if (!resourcePath) continue;
      const relativePath = path.posix.join(baseDirectory, resourcePath);
      await checkFile(relativePath, `${sourceFile} resource "${reference}"`, position);
    }
  }

  project = await readYaml("project.yml");
  if (!project) {
    return {
      errors: addYamlErrorLocations(errors, yamlDocuments),
      project: null,
      materialFiles,
      screens,
      referencedSpecPaths
    };
  }

  if (typeof project.specux !== "string" || !project.specux) {
    errors.push("project.yml: specux must specify the SpecUX version.");
  } else if (project.specux !== SPECUX_VERSION) {
    errors.push(`project.yml: SpecUX version "${project.specux}" is not supported by this CLI (expected "${SPECUX_VERSION}").`);
  }
  if (project.name !== undefined && typeof project.name !== "string") {
    errors.push("project.yml: name must be a string.");
  }
  if (project.description !== undefined && typeof project.description !== "string") {
    errors.push("project.yml: description must be a string.");
  }
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
  if (project.spec !== undefined) {
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
  if (typeof project.theme !== "string" || !project.theme) {
    errors.push("project.yml: theme must name a Theme YAML file.");
  }

  function indexEntries(entries, kind) {
    const ids = new Set();
    const files = new Set();
    const validEntries = [];
    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      if (!validation.isMapping(entry)) {
        errors.push(`project.yml: ${kind}[${index}] must be a mapping.`);
        continue;
      }
      if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
        errors.push(`project.yml: ${kind}[${index}] id must use lowercase letters, numbers, and hyphens.`);
        continue;
      }
      for (const property of Object.keys(entry)) {
        if (!["id", "file"].includes(property)) {
          errors.push(`project.yml: ${kind}[${index}] has unsupported property "${property}".`);
        }
      }
      if (ids.has(entry.id)) errors.push(`project.yml: ${kind} defines id "${entry.id}" more than once.`);
      ids.add(entry.id);
      const locationKey = "file";
      if (typeof entry[locationKey] !== "string" || !entry[locationKey]) {
        errors.push(`project.yml: ${kind} "${entry.id}" must define ${locationKey}.`);
        continue;
      }
      if (files.has(entry[locationKey])) {
        errors.push(`project.yml: ${kind} references "${entry[locationKey]}" more than once.`);
      }
      files.add(entry[locationKey]);
      validEntries.push(entry);
    }
    return validEntries;
  }

  const screenEntries = indexEntries(project.screens, "screens");
  for (const entry of screenEntries) {
    if (entry.file !== `screens/${entry.id}/screen.yml`) {
      errors.push(`project.yml: Screen "${entry.id}" file must be "screens/${entry.id}/screen.yml".`);
    }
  }

  for (const entry of screenEntries) {
    const data = await readYaml(entry.file);
    if (data) screens.push({ id: entry.id, file: entry.file, data });
  }

  async function discoverMaterials() {
    let directory;
    try {
      directory = await resolveProjectPath(projectRoot, "materials", "directory");
    } catch (error) {
      if (error.code === "ENOENT") return;
      pushError(errors, "materials", error);
      return;
    }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relativePath = `materials/${entry.name}`;
      try {
        const absolutePath = path.join(directory, entry.name);
        const details = await fs.lstat(absolutePath);
        if (details.isSymbolicLink()) throw new Error("Material directories cannot contain symbolic links.");
        if (!details.isFile()) {
          if (details.isDirectory()) continue;
          throw new Error("Material paths must be regular files.");
        }
        if (path.posix.extname(entry.name).toLowerCase() !== validation.MATERIAL_FILE_EXTENSION) {
          continue;
        }
        const expectedId = path.posix.basename(entry.name, validation.MATERIAL_FILE_EXTENSION);
        if (!/^[a-z][a-z0-9-]*$/.test(expectedId)) {
          throw new Error("Material filenames must use lowercase letters, numbers, and hyphens.");
        }
        const source = await fs.readFile(absolutePath, "utf8");
        const { header, body } = validation.splitMaterialDocument(source, relativePath);
        const bodyLineOffset = source.slice(0, source.length - body.length).split("\n").length - 1;
        const document = YAML.parseDocument(header);
        yamlDocuments.set(relativePath, { document, source: header, lineOffset: 1 });
        if (document.errors.length) {
          for (const issue of document.errors) {
            const position = issue.linePos?.[0];
            const error = new Error(issue.message);
            if (position) {
              error.line = position.line + 1;
              error.column = position.col;
            }
            pushError(errors, relativePath, error);
          }
          continue;
        }
        const data = document.toJS();
        validation.validateMaterialDocumentHeader(data, `${relativePath} front matter`);
        if (data.id !== expectedId) {
          throw new Error(`front matter id must match filename "${expectedId}".`);
        }
        validation.validateMaterialMarkup(body, relativePath, bodyLineOffset);
        validation.validateMaterialAttributeMarkup(data, body, relativePath, bodyLineOffset);
        await validateResources(body, relativePath, "materials", bodyLineOffset);
        if (materialFiles.has(relativePath)) {
          throw new Error("Material file paths must be unique.");
        }
        if ([...materialFiles.values()].some((material) => material.data.id === data.id)) {
          throw new Error(`Material id "${data.id}" is already defined.`);
        }
        materialFiles.set(relativePath, { file: relativePath, data, html: body });
      } catch (error) {
        pushError(errors, relativePath, error);
      }
    }
  }

  await discoverMaterials();

  const linkedSpecsByScreen = new Map();
  for (const screen of screens) {
    normalizeScreenLayers(screen.data);
    if (typeof screen.data.name !== "string") {
      errors.push(`${screen.file}: name must be a string.`);
    }
    if (typeof screen.data.description !== "string") {
      errors.push(`${screen.file}: description must be a string.`);
    }
    if (screen.data.note !== undefined && typeof screen.data.note !== "string") {
      errors.push(`${screen.file}: note must be a string.`);
    }
    const linkedSpecPaths = new Set();
    linkedSpecsByScreen.set(screen.file, linkedSpecPaths);
    const materialIds = new Set();
    const placementsById = new Map();
    let previewStateIds = new Set(["default"]);
    let previewStates = [{ id: "default", name: "Default" }];
    try {
      previewStates = validation.validatePreviewStates(screen.data, screen.file);
      previewStateIds = new Set(previewStates.map((state) => state.id));
    } catch (error) {
      pushError(errors, screen.file, error);
    }
    if (screen.data.spec !== undefined) {
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
    if (Object.hasOwn(screen.data, "elements")) {
      errors.push(`${screen.file}: Screen elements are no longer supported; use materials.`);
    }
    const layerIds = new Set();
    if (screen.data.layers !== undefined) {
      if (!Array.isArray(screen.data.layers)) {
        errors.push(`${screen.file}: Screen layers must be a list.`);
      } else {
        screen.data.layers.forEach((layer, index) => {
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
        });
      }
    }
    if (!Array.isArray(screen.data.materials)) {
      errors.push(`${screen.file}: Screen "${screen.id}" materials must be a list.`);
      continue;
    }
    function validateVisibility(placement, location) {
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

    function validateMaterial(material, path, parentLayer = null) {
      const location = `${screen.file} materials[${path[0]}]` +
        path.slice(1).map((index) => `.children[${index}]`).join("");
      if (!validation.isMapping(material)) {
        errors.push(`${location}: Material must be a mapping.`);
        return;
      }
      try {
        validation.validateElementId(material.id, location);
        if (materialIds.has(material.id)) {
          errors.push(`${location}: Material id "${material.id}" is already used on this Screen.`);
        }
        materialIds.add(material.id);
        placementsById.set(material.id, material);
      } catch (error) {
        pushError(errors, location, error);
      }
      if (material.note !== undefined && typeof material.note !== "string") {
        errors.push(`${location}: note must be a string.`);
      }
      if (material.visible !== undefined && typeof material.visible !== "boolean") {
        errors.push(`${location}: visible must be a boolean.`);
      }
      validateVisibility(material, location);
      if (Object.hasOwn(material, "spec") || Object.hasOwn(material, "interactions")) {
        errors.push(`${location}: Materials are visual only; do not define behavior or interactions here.`);
      }

      if (isScreenGroup(material)) {
        const allowedProperties = new Set([
          "id", "type", "children", "position", "size", "rotation", "scale", "affine",
          "visible", "visibility", "note", "layer"
        ]);
        for (const property of Object.keys(material)) {
          if (!allowedProperties.has(property)) {
            errors.push(`${location}: unsupported property "${property}".`);
          }
        }
        const layer = path.length === 1 ? material.layer : parentLayer;
        if (path.length === 1 &&
            (typeof layer !== "string" || !layerIds.has(layer))) {
          errors.push(`${location}: layer must reference a layer defined on this Screen.`);
        }
        if (path.length > 1 && Object.hasOwn(material, "layer")) {
          errors.push(`${location}: nested placements inherit their layer from the group.`);
        }
        if (!validation.isMapping(material.position) ||
            !Number.isFinite(material.position.x) || !Number.isFinite(material.position.y)) {
          errors.push(`${location}: position must contain numeric x and y values.`);
        }
        if (!validation.isMapping(material.size) ||
            !Number.isFinite(material.size.width) || material.size.width < 24 ||
            !Number.isFinite(material.size.height) || material.size.height < 24) {
          errors.push(`${location}: size must contain width and height values of at least 24.`);
        }
        if (material.rotation !== undefined && !Number.isFinite(material.rotation)) {
          errors.push(`${location}: rotation must be a number.`);
        }
        if (material.scale !== undefined &&
            !isValidScale(material.scale)) {
          errors.push(`${location}: scale must be a positive number or positive x/y factors.`);
        }
        if (material.affine !== undefined && !isValidAffineMatrix(material.affine)) {
          errors.push(`${location}: affine must contain a non-singular a/b/c/d matrix.`);
        }
        if (!Array.isArray(material.children) || material.children.length === 0) {
          errors.push(`${location}: group children must be a non-empty list.`);
          return;
        }
        material.children.forEach((child, index) =>
          validateMaterial(child, [...path, index], layer)
        );
        return;
      }

      const allowedProperties = new Set([
        "id", "src", "attributes", "position", "size", "rotation", "scale", "affine",
        "visible", "visibility", "note", "layer"
      ]);
      for (const property of Object.keys(material)) {
        if (!allowedProperties.has(property)) {
          errors.push(`${location}: unsupported property "${property}".`);
        }
      }
      const layer = path.length === 1 ? material.layer : parentLayer;
      if (path.length === 1 &&
          (typeof layer !== "string" || !layerIds.has(layer))) {
        errors.push(`${location}: layer must reference a layer defined on this Screen.`);
      }
      if (path.length > 1 && Object.hasOwn(material, "layer")) {
        errors.push(`${location}: nested placements inherit their layer from the group.`);
      }
      const materialDefinition = materialFiles.get(material.src);
      if (materialDefinition) {
        try {
          validation.validateMaterialInstanceAttributes(material, materialDefinition.data, location);
        } catch (error) {
          pushError(errors, location, error);
        }
      }
      if (typeof material.src !== "string" || !materialFiles.has(material.src)) {
        errors.push(`${location}: src must reference a discovered Material STML file.`);
      }
      if (!validation.isMapping(material.position) ||
          !Number.isFinite(material.position.x) || !Number.isFinite(material.position.y)) {
        errors.push(`${location}: position must contain numeric x and y values.`);
      }
      if (!validation.isMapping(material.size) ||
          !Number.isFinite(material.size.width) || material.size.width < 24 ||
          !Number.isFinite(material.size.height) || material.size.height < 24) {
        errors.push(`${location}: size must contain width and height values of at least 24.`);
      }
      if (material.rotation !== undefined && !Number.isFinite(material.rotation)) {
        errors.push(`${location}: rotation must be a number.`);
      }
      if (material.scale !== undefined && !isValidScale(material.scale)) {
        errors.push(`${location}: scale must be a positive number or positive x/y factors.`);
      }
      if (material.affine !== undefined && !isValidAffineMatrix(material.affine)) {
        errors.push(`${location}: affine must contain a non-singular a/b/c/d matrix.`);
      }
    }

    const elementSpecIds = new Set();
    let elementSpecPaths = [];
    screen.data.materials.forEach((material, index) => validateMaterial(material, [index]));
    for (const previewState of previewStates) {
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
      for (const [placementId, override] of Object.entries(previewState.placements || {})) {
        const material = placementsById.get(placementId);
        const location = `${screen.file} Screen State "${previewState.id}" placement "${placementId}"`;
        if (!material) {
          errors.push(`${location} does not reference a placement on this Screen.`);
          continue;
        }
        if (!validation.isMapping(override)) {
          errors.push(`${location} override must be a mapping.`);
          continue;
        }
        const allowed = new Set([
          "visible", "attributes", "position", "size", "rotation", "scale", "affine"
        ]);
        for (const property of Object.keys(override)) {
          if (!allowed.has(property)) errors.push(`${location} has unsupported override "${property}".`);
        }
        if (override.visible !== undefined && typeof override.visible !== "boolean") {
          errors.push(`${location} visible override must be a boolean.`);
        }
        if (override.position !== undefined &&
            (!validation.isMapping(override.position) ||
             !Number.isFinite(override.position.x) || !Number.isFinite(override.position.y))) {
          errors.push(`${location} position override must contain numeric x and y values.`);
        }
        if (override.size !== undefined &&
            (!validation.isMapping(override.size) ||
             !Number.isFinite(override.size.width) || override.size.width < 24 ||
             !Number.isFinite(override.size.height) || override.size.height < 24)) {
          errors.push(`${location} size override must contain width and height values of at least 24.`);
        }
        if (override.rotation !== undefined && !Number.isFinite(override.rotation)) {
          errors.push(`${location} rotation override must be a number.`);
        }
        if (override.scale !== undefined && !isValidScale(override.scale)) {
          errors.push(`${location} scale override must be a positive number or positive x/y factors.`);
        }
        if (override.affine !== undefined && !isValidAffineMatrix(override.affine)) {
          errors.push(`${location} affine override must contain a non-singular a/b/c/d matrix.`);
        }
        if (override.attributes !== undefined) {
          if (!validation.isMapping(override.attributes) || isScreenGroup(material)) {
            errors.push(`${location} attributes override must be a mapping on a Material placement.`);
          } else {
            const attributes = Object.fromEntries(
              Object.entries(override.attributes).filter(([, value]) => value !== null)
            );
            const materialDefinition = materialFiles.get(material.src);
            if (materialDefinition) {
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
          }
        }
      }
    }
    try {
      elementSpecPaths = await listElementSpecPaths(screen.id);
    } catch (error) {
      pushError(errors, `${screen.file} Element specs`, error);
    }
    for (const specPath of elementSpecPaths) {
      try {
        validation.validateSpecPath(specPath);
      } catch (error) {
        pushError(errors, `Behavior spec "${specPath}"`, error);
        continue;
      }
      try {
        const target = await resolveProjectPath(projectRoot, specPath, "file");
        const content = await fs.readFile(target, "utf8");
        specContents.set(specPath, content);
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
          throw new Error(
            `${specPath} must include a SpecUX Screen link to its Element "${elementId}".`
          );
        }
        if (elementSpecIds.has(elementId)) {
          throw new Error(`Element "${elementId}" has more than one behavior spec.`);
        }
        elementSpecIds.add(elementId);
        referencedSpecPaths.add(specPath);
        linkedSpecPaths.add(specPath);
      } catch (error) {
        pushError(errors, `Behavior spec "${specPath}"`, error);
      }
    }
  }

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
  for (const [specPath, content] of specContents) {
    try {
      validation.validateSpecScreenReferences(content, screens, specPath);
    } catch (error) {
      pushError(errors, `Behavior spec "${specPath}"`, error);
    }
  }
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

  if (typeof project.theme === "string" && project.theme) {
    theme = await readYaml(project.theme);
    if (theme) {
      try {
        validation.validateTheme(theme, project.theme);
      } catch (error) {
        pushError(errors, project.theme, error);
      }
    }
  }

  return {
    errors: addYamlErrorLocations(errors, yamlDocuments),
    project,
    materialFiles,
    screens,
    referencedSpecPaths
  };
}

module.exports = { SPECUX_VERSION, isWithin, resolveProjectPath, safeRelativePath, validateProject };
