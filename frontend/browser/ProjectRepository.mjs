import { normalizeScreenLayers } from "../../shared/ScreenLayers.mjs";
import {
  isScreenGroup,
  isValidAffineMatrix,
  isValidScale
} from "../../shared/ScreenGroups.mjs";

export class ProjectRepository {
  constructor({ appRoot, fetcher, parseYaml, validation, materialFileExtension }) {
    this.appRoot = appRoot;
    this.fetcher = fetcher;
    this.parseYaml = parseYaml;
    this.validation = validation;
    this.materialFileExtension = materialFileExtension;
    this.materialFiles = new Map();
  }

  safeProjectUrl(filePath, base = this.appRoot) {
    if (typeof filePath !== "string" || !filePath ||
        filePath.startsWith("/") || filePath.includes("\\")) {
      throw new Error(`Invalid project file path: ${String(filePath)}`);
    }
    if (filePath.split("/").includes("..")) {
      throw new Error(`Project paths cannot leave their directory: ${filePath}`);
    }
    const url = new URL(filePath, base);
    if (url.origin !== this.appRoot.origin || !url.pathname.startsWith(this.appRoot.pathname)) {
      throw new Error(`Project resource is outside the specux/ example project: ${filePath}`);
    }
    return url;
  }

  async loadText(filePath, base = this.appRoot) {
    const response = await this.fetcher(this.safeProjectUrl(filePath, base));
    if (!response.ok) {
      throw new Error(`Could not load ${filePath} (HTTP ${response.status}).`);
    }
    return response.text();
  }

  async loadYaml(filePath) {
    return this.parseYamlMapping(await this.loadText(filePath), filePath);
  }

  async parseYamlSource(source, context) {
    const response = await this.fetcher("/api/yaml/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`${context}: ${result.error || `YAML parsing failed (HTTP ${response.status}).`}`);
    }
    return result.data;
  }

