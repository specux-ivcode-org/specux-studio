export class ProjectRepository {
  constructor({ appRoot, fetcher, parseYaml, validation, templateFileExtension }) {
    this.appRoot = appRoot;
    this.fetcher = fetcher;
    this.parseYaml = parseYaml;
    this.validation = validation;
    this.templateFileExtension = templateFileExtension;
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

  validateScreenMaterials(screen, materialFiles = this.materialFiles) {
    const ids = new Set();
    if (Object.hasOwn(screen.data, "elements")) {
      throw new Error(`${screen.file}: Screen elements are no longer supported; use materials.`);
    }
    if (!Array.isArray(screen.data.materials)) {
      throw new Error(`${screen.file}: Screen materials must be a list.`);
    }
    const previewStateIds = new Set(
      this.validation.validatePreviewStates(screen.data, screen.file).map(({ id }) => id)
    );
    for (const [index, material] of screen.data.materials.entries()) {
      const location = `${screen.file} materials[${index}]`;
      if (!material || typeof material !== "object" || Array.isArray(material)) {
        throw new Error(`${location}: Material must be a mapping.`);
      }
      this.validation.validateElementId(material.id, location);
      if (ids.has(material.id)) {
        throw new Error(`${location}: Material id "${material.id}" is already used on this Screen.`);
      }
      ids.add(material.id);
      if (typeof material.src !== "string" || !materialFiles.has(material.src)) {
        throw new Error(`${location}: src must reference a discovered Material STML file.`);
      }
      const materialDefinition = materialFiles.get(material.src);
      if (materialDefinition) {
        this.validation.validateMaterialInstanceAttributes(
          material,
          materialDefinition.data,
          location
        );
      }
      if (!this.validation.isMapping(material.position) ||
          !Number.isFinite(material.position.x) || !Number.isFinite(material.position.y)) {
        throw new Error(`${location}: position must contain numeric x and y values.`);
      }
      if (!this.validation.isMapping(material.size) ||
          !Number.isFinite(material.size.width) || material.size.width < 24 ||
          !Number.isFinite(material.size.height) || material.size.height < 24) {
        throw new Error(`${location}: size must contain width and height values of at least 24.`);
      }
      if (material.rotation !== undefined && !Number.isFinite(material.rotation)) {
        throw new Error(`${location}: rotation must be a number.`);
      }
      if (material.note !== undefined && typeof material.note !== "string") {
        throw new Error(`${location}: note must be a string.`);
      }
      if (material.visibility !== undefined) {
        if (!this.validation.isMapping(material.visibility)) {
          throw new Error(`${location}: visibility must be a mapping of preview state ids to booleans.`);
        }
        for (const [stateId, visible] of Object.entries(material.visibility)) {
          if (!previewStateIds.has(stateId) || typeof visible !== "boolean") {
            throw new Error(`${location}: visibility for "${stateId}" must reference a preview state and be a boolean.`);
          }
        }
      }
      if (Object.hasOwn(material, "spec") || Object.hasOwn(material, "interactions")) {
        throw new Error(`${location}: Materials are visual only; do not define behavior or interactions here.`);
      }
      const allowedProperties = new Set([
        "id", "src", "attributes", "position", "size", "rotation", "visibility", "note"
      ]);
      for (const property of Object.keys(material)) {
        if (!allowedProperties.has(property)) {
          throw new Error(`${location}: unsupported property "${property}".`);
        }
      }
    }
  }

  findInstancePathById(instances, elementId, parentPath = []) {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      const instancePath = [...parentPath, index];
      if (instance.id === elementId) return instancePath;
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (!Array.isArray(children)) continue;
        const childPath = this.findInstancePathById(children, elementId, [...instancePath, slotId]);
        if (childPath) return childPath;
      }
    }
    return null;
  }

  refreshAssetSpecOwner(filePath, source, screens, assetSpecOwners) {
    assetSpecOwners.delete(filePath);
    const screen = screens.find((entry) =>
      filePath.startsWith(`screens/${entry.id}/specs/element-`)
    );
    if (!screen) return null;
    const elementId = this.validation.validateElementSpecHeader(source, filePath);
    this.validation.validateElementSpecPath(filePath, elementId);
    const instancePath = this.findInstancePathById(screen.data.materials || [], elementId);
    if (!instancePath) return null;
    for (const [otherPath, owner] of assetSpecOwners) {
      if (otherPath !== filePath && owner.screenFile === screen.file && owner.elementId === elementId) {
        throw new Error(`${filePath}: Element "${elementId}" already has behavior spec "${otherPath}".`);
      }
    }
    const owner = { screenFile: screen.file, elementId, instancePath };
    assetSpecOwners.set(filePath, owner);
    return owner;
  }

  async load() {
    const project = await this.loadYaml("project.yml");
    if (typeof project.specux !== "string" || !project.specux) {
      throw new Error("project.yml must specify the SpecUX version in specux.");
    }
    if (!Array.isArray(project.screens)) {
      throw new Error("project.yml must list screens.");
    }
    if (Object.hasOwn(project, "workflows")) {
      throw new Error("project.yml workflows are no longer supported; use project.spec or a Screen spec.");
    }

    const projectFilePaths = await this.loadProjectFilePaths();
    const materialPaths = projectFilePaths.filter((filePath) =>
      filePath.startsWith("materials/") && filePath.endsWith(this.templateFileExtension)
    );
    for (const filePath of materialPaths) {
      if (!/^materials\/[a-z][a-z0-9-]*\.stml$/.test(filePath)) {
        throw new Error(`${filePath}: Material STML files must be directly inside materials/.`);
      }
    }
    const assetFiles = new Map(projectFilePaths
      .filter((filePath) => /^(?:assets|screens\/[a-z][a-z0-9-]*\/assets)\//.test(filePath))
      .map((filePath) => {
        const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
        const type = extension === this.templateFileExtension
          ? "template"
          : [".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension)
            ? "image"
            : "resource";
        return [filePath, type];
      }));

    const [screens, loadedAssets, loadedMaterials, loadedTheme] = await Promise.all([
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
      Promise.all([...assetFiles]
        .filter(([, type]) => type === "template")
        .map(async ([templateFile]) => {
          const directory = templateFile.slice(0, templateFile.lastIndexOf("/"));
          const base = this.safeProjectUrl(`${directory}/`);
          const documentSource = await this.loadText(templateFile);
          const { header, body } = this.validation.splitAssetDocument(documentSource, templateFile);
          const data = await this.parseYamlSource(header, `${templateFile} front matter`);
          this.validation.validateAssetTemplateHeader(data, templateFile);
          const fileId = templateFile.slice(
            templateFile.lastIndexOf("/") + 1,
            -this.templateFileExtension.length
          );
          if (data.id !== fileId) {
            throw new Error(`Asset id must match the filename in ${templateFile}.`);
          }
          this.validation.assetCategoryPath(data, `${templateFile} front matter`);
          this.validation.validateAssetAttributes(data, `${templateFile} front matter`);
          this.validation.validateAssetSlots(data, `${templateFile} front matter`);
          this.validation.validateAssetSlotMarkup(data, body, templateFile);
          return {
            id: data.id,
            screen: templateFile.match(/^screens\/([^/]+)\/assets\//)?.[1] || null,
            base,
            data,
            templateFile,
            documentSource,
            yamlSource: header,
            yamlSourceMode: "source",
            yamlParseVersion: 0,
            yamlSerializeVersion: 0,
            html: body
          };
        })),
      Promise.all(materialPaths.map(async (filePath) => {
        const documentSource = await this.loadText(filePath);
        const { header, body } = this.validation.splitAssetDocument(documentSource, filePath);
        const data = await this.parseYamlSource(header, `${filePath} front matter`);
        this.validation.validateMaterialDocumentHeader(data, `${filePath} front matter`);
        const fileId = filePath.slice(
          filePath.lastIndexOf("/") + 1,
          -this.templateFileExtension.length
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
    const assetSpecOwners = new Map();
    for (const filePath of elementSpecPaths) {
      this.refreshAssetSpecOwner(filePath, specSources.get(filePath), screens, assetSpecOwners);
    }
    const assets = new Map(loadedAssets.map((asset) => [asset.id, asset]));
    if (assets.size !== loadedAssets.length) throw new Error("Discovered template ids must be unique.");

    return {
      project,
      projectFilePaths,
      assetFiles,
      materialFiles,
      screens,
      assets,
      specSources,
      assetSpecOwners,
      theme: loadedTheme.data,
      themeStylesheet: loadedTheme.stylesheet,
      themeStylesheetBase: loadedTheme.stylesheetBase
    };
  }

  async loadTheme(themePath) {
    const data = await this.loadYaml(themePath);
    this.validation.validateTheme(data, themePath);
    const themeDirectory = themePath.includes("/")
      ? themePath.slice(0, themePath.lastIndexOf("/") + 1)
      : "";
    const themeBase = themeDirectory ? this.safeProjectUrl(themeDirectory) : this.appRoot;
    if (data.styles === undefined) return { data, stylesheet: "", stylesheetBase: themeBase };
    if (typeof data.styles !== "string" || !data.styles) {
      throw new Error(`${themePath} styles must be a relative CSS file path.`);
    }
    const stylesDirectory = data.styles.includes("/")
      ? data.styles.slice(0, data.styles.lastIndexOf("/") + 1)
      : "";
    return {
      data,
      stylesheet: await this.loadText(data.styles, themeBase),
      stylesheetBase: stylesDirectory ? this.safeProjectUrl(stylesDirectory, themeBase) : themeBase
    };
  }
}
