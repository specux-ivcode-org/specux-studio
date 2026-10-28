const fs = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");
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
  errors.push(`${source}: ${error.message || String(error)}`);
}

async function validateProject(projectRoot) {
  const errors = [];
  const assets = new Map();
  const materialFiles = new Map();
  const screens = [];
  const usedAssetFiles = new Set();
  const referencedSpecPaths = new Set();
  const specContents = new Map();
  const templateIds = new Map();
  let project;
  let theme;
  const imageExtensions = new Set([
    ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"
  ]);

  async function readYaml(relativePath) {
    try {
      const target = await resolveProjectPath(projectRoot, relativePath, "file");
      const source = await fs.readFile(target, "utf8");
      const document = YAML.parseDocument(source);
      if (document.errors.length) {
        throw new Error(document.errors.map((issue) => issue.message).join("; "));
      }
      const data = document.toJS();
      if (!validation.isMapping(data)) throw new Error("must contain a YAML mapping.");
      return data;
    } catch (error) {
      pushError(errors, relativePath, error);
      return null;
    }
  }

  async function checkFile(relativePath, source) {
    try {
      await resolveProjectPath(projectRoot, relativePath, "file");
      return true;
    } catch (error) {
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

  async function validateResources(sourceText, sourceFile, baseDirectory) {
    const references = [];
    const tags = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    const attributes = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    for (const tag of sourceText.matchAll(tags)) {
      for (const attribute of tag[2].matchAll(attributes)) {
        references.push(attribute[1] ?? attribute[2] ?? attribute[3]);
      }
    }
    const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const reference of sourceText.matchAll(cssUrls)) {
      references.push((reference[1] ?? reference[2] ?? reference[3]).trim());
    }
    for (const reference of new Set(references)) {
      if (!reference || reference.startsWith("#") || reference.startsWith("data:image/") ||
          reference.includes("${")) continue;
      const encodedPath = reference.split(/[?#]/, 1)[0];
      let resourcePath;
      try {
        resourcePath = decodeURIComponent(encodedPath);
      } catch {
        errors.push(`${sourceFile}: resource "${reference}" contains invalid URL escaping.`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") ||
          resourcePath.startsWith("/") || resourcePath.includes("\\") ||
          resourcePath.split("/").includes("..")) {
        errors.push(`${sourceFile}: resource "${reference}" must stay inside the project.`);
        continue;
      }
      if (!resourcePath) continue;
      const relativePath = path.posix.join(baseDirectory, resourcePath);
      if (await checkFile(relativePath, `${sourceFile} resource "${reference}"`) &&
          /^(?:assets|screens\/[a-z][a-z0-9-]*\/assets)\//.test(relativePath)) {
        usedAssetFiles.add(relativePath);
      }
    }
  }

  project = await readYaml("project.yml");
  if (!project) {
    return { errors, project: null, assets, materialFiles, screens, usedAssetFiles, referencedSpecPaths };
  }

  if (typeof project.specux !== "string" || !project.specux) {
    errors.push("project.yml: specux must specify the SpecUX version.");
  } else if (project.specux !== SPECUX_VERSION) {
    errors.push(`project.yml: SpecUX version "${project.specux}" is not supported by this CLI (expected "${SPECUX_VERSION}").`);
  }
  if (!Array.isArray(project.screens)) errors.push("project.yml: screens must be a list.");
  if (Object.hasOwn(project, "assets") || Object.hasOwn(project, "asset-templates")) {
    errors.push("project.yml: asset registries are no longer supported; place files under assets/ or screens/<screen-id>/assets/.");
  }
  if (Object.hasOwn(project, "workflows")) {
    errors.push("project.yml: workflows are no longer supported; use project.spec, a Screen spec, or an Element's spec.");
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

  async function discoverAssetDirectory(relativeDirectory, ownerScreen, baseDirectory = relativeDirectory) {
    let directory;
    try {
      directory = await resolveProjectPath(projectRoot, relativeDirectory, "directory");
    } catch (error) {
      if (error.code === "ENOENT") return;
      pushError(errors, relativeDirectory, error);
      return;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      try {
        const absolutePath = path.join(directory, entry.name);
        const details = await fs.lstat(absolutePath);
        if (details.isSymbolicLink()) {
          throw new Error("asset directories cannot contain symbolic links.");
        }
        if (details.isDirectory()) {
          await discoverAssetDirectory(relativePath, ownerScreen, baseDirectory);
          continue;
        }
        if (!details.isFile()) throw new Error("asset paths must be regular files.");
        const extension = path.posix.extname(entry.name).toLowerCase();
        const fileType = extension === validation.TEMPLATE_FILE_EXTENSION
          ? "template"
          : imageExtensions.has(extension) ? "image" : "resource";
        if (fileType === "template" &&
            path.posix.dirname(relativePath) !== baseDirectory) {
          throw new Error("STML template files must be directly inside an assets directory.");
        }
        const asset = { file: relativePath, type: fileType, screen: ownerScreen };
        if (fileType === "template") {
          const source = await fs.readFile(absolutePath, "utf8");
          const { header, body } = validation.splitAssetDocument(source, relativePath);
          const document = YAML.parseDocument(header);
          if (document.errors.length) {
            throw new Error(document.errors.map((issue) => issue.message).join("; "));
          }
          const data = document.toJS();
          validation.validateAssetTemplateHeader(data, relativePath);
          if (data.id !== path.posix.basename(relativePath, validation.TEMPLATE_FILE_EXTENSION)) {
            throw new Error(`front matter id must match filename "${path.posix.basename(relativePath, validation.TEMPLATE_FILE_EXTENSION)}".`);
          }
          if (templateIds.has(data.id)) {
            throw new Error(`template id "${data.id}" is already defined by "${templateIds.get(data.id)}".`);
          }
          templateIds.set(data.id, relativePath);
          validation.assetCategoryPath(data, `${relativePath} front matter`);
          validation.validateAssetAttributes(data, `${relativePath} front matter`);
          validation.validateAssetSlots(data, `${relativePath} front matter`);
          validation.validateAssetSlotMarkup(data, body, relativePath);
          await validateResources(body, relativePath, path.posix.dirname(relativePath));
          const attributeNames = new Set(Object.keys(data.attributes || {}));
          for (const match of body.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
            if (!attributeNames.has(match[1])) {
              throw new Error(`references undeclared attribute "${match[1]}".`);
            }
          }
          asset.data = data;
          asset.html = body;
        }
        assets.set(relativePath, asset);
      } catch (error) {
        pushError(errors, relativePath, error);
      }
    }
  }

  await discoverAssetDirectory("assets", null);
  for (const screen of screens) {
    await discoverAssetDirectory(`screens/${screen.id}/assets`, screen.id);
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
        if (path.posix.extname(entry.name).toLowerCase() !== validation.TEMPLATE_FILE_EXTENSION) {
          continue;
        }
        const expectedId = path.posix.basename(entry.name, validation.TEMPLATE_FILE_EXTENSION);
        if (!/^[a-z][a-z0-9-]*$/.test(expectedId)) {
          throw new Error("Material filenames must use lowercase letters, numbers, and hyphens.");
        }
        const source = await fs.readFile(absolutePath, "utf8");
        const { header, body } = validation.splitAssetDocument(source, relativePath);
        const document = YAML.parseDocument(header);
        if (document.errors.length) {
          throw new Error(document.errors.map((issue) => issue.message).join("; "));
        }
        const data = document.toJS();
        validation.validateMaterialDocumentHeader(data, `${relativePath} front matter`);
        if (data.id !== expectedId) {
          throw new Error(`front matter id must match filename "${expectedId}".`);
        }
        validation.validateMaterialMarkup(body, relativePath);
        validation.validateMaterialAttributeMarkup(data, body, relativePath);
        await validateResources(body, relativePath, "materials");
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
    const linkedSpecPaths = new Set();
    linkedSpecsByScreen.set(screen.file, linkedSpecPaths);
    const materialIds = new Set();
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
    if (!Array.isArray(screen.data.materials)) {
      errors.push(`${screen.file}: Screen "${screen.id}" materials must be a list.`);
      continue;
    }
    function validateMaterial(material, index) {
      const location = `${screen.file} materials[${index}]`;
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
      } catch (error) {
        pushError(errors, location, error);
      }
      const allowedProperties = new Set([
        "id", "src", "attributes", "position", "size", "rotation", "visibility", "note"
      ]);
      for (const property of Object.keys(material)) {
        if (!allowedProperties.has(property)) errors.push(`${location}: unsupported property "${property}".`);
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
      if (material.note !== undefined && typeof material.note !== "string") {
        errors.push(`${location}: note must be a string.`);
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
      if (material.visibility !== undefined) {
        if (!validation.isMapping(material.visibility)) {
          errors.push(`${location}: visibility must be a mapping of preview state ids to booleans.`);
        } else {
          for (const [stateId, visible] of Object.entries(material.visibility)) {
            if (!previewStateIds.has(stateId)) {
              errors.push(`${location}: visibility references unknown preview state "${stateId}".`);
            }
            if (typeof visible !== "boolean") {
              errors.push(`${location}: visibility for preview state "${stateId}" must be a boolean.`);
            }
          }
        }
      }
    }

    const elementSpecIds = new Set();
    let elementSpecPaths = [];
    screen.data.materials.forEach(validateMaterial);
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
        const elementId = validation.validateElementSpecHeader(content, specPath);
        validation.validateElementSpecPath(specPath, elementId);
        if (!materialIds.has(elementId)) continue;
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
      pushError(errors, `${screen.file} preview-state specs`, error);
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
      if (theme.styles !== undefined) {
        if (typeof theme.styles !== "string" || !theme.styles) {
          errors.push(`${project.theme}: styles must be a relative CSS file path.`);
        } else {
          try {
            safeRelativePath(theme.styles);
            const themeDirectory = path.posix.dirname(project.theme);
            const stylesPath = path.posix.join(themeDirectory, theme.styles);
            const stylesheetPath = await resolveProjectPath(projectRoot, stylesPath, "file");
            await validateResources(
              await fs.readFile(stylesheetPath, "utf8"),
              stylesPath,
              path.posix.dirname(stylesPath)
            );
          } catch (error) {
            pushError(errors, `${project.theme} styles`, error);
          }
        }
      }
    }
  }

  return {
    errors,
    project,
    assets,
    materialFiles,
    screens,
    usedAssetFiles,
    referencedSpecPaths
  };
}

module.exports = { SPECUX_VERSION, isWithin, resolveProjectPath, safeRelativePath, validateProject };
