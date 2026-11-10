const fs = require("node:fs/promises");
const path = require("node:path");
const validation = require("../../shared/validation");
const { resolveProjectPath } = require("./paths");
const { getSourcePosition, pushError } = require("./sourceLocations");

/** Extracts local resource references from markup attributes and CSS url() values. */
function getResourceReferences(sourceText) {
  // Collect local paths from markup source and destination attributes.
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

  // Also collect CSS url() references from the Material markup.
  const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  for (const reference of sourceText.matchAll(cssUrls)) {
    const value = (reference[1] ?? reference[2] ?? reference[3]).trim();
    references.push({ value, offset: reference.index + reference[0].indexOf(value) });
  }
  return references;
}

/** Returns whether a resource reference needs no local path validation. */
function isIgnoredResourceReference(reference, seenReferences) {
  return !reference || reference.startsWith("#") || reference.startsWith("data:image/") ||
    reference.includes("${") || seenReferences.has(reference);
}

/** Reports invalid URL escaping and returns a decoded resource path when valid. */
function decodeResourcePath(reference, sourceText, offset, sourceFile, lineOffset, errors) {
  try {
    const encodedPath = reference.split(/[?#]/, 1)[0];
    return decodeURIComponent(encodedPath);
  } catch {
    const position = getSourcePosition(sourceText, offset, lineOffset);
    errors.push(
      `${sourceFile}: resource "${reference}" contains invalid URL escaping. ` +
      `(line ${position.line}, column ${position.column})`
    );
    return null;
  }
}

/** Checks a decoded local resource path cannot escape its project directory. */
function isUnsafeResourcePath(reference, resourcePath) {
  return /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") ||
    resourcePath.startsWith("/") || resourcePath.includes("\\") ||
    resourcePath.split("/").includes("..");
}

/** Validates one markup or CSS resource reference and checks that its file exists. */
async function validateResourceReference(referenceInfo, context) {
  // Skip non-local or repeated references before calculating their source coordinates.
  const { value: reference, offset } = referenceInfo;
  const { seenReferences, sourceText, sourceFile, baseDirectory, lineOffset, errors, checkFile } = context;
  if (isIgnoredResourceReference(reference, seenReferences)) return;
  seenReferences.add(reference);
  const position = getSourcePosition(sourceText, offset, lineOffset);

  // Decode the URL and reject references that could escape the project.
  const resourcePath = decodeResourcePath(
    reference, sourceText, offset, sourceFile, lineOffset, errors
  );
  if (resourcePath === null) return;
  if (isUnsafeResourcePath(reference, resourcePath)) {
    errors.push(
      `${sourceFile}: resource "${reference}" must stay inside the project. ` +
      `(line ${position.line}, column ${position.column})`
    );
    return;
  }

  // Resolve a safe local path relative to materials/ and verify that the file exists.
  if (!resourcePath) return;
  const relativePath = path.posix.join(baseDirectory, resourcePath);
  await checkFile(relativePath, `${sourceFile} resource "${reference}"`, position);
}

/** Validates all unique local resource references found in one Material body. */
async function validateResources(sourceText, sourceFile, baseDirectory, lineOffset, context) {
  const references = getResourceReferences(sourceText);
  const seenReferences = new Set();
  for (const reference of references) {
    await validateResourceReference(reference, {
      ...context,
      seenReferences,
      sourceText,
      sourceFile,
      baseDirectory,
      lineOffset
    });
  }
}

/** Adds source coordinates to every YAML parser error in a Material header. */
function recordMaterialYamlErrors(relativePath, document, errors) {
  for (const issue of document.errors) {
    const position = issue.linePos?.[0];
    const error = new Error(issue.message);
    if (position) {
      error.line = position.line + 1;
      error.column = position.col;
    }
    pushError(errors, relativePath, error);
  }
}

/** Reads a regular STML file, parses its header, and returns its validation inputs. */
async function loadMaterialFile(entry, directory, relativePath, context) {
  // Ignore directories and unsupported extensions while rejecting unsafe Material entries.
  const absolutePath = path.join(directory, entry.name);
  const details = await fs.lstat(absolutePath);
  if (details.isSymbolicLink()) throw new Error("Material directories cannot contain symbolic links.");
  if (!details.isFile()) {
    if (details.isDirectory()) return null;
    throw new Error("Material paths must be regular files.");
  }
  if (path.posix.extname(entry.name).toLowerCase() !== validation.MATERIAL_FILE_EXTENSION) {
    return null;
  }
  const expectedId = path.posix.basename(entry.name, validation.MATERIAL_FILE_EXTENSION);
  if (!/^[a-z][a-z0-9-]*$/.test(expectedId)) {
    throw new Error("Material filenames must use lowercase letters, numbers, and hyphens.");
  }

  // Split and parse the front matter, preserving the body offset for later diagnostics.
  const source = await fs.readFile(absolutePath, "utf8");
  const { header, body } = validation.splitMaterialDocument(source, relativePath);
  const bodyLineOffset = source.slice(0, source.length - body.length).split("\n").length - 1;
  const document = context.YAML.parseDocument(header);
  context.yamlDocuments.set(relativePath, { document, source: header, lineOffset: 1 });
  if (document.errors.length) {
    recordMaterialYamlErrors(relativePath, document, context.errors);
    return null;
  }
  return {
    source,
    body,
    bodyLineOffset,
    expectedId,
    data: document.toJS()
  };
}

/** Adds a valid Material to the index after checking its unique path and ID. */
function indexMaterial(relativePath, material, materialFiles) {
  if (materialFiles.has(relativePath)) throw new Error("Material file paths must be unique.");
  if ([...materialFiles.values()].some((item) => item.data.id === material.data.id)) {
    throw new Error(`Material id "${material.data.id}" is already defined.`);
  }
  materialFiles.set(relativePath, {
    file: relativePath,
    data: material.data,
    html: material.body
  });
}

/** Loads and validates one discovered Material file and its local resource references. */
async function validateMaterialEntry(entry, directory, context) {
  const relativePath = `materials/${entry.name}`;
  try {
    // Load the STML document and validate its declared identity and markup.
    const material = await loadMaterialFile(entry, directory, relativePath, context);
    if (!material) return;
    validation.validateMaterialDocumentHeader(
      material.data,
      `${relativePath} front matter`
    );
    if (material.data.id !== material.expectedId) {
      throw new Error(`front matter id must match filename "${material.expectedId}".`);
    }
    validation.validateMaterialMarkup(material.body, relativePath, material.bodyLineOffset);
    validation.validateMaterialAttributeMarkup(
      material.data,
      material.body,
      relativePath,
      material.bodyLineOffset
    );

    // Verify local resources before adding the valid Material to the shared index.
    await validateResources(
      material.body,
      relativePath,
      "materials",
      material.bodyLineOffset,
      context
    );
    indexMaterial(relativePath, material, context.materialFiles);
  } catch (error) {
    pushError(context.errors, relativePath, error);
  }
}

/** Locates the materials directory, treating a missing directory as no Materials. */
async function findMaterialsDirectory(projectRoot, errors) {
  try {
    return await resolveProjectPath(projectRoot, "materials", "directory");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    pushError(errors, "materials", error);
    return null;
  }
}

/** Discovers Materials and validates their markup and local resource references. */
async function validateProjectMaterials(context) {
  // Find the materials directory and treat its absence as an empty collection.
  const directory = await findMaterialsDirectory(context.projectRoot, context.errors);
  if (!directory) return;

  // Validate each discovered entry independently so one invalid Material does not stop the scan.
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    await validateMaterialEntry(entry, directory, context);
  }
}

module.exports = { validateProjectMaterials };