  parseYamlMapping(source, filePath) {
    const parsed = this.parseYaml(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`${filePath} must contain a YAML mapping.`);
    }
    return parsed;
  }

  async loadProjectFilePaths() {
    const response = await this.fetcher("/api/files");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Could not list project files (HTTP ${response.status}).`);
    }
    if (!Array.isArray(result.files) || result.files.some((filePath) =>
      typeof filePath !== "string" || !filePath || filePath.startsWith("/") ||
      filePath.includes("\\") || filePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )
    )) {
      throw new Error("The project file listing is invalid.");
    }
    return result.files;
  }

  async validateProject() {
    const response = await this.fetcher("/api/validation");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Could not validate project (HTTP ${response.status}).`);
    }
    if (!Array.isArray(result.errors) || result.errors.some((error) =>
      typeof error !== "string"
    )) {
      throw new Error("The project validation response is invalid.");
    }
    if (result.errors.length) throw new Error(result.errors.join("\n"));
  }

  validateScreenMaterials(screen, materialFiles = this.materialFiles) {
    normalizeScreenLayers(screen.data);
    if (typeof screen.data.name !== "string") {
      throw new Error(`${screen.file}: name must be a string.`);
    }
    if (typeof screen.data.description !== "string") {
      throw new Error(`${screen.file}: description must be a string.`);
    }
    if (screen.data.note !== undefined && typeof screen.data.note !== "string") {
      throw new Error(`${screen.file}: note must be a string.`);
    }
    const ids = new Set();
    const placementsById = new Map();
    if (Object.hasOwn(screen.data, "elements")) {
      throw new Error(`${screen.file}: Screen elements are no longer supported; use materials.`);
    }
    const layerIds = new Set();
    if (screen.data.layers !== undefined) {
      if (!Array.isArray(screen.data.layers)) {
        throw new Error(`${screen.file}: Screen layers must be a list.`);
      }
      for (const [index, layer] of screen.data.layers.entries()) {
        const location = `${screen.file} layers[${index}]`;
        if (!this.validation.isMapping(layer)) {
          throw new Error(`${location}: Layer must be a mapping.`);
        }
        this.validation.validateElementId(layer.id, location);
        if (layerIds.has(layer.id)) {
          throw new Error(`${location}: Layer id "${layer.id}" is already used on this Screen.`);
        }
        layerIds.add(layer.id);
        if (typeof layer.name !== "string" || !layer.name.trim()) {
          throw new Error(`${location}: Layer name must be a non-empty string.`);
        }
        if (layer.visible !== undefined && typeof layer.visible !== "boolean") {
          throw new Error(`${location}: Layer visible must be a boolean.`);
        }
        for (const property of Object.keys(layer)) {
          if (!["id", "name", "visible"].includes(property)) {
            throw new Error(`${location}: unsupported property "${property}".`);
          }
        }
      }
    }
    if (!Array.isArray(screen.data.materials)) {
      throw new Error(`${screen.file}: Screen materials must be a list.`);
    }
    const previewStateIds = new Set(
      this.validation.validatePreviewStates(screen.data, screen.file).map(({ id }) => id)
    );
    const validateVisibility = (placement, location) => {
      if (placement.visibility === undefined) return;
      if (!this.validation.isMapping(placement.visibility)) {
        throw new Error(`${location}: visibility must be a mapping of preview state ids to booleans.`);
      }
      for (const [stateId, visible] of Object.entries(placement.visibility)) {
        if (!previewStateIds.has(stateId) || typeof visible !== "boolean") {
          throw new Error(`${location}: visibility for "${stateId}" must reference a preview state and be a boolean.`);
        }
      }
    };
    const validatePlacement = (placement, path, parentLayer = null) => {
      const location = `${screen.file} materials[${path[0]}]` +
        path.slice(1).map((index) => `.children[${index}]`).join("");
      if (!this.validation.isMapping(placement)) {
        throw new Error(`${location}: Material must be a mapping.`);
      }
      this.validation.validateElementId(placement.id, location);
      if (ids.has(placement.id)) {
        throw new Error(`${location}: Material id "${placement.id}" is already used on this Screen.`);
      }
      ids.add(placement.id);
      placementsById.set(placement.id, placement);
      if (placement.note !== undefined && typeof placement.note !== "string") {
        throw new Error(`${location}: note must be a string.`);
      }
      if (placement.visible !== undefined && typeof placement.visible !== "boolean") {
        throw new Error(`${location}: visible must be a boolean.`);
      }
      if (placement.visibility !== undefined) validateVisibility(placement, location);
      if (Object.hasOwn(placement, "spec") || Object.hasOwn(placement, "interactions")) {
        throw new Error(`${location}: Materials are visual only; do not define behavior or interactions here.`);
      }
      if (isScreenGroup(placement)) {
        const allowedProperties = new Set([
          "id", "type", "children", "position", "size", "rotation", "scale", "affine",
          "visible", "visibility", "note", "layer"
        ]);
        for (const property of Object.keys(placement)) {
          if (!allowedProperties.has(property)) {
            throw new Error(`${location}: unsupported property "${property}".`);
          }
        }
        const layer = path.length === 1 ? placement.layer : parentLayer;
        if (path.length === 1 &&
            (typeof layer !== "string" || !layerIds.has(layer))) {
          throw new Error(`${location}: layer must reference a layer defined on this Screen.`);
        }
        if (path.length > 1 && Object.hasOwn(placement, "layer")) {
          throw new Error(`${location}: nested placements inherit their layer from the group.`);
        }
        if (!this.validation.isMapping(placement.position) ||
            !Number.isFinite(placement.position.x) || !Number.isFinite(placement.position.y)) {
          throw new Error(`${location}: position must contain numeric x and y values.`);
        }
        if (!this.validation.isMapping(placement.size) ||
            !Number.isFinite(placement.size.width) || placement.size.width < 24 ||
            !Number.isFinite(placement.size.height) || placement.size.height < 24) {
          throw new Error(`${location}: size must contain width and height values of at least 24.`);
        }
        if (placement.rotation !== undefined && !Number.isFinite(placement.rotation)) {
          throw new Error(`${location}: rotation must be a number.`);
        }
        if (placement.scale !== undefined &&
            !isValidScale(placement.scale)) {
          throw new Error(`${location}: scale must be a positive number or positive x/y factors.`);
        }
        if (placement.affine !== undefined && !isValidAffineMatrix(placement.affine)) {
          throw new Error(`${location}: affine must contain a non-singular a/b/c/d matrix.`);
        }
        if (!Array.isArray(placement.children) || placement.children.length === 0) {
          throw new Error(`${location}: group children must be a non-empty list.`);
        }
        placement.children.forEach((child, index) =>
          validatePlacement(child, [...path, index], layer)
        );
        return;
      }

      const allowedProperties = new Set([
        "id", "src", "attributes", "position", "size", "rotation", "scale", "affine",
        "visible", "visibility", "note", "layer"
      ]);
      for (const property of Object.keys(placement)) {
        if (!allowedProperties.has(property)) {
          throw new Error(`${location}: unsupported property "${property}".`);
        }
      }
      const layer = path.length === 1 ? placement.layer : parentLayer;
      if (path.length === 1 &&
          (typeof layer !== "string" || !layerIds.has(layer))) {
        throw new Error(`${location}: layer must reference a layer defined on this Screen.`);
      }
      if (path.length > 1 && Object.hasOwn(placement, "layer")) {
        throw new Error(`${location}: nested placements inherit their layer from the group.`);
      }
      if (typeof placement.src !== "string" || !materialFiles.has(placement.src)) {
        throw new Error(`${location}: src must reference a discovered Material STML file.`);
      }
      const materialDefinition = materialFiles.get(placement.src);
      if (materialDefinition) {
        this.validation.validateMaterialInstanceAttributes(
          placement,
          materialDefinition.data,
          location
        );
      }
      if (!this.validation.isMapping(placement.position) ||
          !Number.isFinite(placement.position.x) || !Number.isFinite(placement.position.y)) {
        throw new Error(`${location}: position must contain numeric x and y values.`);
      }
      if (!this.validation.isMapping(placement.size) ||
          !Number.isFinite(placement.size.width) || placement.size.width < 24 ||
          !Number.isFinite(placement.size.height) || placement.size.height < 24) {
        throw new Error(`${location}: size must contain width and height values of at least 24.`);
      }
      if (placement.rotation !== undefined && !Number.isFinite(placement.rotation)) {
        throw new Error(`${location}: rotation must be a number.`);
      }
      if (placement.scale !== undefined && !isValidScale(placement.scale)) {
        throw new Error(`${location}: scale must be a positive number or positive x/y factors.`);
      }
      if (placement.affine !== undefined && !isValidAffineMatrix(placement.affine)) {
        throw new Error(`${location}: affine must contain a non-singular a/b/c/d matrix.`);
      }
    };
    screen.data.materials.forEach((placement, index) =>
      validatePlacement(placement, [index])
    );
    for (const previewState of this.validation.validatePreviewStates(screen.data, screen.file)) {
      for (const [layerId, layerOverride] of Object.entries(previewState.layers || {})) {
        if (!layerIds.has(layerId)) {
          throw new Error(`${screen.file} preview state "${previewState.id}" references unknown layer "${layerId}".`);
        }
        if (!this.validation.isMapping(layerOverride) ||
            Object.keys(layerOverride).some((key) => key !== "visible") ||
            typeof layerOverride.visible !== "boolean") {
          throw new Error(`${screen.file} preview state "${previewState.id}" layer "${layerId}" must contain a boolean visible value.`);
        }
      }
      for (const [placementId, override] of Object.entries(previewState.placements || {})) {
        const placement = placementsById.get(placementId);
        const location = `${screen.file} preview state "${previewState.id}" placement "${placementId}"`;
        if (!placement) throw new Error(`${location} does not reference a placement on this Screen.`);
        if (!this.validation.isMapping(override)) {
          throw new Error(`${location} override must be a mapping.`);
        }
        const allowed = new Set([
          "visible", "attributes", "position", "size", "rotation", "scale", "affine"
        ]);
        for (const property of Object.keys(override)) {
          if (!allowed.has(property)) {
            throw new Error(`${location} has unsupported override "${property}".`);
          }
        }
        if (override.visible !== undefined && typeof override.visible !== "boolean") {
          throw new Error(`${location} visible override must be a boolean.`);
        }
        if (override.position !== undefined &&
            (!this.validation.isMapping(override.position) ||
             !Number.isFinite(override.position.x) || !Number.isFinite(override.position.y))) {
          throw new Error(`${location} position override must contain numeric x and y values.`);
        }
        if (override.size !== undefined &&
            (!this.validation.isMapping(override.size) ||
             !Number.isFinite(override.size.width) || override.size.width < 24 ||
             !Number.isFinite(override.size.height) || override.size.height < 24)) {
          throw new Error(`${location} size override must contain width and height values of at least 24.`);
        }
        if (override.rotation !== undefined && !Number.isFinite(override.rotation)) {
          throw new Error(`${location} rotation override must be a number.`);
        }
        if (override.scale !== undefined && !isValidScale(override.scale)) {
          throw new Error(`${location} scale override must be a positive number or positive x/y factors.`);
        }
        if (override.affine !== undefined && !isValidAffineMatrix(override.affine)) {
          throw new Error(`${location} affine override must contain a non-singular a/b/c/d matrix.`);
        }
        if (override.attributes !== undefined) {
          if (!this.validation.isMapping(override.attributes)) {
            throw new Error(`${location} attributes override must be a mapping.`);
          }
          if (isScreenGroup(placement)) {
            throw new Error(`${location} cannot override attributes on a group.`);
          }
          const attributes = Object.fromEntries(
            Object.entries(override.attributes).filter(([, value]) => value !== null)
          );
          const materialDefinition = materialFiles.get(placement.src);
          if (!materialDefinition) {
            throw new Error(`${location} references an unavailable Material "${placement.src}".`);
          }
          this.validation.validateMaterialInstanceAttributes(
            { attributes },
            materialDefinition.data,
            location
          );
        }
      }
    }
  }

  findInstancePathById(instances, elementId, parentPath = []) {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      const instancePath = [...parentPath, index];
      if (instance.id === elementId) return instancePath;
      if (isScreenGroup(instance)) {
        const childPath = this.findInstancePathById(
          instance.children,
          elementId,
          instancePath
        );
        if (childPath) return childPath;
      }
    }
    return null;
  }

  refreshElementSpecOwner(filePath, source, screens, elementSpecOwners) {
    elementSpecOwners.delete(filePath);
    const identity = this.validation.getElementSpecIdentity(filePath);
    if (!identity) return null;
    const screen = screens.find((entry) => entry.id === identity.screenId);
    if (!screen) {
      throw new Error(`${filePath}: Screen "${identity.screenId}" is not available.`);
    }
    const { elementId } = identity;
    this.validation.validateElementSpecPath(filePath, elementId);
    const references = this.validation.validateSpecScreenReferences(source, screens, filePath);
    if (!references.some((reference) =>
      reference.screenId === screen.id && reference.placementId === elementId
    )) {
      throw new Error(
        `${filePath} must include a SpecUX Screen link to its Element "${elementId}".`
      );
    }
    const instancePath = this.findInstancePathById(screen.data.materials || [], elementId);
    if (!instancePath) {
      throw new Error(`${filePath} links to unavailable Element "${elementId}".`);
    }
    for (const [otherPath, owner] of elementSpecOwners) {
      if (otherPath !== filePath && owner.screenFile === screen.file && owner.elementId === elementId) {
        throw new Error(`${filePath}: Element "${elementId}" already has behavior spec "${otherPath}".`);
      }
    }
    const owner = { screenFile: screen.file, elementId, instancePath };
    elementSpecOwners.set(filePath, owner);
    return owner;
  }

  async load() {
    await this.validateProject();
    const project = await this.loadYaml("project.yml");
    if (project.name !== undefined && typeof project.name !== "string") {
      throw new Error("project.yml name must be a string.");
    }
    if (project.description !== undefined && typeof project.description !== "string") {
      throw new Error("project.yml description must be a string.");
    }
    const supportedProjectProperties = new Set([
      "name", "description", "specux", "screens", "theme", "spec", "workflows"
    ]);
    for (const property of Object.keys(project)) {
      if (!supportedProjectProperties.has(property)) {
        throw new Error(`project.yml has unsupported property "${property}".`);
      }
    }
    if (typeof project.specux !== "string" || !project.specux) {
      throw new Error("project.yml must specify the SpecUX version in specux.");
    }
    if (!Array.isArray(project.screens)) {
      throw new Error("project.yml must list screens.");
    }
    const screenIds = new Set();
    const screenFiles = new Set();
    for (const [index, entry] of project.screens.entries()) {
      if (!this.validation.isMapping(entry)) {
        throw new Error(`project.yml screens[${index}] must be a mapping.`);
      }
      for (const property of Object.keys(entry)) {
        if (!["id", "file"].includes(property)) {
          throw new Error(`project.yml screens[${index}] has unsupported property "${property}".`);
        }
      }
      if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
        throw new Error(`project.yml screens[${index}] id must use lowercase letters, numbers, and hyphens.`);
      }
      if (screenIds.has(entry.id)) {
        throw new Error(`project.yml screens defines id "${entry.id}" more than once.`);
      }
      if (entry.file !== `screens/${entry.id}/screen.yml`) {
        throw new Error(`project.yml Screen "${entry.id}" file must be "screens/${entry.id}/screen.yml".`);
      }
      if (screenFiles.has(entry.file)) {
        throw new Error(`project.yml screens references "${entry.file}" more than once.`);
      }
      screenIds.add(entry.id);
      screenFiles.add(entry.file);
    }
    if (Object.hasOwn(project, "workflows")) {
      throw new Error("project.yml workflows are no longer supported; use project.spec or a Screen spec.");
    }

    const projectFilePaths = await this.loadProjectFilePaths();
    const materialPaths = projectFilePaths.filter((filePath) =>
      filePath.startsWith("materials/") && filePath.endsWith(this.materialFileExtension)
    );
    for (const filePath of materialPaths) {
      if (!/^materials\/[a-z][a-z0-9-]*\.stml$/.test(filePath)) {
        throw new Error(`${filePath}: Material STML files must be directly inside materials/.`);
      }
    }
    const [screens, loadedMaterials, loadedTheme] = await Promise.all([
      Promise.all(project.screens.map(async (entry) => {
        const yamlSource = await this.loadText(entry.file);
        return {
          id: entry.id,
          file: entry.file,
          data: this.parseYamlMapping(yamlSource, entry.file),
          yamlSource,
          yamlSourceMode: "source",
          yamlParseVersion: 0,
          yamlSerializeVersion: 0,
          yamlTimer: null
        };
      })),
      Promise.all(materialPaths.map(async (filePath) => {
        const documentSource = await this.loadText(filePath);
        const { header, body } = this.validation.splitMaterialDocument(documentSource, filePath);
        const data = await this.parseYamlSource(header, `${filePath} front matter`);
        this.validation.validateMaterialDocumentHeader(data, `${filePath} front matter`);
        const fileId = filePath.slice(
          filePath.lastIndexOf("/") + 1,
          -this.materialFileExtension.length
        );
        if (data.id !== fileId) {
          throw new Error(`Material id must match the filename in ${filePath}.`);
        }
        this.validation.validateMaterialMarkup(body, filePath);
        this.validation.validateMaterialAttributeMarkup(data, body, filePath);
        return {
          id: data.id,
          file: filePath,
          base: this.safeProjectUrl("materials/"),
          data,
          documentSource,
          html: body
        };
      })),
      this.loadTheme(project.theme)
    ]);

    const materialFiles = new Map(loadedMaterials.map((material) => [material.file, material]));
    if (materialFiles.size !== loadedMaterials.length) {
      throw new Error("Discovered Material file paths must be unique.");
    }
    const materialIds = new Set();
    for (const material of loadedMaterials) {
      if (materialIds.has(material.id)) {
        throw new Error(`Discovered Material id "${material.id}" is already in use.`);
      }
      materialIds.add(material.id);
    }
    this.materialFiles = materialFiles;
    for (const screen of screens) this.validateScreenMaterials(screen, materialFiles);
    const specPaths = new Set();
    const elementSpecPaths = [];
    for (const screen of screens) {
      if (screen.data.spec !== undefined) {
        this.validation.validateSpecPath(screen.data.spec);
        specPaths.add(screen.data.spec);
      }
      const prefix = `screens/${screen.id}/specs/element-`;
      for (const filePath of projectFilePaths) {
        if (!filePath.startsWith(prefix) || !filePath.endsWith(".md")) continue;
        this.validation.validateSpecPath(filePath);
        elementSpecPaths.push(filePath);
        specPaths.add(filePath);
      }
    }
    if (project.spec !== undefined) {
      this.validation.validateSpecPath(project.spec);
      specPaths.add(project.spec);
    }

    const specSources = new Map(await Promise.all([...specPaths].map(async (filePath) =>
      [filePath, await this.loadText(filePath)]
    )));
    for (const [filePath, source] of specSources) {
      this.validation.validateSpecScreenReferences(source, screens, filePath);
    }
    const workflowPaths = [];
    for (const screen of screens) {
      const prefix = `screens/${screen.id}/workflows/`;
      for (const filePath of projectFilePaths) {
        if (!filePath.startsWith(prefix) || !filePath.endsWith(".mmd")) continue;
        this.validation.validateWorkflowPath(filePath);
        workflowPaths.push(filePath);
      }
    }
    const workflowSources = new Map(await Promise.all(workflowPaths.map(async (filePath) =>
      [filePath, await this.loadText(filePath)]
    )));
    const elementSpecOwners = new Map();
    for (const filePath of elementSpecPaths) {
      this.refreshElementSpecOwner(filePath, specSources.get(filePath), screens, elementSpecOwners);
    }

    return {
      project,
      projectFilePaths,
      materialFiles,
      screens,
      specSources,
      workflowSources,
      elementSpecOwners,
      theme: loadedTheme
    };
  }

  async loadTheme(themePath) {
    const data = await this.loadYaml(themePath);
    this.validation.validateTheme(data, themePath);
    return data;
  }
}
