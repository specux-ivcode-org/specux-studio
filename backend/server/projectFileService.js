const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const validation = require("../../shared/validation");
const { requestError } = require("./httpUtils");
const { isWithin } = require("../project/paths");

const MAX_FILES_PER_SAVE = 100;
const yamlModule = import("../../shared/yaml.mjs");

/** Rejects paths that are absolute, hidden, empty, or contain traversal segments. */
function isSafeSavePath(relativePath) {
  return typeof relativePath === "string" && Boolean(relativePath) &&
    !relativePath.includes("\\") && !relativePath.startsWith("/") &&
    !relativePath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || segment.startsWith(".")
    );
}

/** Provides isolated project-file listing, validation, and persistence. */
class ProjectFileService {
  /** Stores the project root managed by this service. */
  constructor({ projectRoot }) {
    this.projectRoot = projectRoot;
  }

  /** Recursively lists non-hidden regular files using project-relative paths. */
  async listFiles() {
    // Anchor traversal at the resolved project root and collect visible regular files.
    const realProjectRoot = await fs.realpath(this.projectRoot);
    const files = [];

    /** Walks a directory tree and appends regular files to the result. */
    async function visit(directory, relativeDirectory) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const relativePath = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath, relativePath);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    }

    await visit(realProjectRoot, "");

    // Sort the completed listing so callers receive stable results.

    // Produce stable locale-aware ordering for the file list.
    return files.sort((left, right) => left.localeCompare(right));
  }

  /** Reports whether a path passes the behavior-spec path validator. */
  #isSpecPath(relativePath) {
    try {
      validation.validateSpecPath(relativePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Reports whether a path passes the Screen workflow path validator. */
  #isWorkflowPath(relativePath) {
    try {
      validation.validateWorkflowPath(relativePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Accepts only the canonical YAML path for a named Screen. */
  #isScreenFilePath(relativePath) {
    return /^screens\/[a-z][a-z0-9-]*\/screen\.yml$/.test(relativePath);
  }

  /** Accepts only named STML files directly inside the project's materials directory. */
  #isMaterialFilePath(relativePath) {
    return /^materials\/[a-z][a-z0-9-]*\.stml$/.test(relativePath);
  }

  /** Resolves or creates a project directory while refusing symlinks and non-directories. */
  async #resolveDirectory(relativePath, { create = false } = {}) {
    // Resolve each segment from the real project root, creating only missing directories when allowed.
    const realProjectRoot = await fs.realpath(this.projectRoot);
    let current = realProjectRoot;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      let details;
      try {
        details = await fs.lstat(current);
      } catch (error) {
        if (error.code !== "ENOENT" || !create) throw error;
        await fs.mkdir(current);
        details = await fs.lstat(current);
      }

      // Disallow symlinks and non-directory path components throughout the traversal.
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw requestError("Project directories must be real directories inside the specux project.");
      }
    }

    // Confirm the resulting directory remains inside the project boundary.
    if (!isWithin(realProjectRoot, current)) {
      throw requestError("Project directory resolves outside the specux project.");
    }
    return current;
  }

  /** Parses YAML text and requires its root value to be a mapping. */
  async parseYaml(source) {
    if (typeof source !== "string") throw requestError("YAML source must be text.");

    // Parse the source and report parser issues with their coordinates.
    const YAML = await yamlModule;
    const document = YAML.parseDocument(source);
    if (document.errors.length) {
      // Format parser errors with their source coordinates when available.
      const issues = document.errors.map((error) => {
        const position = error.linePos?.[0];
        return position
          ? `line ${position.line}, column ${position.col}: ${error.message}`
          : error.message;
      });
      throw requestError(`Invalid YAML: ${issues.join("; ")}`);
    }

    // Require mapping data because project files are edited as YAML objects.
    const data = document.toJS();
    if (!data || Array.isArray(data) || typeof data !== "object") {
      throw requestError("YAML source must contain a mapping.");
    }
    return data;
  }

  /** Serializes a YAML mapping using the shared project YAML format. */
  async stringifyYaml(data) {
    const YAML = await yamlModule;
    return YAML.stringify(data);
  }

  /** Validates a save path and resolves an existing file or a permitted new-file target. */
  #classifySavePath(relativePath) {
    // Reject unsafe paths and unsupported extensions before selecting a save handler.
    if (!isSafeSavePath(relativePath)) {
      throw requestError("Save paths must be relative paths inside the specux project.");
    }
    const extension = path.extname(relativePath).toLowerCase();
    const specPath = this.#isSpecPath(relativePath);
    const workflowPath = this.#isWorkflowPath(relativePath);
    if (![".yml", ".yaml", validation.MATERIAL_FILE_EXTENSION].includes(extension) &&
        !(extension === ".md" && specPath) && !(extension === ".mmd" && workflowPath)) {
      throw requestError("The editor can only save project YAML, STML, behavior spec Markdown, and Screen workflow Mermaid files.");
    }

    // Apply the stricter filename rule for Material documents.
    if (extension === validation.MATERIAL_FILE_EXTENSION && !this.#isMaterialFilePath(relativePath)) {
      throw requestError("STML saves are only allowed as named files inside materials/.");
    }
    return {
      specPath,
      workflowPath,
      screenFile: this.#isScreenFilePath(relativePath),
      materialFile: this.#isMaterialFilePath(relativePath)
    };
  }

  /** Resolves a validated file path for either create or update operations. */
  async #resolveFile(relativePath, { create = false } = {}) {
    const fileType = this.#classifySavePath(relativePath);
    const target = path.resolve(this.projectRoot, ...relativePath.split("/"));
    if (!isWithin(this.projectRoot, target)) {
      throw requestError("Save path is outside the specux project.");
    }
    return create
      ? this.#resolveNewFile(relativePath, fileType)
      : this.#resolveExistingFile(relativePath, target);
  }

  /** Resolves a permitted new-file path after creating its parent directory. */
  async #resolveNewFile(relativePath, fileType) {
    if (!fileType.screenFile && !fileType.specPath && !fileType.materialFile && !fileType.workflowPath) {
      throw requestError("New files can only be created as named Screen YAML, Material STML, behavior spec Markdown, or Screen workflow Mermaid files.", 400);
    }
    const relativeDirectory = path.posix.dirname(relativePath);
    const realTargetDirectory = await this.#resolveDirectory(relativeDirectory, { create: true });
    const newTarget = path.join(realTargetDirectory, path.basename(relativePath));
    try {
      await fs.lstat(newTarget);
      throw requestError(`Project file "${relativePath}" already exists.`, 409);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return newTarget;
  }

  /** Resolves an existing regular file while checking symlink and project-root boundaries. */
  async #resolveExistingFile(relativePath, target) {
    let realTarget;
    try {
      realTarget = await fs.realpath(target);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw requestError(`Project file "${relativePath}" does not exist.`);
      }
      throw error;
    }
    if (!isWithin(this.projectRoot, realTarget)) {
      throw requestError("Save path resolves outside the specux project.");
    }
    const details = await fs.stat(realTarget);
    if (!details.isFile()) throw requestError(`Project path "${relativePath}" is not a file.`);
    return realTarget;
  }

  /** Validates a behavior spec save entry and returns its file update. */
  #prepareSpecSave(file, create) {
    if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
      throw requestError("Behavior spec Markdown save entries must contain text content.");
    }
    try {
      validation.validateSpecContent(file.content);
      const references = validation.parseSpecScreenReferences(file.content, file.path);
      if (/^screens\/[^/]+\/specs\/element-/.test(file.path)) {
        const identity = validation.getElementSpecIdentity(file.path);
        if (!identity) throw new Error("Element behavior spec path is invalid.");
        validation.validateElementSpecPath(file.path, identity.elementId);
        if (!references.some((reference) =>
          reference.screenId === identity.screenId &&
          reference.placementId === identity.elementId
        )) {
          throw new Error(
            `Element behavior specs must include a SpecUX Screen link to Element "${identity.elementId}".`
          );
        }
      }
    } catch (error) {
      throw requestError(`${file.path}: ${error.message || String(error)}`);
    }
    return { path: file.path, content: file.content, create };
  }

  /** Validates a Screen workflow Mermaid save entry and returns its file update. */
  #prepareWorkflowSave(file, create) {
    if (!this.#isWorkflowPath(file.path) || typeof file.content !== "string" ||
        Object.hasOwn(file, "data")) {
      throw requestError("Screen workflow Mermaid save entries must contain text content at a valid Screen workflow path.");
    }
    return { path: file.path, content: file.content, create };
  }

  /** Validates a Material STML save entry and returns its file update. */
  async #prepareMaterialSave(file, create) {
    if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
      throw requestError("Material STML save entries must contain text content.");
    }

    // Validate the Material header, filename identity, body markup, and attribute references.
    try {
      const { header, body } = validation.splitMaterialDocument(file.content, file.path);
      const materialDocument = await this.parseYaml(header);
      validation.validateMaterialDocumentHeader(materialDocument, file.path);
      const expectedId = path.posix.basename(file.path, validation.MATERIAL_FILE_EXTENSION);
      if (materialDocument.id !== expectedId) {
        throw new Error(`front matter id must match Material file name "${expectedId}${validation.MATERIAL_FILE_EXTENSION}".`);
      }
      validation.validateMaterialMarkup(body, file.path);
      validation.validateMaterialAttributeMarkup(materialDocument, body, file.path);
    } catch (error) {
      throw requestError(`${file.path}: ${error.message || String(error)}`);
    }
    return { path: file.path, content: file.content, create };
  }

  /** Validates a YAML save entry and returns its serialized file update. */
  async #prepareYamlSave(file, create, YAML) {
    // Preserve valid YAML text when supplied, otherwise serialize the provided mapping.
    if (typeof file.content === "string" && !Object.hasOwn(file, "data")) {
      await this.parseYaml(file.content);
      return { path: file.path, content: file.content, create };
    }
    if (!Object.hasOwn(file, "data") || !file.data ||
        Array.isArray(file.data) || typeof file.data !== "object" ||
        Object.hasOwn(file, "content")) {
      throw requestError("YAML save entries must contain a mapping of data.");
    }
    return { path: file.path, content: YAML.stringify(file.data), create };
  }

  /** Validates save entry identity, flags, and duplicate paths before content parsing. */
  #validateSaveEntry(file, seen) {
    if (!file || Array.isArray(file) || typeof file !== "object" || typeof file.path !== "string") {
      throw requestError("Each save entry must specify a project file path.");
    }
    if (Object.hasOwn(file, "create") && typeof file.create !== "boolean") {
      throw requestError("Save entry create flags must be booleans.");
    }
    if (seen.has(file.path)) throw requestError(`Save request contains "${file.path}" more than once.`);
    seen.add(file.path);
    return file.create === true;
  }

  /** Validates the shape and selects the file-specific save preparation method. */
  async #prepareSaveEntry(file, seen, YAML) {
    // Validate common entry metadata before dispatching to the format-specific parser.
    const create = this.#validateSaveEntry(file, seen);
    const extension = path.extname(file.path).toLowerCase();
    if (extension === ".md") return this.#prepareSpecSave(file, create);
    if (extension === ".mmd") return this.#prepareWorkflowSave(file, create);
    if (extension === validation.MATERIAL_FILE_EXTENSION && this.#isMaterialFilePath(file.path)) {
      return this.#prepareMaterialSave(file, create);
    }
    return this.#prepareYamlSave(file, create, YAML);
  }

  /** Resolves all save destinations before preparing a transactional write. */
  async #resolveUpdateTargets(updates) {
    for (const update of updates) {
      update.target = await this.#resolveFile(update.path, { create: update.create });
    }
  }

  /** Writes unique temporary files for a batch before any target is modified. */
  async #stageUpdates(updates, staged) {
    for (const update of updates) {
      const temporaryPath = path.join(
        path.dirname(update.target),
        `.${path.basename(update.target)}.${randomUUID()}.tmp`
      );
      await fs.writeFile(temporaryPath, update.content, { encoding: "utf8", flag: "wx" });
      staged.push({ ...update, temporaryPath });
    }
  }

  /** Creates a new target without overwriting a file created concurrently. */
  async #commitNewFile(update) {
    try {
      await fs.link(update.temporaryPath, update.target);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw requestError(`Project file "${update.path}" already exists.`, 409);
      }
      throw error;
    }
    await fs.rm(update.temporaryPath, { force: true });
  }

  /** Atomically moves staged content into its existing or newly created target. */
  async #commitUpdates(staged) {
    for (const update of staged) {
      if (update.create) {
        await this.#commitNewFile(update);
      } else {
        await fs.rename(update.temporaryPath, update.target);
      }
    }
  }

  /** Removes temporary files left by a failed batch save. */
  async #removeStagedFiles(staged) {
    await Promise.all(staged.map(({ temporaryPath }) =>
      fs.rm(temporaryPath, { force: true })
    ));
  }

  /** Persists a save batch through temporary files and cleans up on failure. */
  async #persistUpdates(updates) {
    // Resolve every destination, stage all content, and only then commit the batch.
    let staged = [];
    try {
      await this.#resolveUpdateTargets(updates);
      await this.#stageUpdates(updates, staged);
      await this.#commitUpdates(staged);
    } catch (error) {
      await this.#removeStagedFiles(staged);
      throw error;
    }
  }

  /** Validates and atomically saves a batch of YAML, STML, behavior-spec, or workflow files. */
  async saveFiles(files) {
    // Enforce batch limits before parsing any individual update.
    const YAML = await yamlModule;
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_SAVE) {
      throw requestError(`Save requests must contain between 1 and ${MAX_FILES_PER_SAVE} files.`);
    }
    const seen = new Set();
    const updates = [];

    // Validate and prepare every requested file before writing anything.
    for (const file of files) {
      updates.push(await this.#prepareSaveEntry(file, seen, YAML));
    }

    // Persist the prepared batch transactionally and return its project-relative paths.
    await this.#persistUpdates(updates);

    // Return the project-relative path of each successfully saved file.
    return { saved: updates.map(({ path: filePath }) => filePath) };
  }


}

/** Preserves the existing saveProjectFiles API through the project-file service. */
function saveProjectFiles(projectRoot, files) {
  return new ProjectFileService({ projectRoot }).saveFiles(files);
}

module.exports = { ProjectFileService, saveProjectFiles };
