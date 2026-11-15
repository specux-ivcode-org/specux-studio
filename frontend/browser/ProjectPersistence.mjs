import { getScreenPlacementIdPath } from "../../shared/ScreenGroups.mjs";

/** Tracks project edits and saves validated file changes. */
export class ProjectPersistence {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.autosaveDelay = services.autosaveDelay ?? 500;
    this.autosaveMaxWait = services.autosaveMaxWait ?? 2000;
    this.setTimeout = services.setTimeout || globalThis.setTimeout.bind(globalThis);
    this.clearTimeout = services.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    this.now = services.now || Date.now;
    this.autosaveTimer = null;
    this.pendingSince = null;
    this.status = { state: "saved", message: "Saved" };
    this.historySnapshot = null;
    this.undoStack = [];
    this.redoStack = [];
    this.historyGroup = null;
    this.activeHistoryTransaction = null;
    this.historyTimer = null;
    this.historyDelay = services.historyDelay ?? 800;
  }

  /** Starts a clean project-level history after the project and recovery drafts load. */
  initializeEditHistory() {
    this.resetEditHistory();
    this.historySnapshot = this.services.captureEditSnapshot();
    this.updateHistoryControls();
  }

  /** Clears history state when switching projects. */
  resetEditHistory() {
    this.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.historySnapshot = null;
    this.undoStack = [];
    this.redoStack = [];
    this.historyGroup = null;
    this.activeHistoryTransaction = null;
    this.updateHistoryControls();
  }

  /** Begins one multi-artifact edit transaction before any of its models are changed. */
  beginEditTransaction() {
    if (this.activeHistoryTransaction) {
      this.activeHistoryTransaction.depth += 1;
      return;
    }
    this.closeEditHistoryGroup();
    this.activeHistoryTransaction = {
      before: this.historySnapshot,
      after: this.historySnapshot,
      depth: 1
    };
  }

  /** Commits a multi-artifact edit as one transaction when its outer action ends. */
  endEditTransaction() {
    if (!this.activeHistoryTransaction) {
      throw new Error("No project edit transaction is active.");
    }
    this.activeHistoryTransaction.depth -= 1;
    if (this.activeHistoryTransaction.depth > 0) return;
    const transaction = this.activeHistoryTransaction;
    this.activeHistoryTransaction = null;
    const after = this.services.captureEditSnapshot();
    if (JSON.stringify(transaction.before) !== JSON.stringify(after)) {
      this.undoStack.push({ before: transaction.before, after });
      this.historySnapshot = after;
      this.redoStack = [];
    }
    this.updateHistoryControls();
  }

  /** Closes the current typing group at an editor focus or action boundary. */
  closeEditHistoryGroup() {
    this.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.historyGroup = null;
  }

  /** Records the current artifact snapshot, coalescing only continuous same-editor typing. */
  recordEditHistory(filePath, options = {}) {
    if (!this.historySnapshot || !this.services.captureEditSnapshot) return;
    const nextSnapshot = this.services.captureEditSnapshot();
    if (JSON.stringify(this.historySnapshot) === JSON.stringify(nextSnapshot)) return;
    if (this.activeHistoryTransaction) {
      this.activeHistoryTransaction.after = nextSnapshot;
      this.historySnapshot = nextSnapshot;
      this.redoStack = [];
      return;
    }
    const now = this.now();
    if (options.coalesce && this.historyGroup?.key === filePath &&
        now - this.historyGroup.updatedAt <= this.historyDelay) {
      this.historyGroup.after = nextSnapshot;
      this.historyGroup.updatedAt = now;
    } else {
      this.closeEditHistoryGroup();
      const transaction = {
        before: this.historySnapshot,
        after: nextSnapshot,
        ...(options.coalesce ? { key: filePath, updatedAt: now } : {})
      };
      this.undoStack.push(transaction);
      this.historyGroup = options.coalesce ? transaction : null;
    }
    this.historySnapshot = nextSnapshot;
    this.redoStack = [];
    if (this.historyGroup) {
      this.clearTimeout(this.historyTimer);
      this.historyTimer = this.setTimeout(() => this.closeEditHistoryGroup(), this.historyDelay);
    }
    this.updateHistoryControls();
  }

  /** Reflects available history actions in the toolbar. */
  updateHistoryControls() {
    const undo = this.services.byId("undo-project-edit");
    const redo = this.services.byId("redo-project-edit");
    const conflicts = this.state.externalWriteConflicts?.size > 0;
    if (undo) undo.disabled = conflicts || this.undoStack.length === 0;
    if (redo) redo.disabled = conflicts || this.redoStack.length === 0;
  }

  /** Undoes the most recent artifact transaction without changing editor navigation. */
  async undo() {
    const transaction = this.undoStack[this.undoStack.length - 1];
    if (!transaction || this.state.externalWriteConflicts?.size > 0) return;
    this.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.historyGroup = null;
    await this.applyHistorySnapshot(transaction.before, transaction.after);
    this.undoStack.pop();
    this.redoStack.push(transaction);
    this.historySnapshot = transaction.before;
    this.updateHistoryControls();
  }

  /** Redoes the most recently undone artifact transaction. */
  async redo() {
    const transaction = this.redoStack[this.redoStack.length - 1];
    if (!transaction || this.state.externalWriteConflicts?.size > 0) return;
    this.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.historyGroup = null;
    await this.applyHistorySnapshot(transaction.after, transaction.before);
    this.redoStack.pop();
    this.undoStack.push(transaction);
    this.historySnapshot = transaction.after;
    this.updateHistoryControls();
  }

  /** Restores one artifact snapshot and marks changed files for guarded autosave. */
  async applyHistorySnapshot(target, current) {
    await this.services.applyEditSnapshot(target);
    const paths = new Set([
      ...Object.keys(target.files),
      ...Object.keys(current.files)
    ]);
    for (const filePath of paths) {
      if (JSON.stringify(target.files[filePath]) === JSON.stringify(current.files[filePath])) continue;
      const version = ++this.state.editVersion;
      if (target.files[filePath] === undefined) {
        if (this.state.fileHashes?.has(filePath)) {
          this.state.deletedFiles.set(filePath, version);
          this.state.dirtyFiles.set(filePath, version);
        } else {
          this.state.deletedFiles.delete(filePath);
          this.state.dirtyFiles.delete(filePath);
          this.setCreatedFileMode(filePath, false);
        }
      } else {
        this.state.deletedFiles.delete(filePath);
        if (!this.state.fileHashes?.has(filePath)) this.setCreatedFileMode(filePath, true);
        this.state.dirtyFiles.set(filePath, version);
      }
      const recoveryDraft = this.services.getRecoveryDraft?.(filePath);
      if (recoveryDraft) {
        this.saveRecoveryDraft(
          filePath,
          recoveryDraft.content,
          recoveryDraft.message,
          recoveryDraft.type
        );
      } else {
        const cleanupError = this.clearRecoveryDraft(filePath);
        if (cleanupError) {
          this.setPersistenceStatus(
            "error",
            `A recovery draft could not be cleared: ${cleanupError}`
          );
          this.services.showEditorMessage("Could not clear recovery draft", cleanupError);
        }
      }
    }
    this.state.hasEdits = this.state.dirtyFiles.size > 0;
    this.setPersistenceStatus(this.state.hasEdits ? "pending" : "saved",
      this.state.hasEdits ? "Pending changes" : "Saved");
    this.updateSaveControls();
    if (this.state.hasEdits) this.scheduleAutosave(true);
  }

  /** Records a changed file and updates the unsaved-edit indicators. */
  markEdited(filePath, options = {}) {
    const { state } = this;
    if (typeof filePath !== "string" || !filePath) {
      throw new Error("Edited project data must be associated with its source file.");
    }
    const screen = state.screens.find((entry) => entry.file === filePath);
    if (screen) {
      screen.yamlSerializeVersion += 1;
      if (options.yamlSource) screen.yamlSourceMode = "source";
      else if (!state.invalidYamlFiles.has(filePath)) screen.yamlSourceMode = "data";
    }
    this.recordEditHistory(filePath, options);
    state.dirtyFiles.set(filePath, ++state.editVersion);
    state.hasEdits = true;
    this.setPersistenceStatus("pending", "Pending changes");
    this.updateSaveControls();
    this.scheduleAutosave();
  }

  /** Clears the edited and resets its associated state. */
  clearEdited(filePath) {
    if (!this.state.dirtyFiles.delete(filePath)) return;
    this.state.hasEdits = this.state.dirtyFiles.size > 0;
    if (!this.state.hasEdits) this.setPersistenceStatus("saved", "Saved");
    this.updateSaveControls();
  }

  /** Records an artifact deletion as an undoable project edit. */
  markDeleted(filePath) {
    if (this.state.fileHashes?.has(filePath)) {
      const version = ++this.state.editVersion;
      this.state.deletedFiles.set(filePath, version);
      this.state.dirtyFiles.set(filePath, version);
      this.state.hasEdits = true;
      this.setPersistenceStatus("pending", "Pending changes");
      this.scheduleAutosave();
    } else {
      this.state.deletedFiles.delete(filePath);
      this.state.dirtyFiles.delete(filePath);
      this.setCreatedFileMode(filePath, false);
      this.state.hasEdits = this.state.dirtyFiles.size > 0;
    }
    this.recordEditHistory(filePath);
    this.updateSaveControls();
  }

  /** Updates the autosave status indicator and project history controls. */
  updateSaveControls() {
    this.updateAutosaveIndicator();
    this.updateHistoryControls();
    this.resumeAutosaveAfterValidation();
  }

  /** Displays persistence state without a manual Save control or status text. */
  updateAutosaveIndicator() {
    const indicator = this.services.byId("autosave-status");
    if (!indicator) return;
    const labels = {
      saved: "All changes saved",
      pending: "Changes queued for autosave",
      saving: "Saving changes",
      error: `Autosave needs attention: ${this.status.message}`
    };
    const label = labels[this.status.state] || this.status.message;
    indicator.dataset.state = this.status.state;
    indicator.setAttribute("aria-label", label);
    indicator.setAttribute("aria-busy", String(
      this.status.state === "pending" || this.status.state === "saving"
    ));
    indicator.title = label;
    indicator.textContent = "";
  }

  /** Resumes pending autosave after an invalid source has been corrected. */
  resumeAutosaveAfterValidation() {
    const { state } = this;
    if (this.status.state !== "error" ||
        this.status.message !== "Fix invalid source before saving" ||
        state.invalidYamlFiles.size > 0 ||
        state.invalidWorkflowFiles.size > 0 ||
        state.dirtyFiles.size === 0) return;
    this.setPersistenceStatus("pending", "Pending changes");
    this.scheduleAutosave();
  }

  /** Schedules a serialized autosave with a bounded wait during continuous edits. */
  scheduleAutosave(immediate = false) {
    if (this.state.dirtyFiles.size === 0) return;
    if (this.state.externalWriteConflicts?.size > 0) {
      this.setPersistenceStatus("error", "External file changes need review");
      return;
    }
    if (this.state.invalidYamlFiles.size > 0 || this.state.invalidWorkflowFiles.size > 0) {
      this.setPersistenceStatus("error", "Fix invalid source before saving");
      this.updateSaveControls();
      return;
    }
    if (this.pendingSince === null) this.pendingSince = this.now();
    this.clearTimeout(this.autosaveTimer);
    const remaining = Math.max(0, this.autosaveMaxWait - (this.now() - this.pendingSince));
    const delay = immediate ? 0 : Math.min(this.autosaveDelay, remaining);
    this.autosaveTimer = this.setTimeout(() => {
      this.autosaveTimer = null;
      this.pendingSince = null;
      this.save({ automatic: true }).catch((error) => {
        this.setPersistenceStatus("error", `Save failed: ${error.message || String(error)}`);
        this.services.showEditorMessage("Could not save changes", error.message || String(error));
      });
    }, delay);
  }

  /** Updates the persistence status exposed by the autosave indicator. */
  setPersistenceStatus(state, message) {
    this.status = { state, message };
    this.updateAutosaveIndicator();
  }

  /** Cancels scheduled saves and resets the status for a newly loaded project. */
  resetAutosave() {
    this.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.pendingSince = null;
    this.setPersistenceStatus("saved", "Saved");
    this.updateSaveControls();
  }

  /** Returns the project file data. */
  getProjectFileData(filePath) {
    const { project, screens, materialFiles, theme } = this.state;
    if (filePath === "project.yml") return project;
    const screen = screens.find((entry) => entry.file === filePath);
    if (screen) return screen.data;
    const material = materialFiles?.get(filePath);
    if (material) return material.data;
    if (project.theme === filePath) return theme;
    throw new Error(`Edited project file "${filePath}" is not available to save.`);
  }

  /** Returns the project file save entry. */
  getProjectFileSaveEntry(filePath) {
    const { state } = this;
    const material = state.materialFiles?.get(filePath);
    if (material) {
      return {
        path: filePath,
        ...(state.createdMaterialFiles?.has(filePath) ? { create: true } : {}),
        content: material.documentSource
      };
    }
    if (state.specSources.has(filePath)) {
      return {
        path: filePath,
        ...(state.createdSpecFiles.has(filePath) ? { create: true } : {}),
        content: state.specSources.get(filePath)
      };
    }
    if (state.workflowSources.has(filePath)) {
      return {
        path: filePath,
        ...(state.createdWorkflowFiles?.has(filePath) ? { create: true } : {}),
        content: state.workflowSources.get(filePath)
      };
    }
    const screen = state.screens.find((entry) => entry.file === filePath);
    if (screen?.yamlSourceMode === "source") {
      return {
        path: filePath,
        ...(state.createdScreenFiles.has(filePath) ? { create: true } : {}),
        content: screen.yamlSource
      };
    }
    if (state.createdScreenFiles.has(filePath)) {
      return {
        path: filePath,
        create: true,
        data: JSON.parse(JSON.stringify(this.getProjectFileData(filePath)))
      };
    }
    return {
      path: filePath,
      data: JSON.parse(JSON.stringify(this.getProjectFileData(filePath)))
    };
  }

  /** Updates the created spec draft to reflect the latest editor state. */
  updateCreatedSpecDraft(filePath, draft) {
    const { state, services } = this;
    if (state.specSources.get(filePath) === draft.initialContent) return;
    if (draft.owner === "project") {
      state.project.spec = filePath;
      state.createdSpecFiles.add(filePath);
      return;
    }
    if (draft.owner === "workflow-node") {
      state.createdSpecFiles.add(filePath);
      return;
    }
    const screen = state.screens.find((entry) => entry.file === draft.screenFile);
    if (draft.owner === "screen" && screen) {
      screen.data.spec = filePath;
      state.createdSpecFiles.add(filePath);
      return;
    }
    const instance = screen && services.getInstanceAtPath(screen, draft.instancePath);
    if (instance) {
      state.createdSpecFiles.add(filePath);
      return;
    }
    state.createdSpecDrafts.delete(filePath);
    state.createdSpecFiles.delete(filePath);
    state.specSources.delete(filePath);
    state.elementSpecOwners.delete(filePath);
    this.clearEdited(filePath);
  }

  /** Updates the created spec drafts to reflect the latest editor state. */
  updateCreatedSpecDrafts() {
    for (const [filePath, draft] of this.state.createdSpecDrafts) {
      this.updateCreatedSpecDraft(filePath, draft);
    }
  }

  /** Validates the spec source references before it is applied or saved. */
  validateSpecSourceReferences() {
    const { state, services } = this;
    for (const [specPath, content] of state.specSources) {
      try {
        services.validation.validateSpecScreenReferences(content, state.screens, specPath);
      } catch (error) {
        services.showEditorMessage("Could not save changes", error.message || String(error));
        return false;
      }
    }
    return true;
  }

  /** Validates the element spec for screen before it is applied or saved. */
  validateElementSpecForScreen(screen, specPath, content, linkedSpecPaths, linkedElementIds) {
    const { state, services } = this;
    const identity = services.validation.getElementSpecIdentity(specPath);
    if (!identity || identity.screenId !== screen.id) {
      throw new Error(`${specPath} is not a valid Element spec path for Screen "${screen.id}".`);
    }
    const { elementId } = identity;
    services.validation.validateElementSpecPath(specPath, elementId);
    const references = services.validation.parseSpecScreenReferences(content, specPath);
    const instancePath = services.findInstancePathById(screen.data.materials || [], elementId);
    if (!instancePath) throw new Error(`${specPath} links to unavailable Element "${elementId}".`);
    const placementIdPath = getScreenPlacementIdPath(screen.data.materials || [], instancePath)?.join(".");
    if (!placementIdPath) throw new Error(`${specPath} links to unavailable Element "${elementId}".`);
    const linksToElement = references.some((reference) =>
      reference.screenId === screen.id &&
      [elementId, placementIdPath].includes(reference.placementId)
    );
    if (!linksToElement) {
      throw new Error(
        `${specPath} must include a SpecUX Screen link to its Element "${elementId}".`
      );
    }
    if (linkedElementIds.has(elementId)) {
      throw new Error(`${specPath}: Element "${elementId}" has more than one behavior spec.`);
    }
    linkedElementIds.add(elementId);
    state.elementSpecOwners.set(specPath, { screenFile: screen.file, elementId, instancePath });
    linkedSpecPaths.add(specPath);
  }

  /** Validates the screen for save before it is applied or saved. */
  validateScreenForSave(screen) {
    const { state, services } = this;
    services.validateScreenMaterials(screen);
    const states = services.validation.validatePreviewStates(screen.data, screen.file);
    const linkedSpecPaths = new Set();
    if (screen.data.spec) {
      services.validation.validateSpecPath(screen.data.spec);
      linkedSpecPaths.add(screen.data.spec);
    }
    const elementSpecPrefix = `screens/${screen.id}/specs/element-`;
    const linkedElementIds = new Set();
    for (const [specPath, content] of state.specSources) {
      if (!specPath.startsWith(elementSpecPrefix)) continue;
      this.validateElementSpecForScreen(
        screen,
        specPath,
        content,
        linkedSpecPaths,
        linkedElementIds
      );
    }
    const linkedSpecs = [];
    for (const specPath of linkedSpecPaths) {
      const content = state.specSources.get(specPath);
      if (content === undefined) {
        throw new Error(`${screen.file}: linked behavior spec "${specPath}" is not loaded.`);
      }
      services.validation.validateSpecContent(content);
      linkedSpecs.push({ path: specPath, content });
    }
    services.validation.validateScreenSpecStateReferences(linkedSpecs, states, screen.file);
  }

  /** Validates the screens for save before it is applied or saved. */
  validateScreensForSave() {
    const { state, services } = this;
    for (const screen of state.screens) {
      try {
        this.validateScreenForSave(screen);
      } catch (error) {
        services.showEditorMessage("Could not save changes", error.message || String(error));
        return false;
      }
    }
    return true;
  }

  /** Builds the file entries required to persist the current dirty project data. */
  createSaveEntries() {
    const { state } = this;
    const saveEntries = new Map([...state.dirtyFiles]
      .filter(([filePath]) => !state.deletedFiles?.has(filePath))
      .map(([filePath, version]) => [
      filePath,
      this.createVersionedSaveEntry(filePath, version)
    ]));
    for (const [filePath, draft] of state.createdSpecDrafts) {
      if (draft.owner === "instance" || draft.owner === "workflow-node") continue;
      const linkFile = draft.owner === "project" ? "project.yml" : draft.screenFile;
      if (state.specSources.get(filePath) === draft.initialContent || saveEntries.has(linkFile)) continue;
      saveEntries.set(linkFile, {
        version: state.dirtyFiles.get(linkFile) ?? null,
        ...this.getProjectFileSaveEntry(linkFile),
        ...(state.fileHashes?.has(linkFile)
          ? { expectedHash: state.fileHashes.get(linkFile) }
          : {})
      });
    }
    return saveEntries;
  }

  /** Adds the current disk version to an entry when it is available. */
  createVersionedSaveEntry(filePath, version) {
    const entry = this.getProjectFileSaveEntry(filePath);
    return {
      version,
      ...entry,
      ...(entry.create
        ? { expectedHash: null }
        : this.state.fileHashes?.has(filePath)
          ? { expectedHash: this.state.fileHashes.get(filePath) }
          : {})
    };
  }

  /** Copies file contents and versions so an in-flight save has a stable input. */
  createSaveSnapshot(saveEntries) {

    /** Persists the priority to the project. */
    const savePriority = (file) => file.create && file.path.endsWith(".md")
      ? 0
      : file.create ? 1 : 2;
    return [...saveEntries.values()].sort((left, right) =>
      savePriority(left) - savePriority(right)
    );
  }

  /** Copies persisted deletion requests and versions for the same autosave batch. */
  createDeleteSnapshot() {
    return [...(this.state.deletedFiles || new Map())].map(([filePath, version]) => ({
      path: filePath,
      version,
      expectedHash: this.state.fileHashes.get(filePath)
    }));
  }

  /** Sets the saving ui from the supplied data. */
  setSavingUi(isSaving) {
    this.state.isSaving = isSaving;
    if (isSaving) this.setPersistenceStatus("saving", "Saving changes");
    this.services.byId("spec-source").disabled = isSaving;
    this.updateSaveControls();
  }

  /** Reconciles saved file versions with the current dirty-file state. */
  updateSavedFile(file) {
    const { state, services } = this;
    let recoveryCleanupError = null;
    if (file.create) {
      state.createdScreenFiles.delete(file.path);
      state.createdMaterialFiles?.delete(file.path);
      state.createdSpecFiles.delete(file.path);
      state.createdWorkflowFiles?.delete(file.path);
    }
    if (file.create && state.createdSpecDrafts.has(file.path)) {
      const draft = state.createdSpecDrafts.get(file.path);
      if (draft.owner === "project") {
        state.project.spec = file.path;
      } else {
        const screen = state.screens.find((entry) => entry.file === draft.screenFile);
        if (draft.owner === "screen" && screen) screen.data.spec = file.path;
      }
      state.createdSpecDrafts.delete(file.path);
    }
    const savedCurrentVersion = state.dirtyFiles.get(file.path) === file.version;
    if (savedCurrentVersion) {
      state.dirtyFiles.delete(file.path);
      recoveryCleanupError = this.clearRecoveryDraft(file.path);
    }
    const savedScreen = state.screens.find((entry) => entry.file === file.path);
    if (savedScreen && savedCurrentVersion) services.setScreenYamlStatus(savedScreen, "Saved.");
    return recoveryCleanupError;
  }

  /** Clears only saved versions of dirty files and refreshes save controls. */
  finishSuccessfulSave(snapshot, result, announce = true) {
    if (Array.isArray(snapshot)) snapshot = { files: snapshot, deletes: [] };
    const { state, services } = this;
    const recoveryCleanupErrors = snapshot.files
      .map((file) => this.updateSavedFile(file))
      .filter(Boolean);
    const updatedFilePaths = new Set(state.projectFilePaths);
    for (const file of snapshot.files) updatedFilePaths.add(file.path);
    for (const file of snapshot.deletes) {
      if (state.deletedFiles?.get(file.path) !== file.version) continue;
      state.deletedFiles.delete(file.path);
      state.dirtyFiles.delete(file.path);
      state.fileHashes?.delete(file.path);
      updatedFilePaths.delete(file.path);
    }
    state.projectFilePaths = [...updatedFilePaths];
    for (const [filePath, hash] of Object.entries(result.hashes || {})) {
      state.fileHashes?.set(filePath, hash);
    }
    const currentFiles = this.services.captureEditSnapshot?.().files;
    if (currentFiles) {
      for (const file of snapshot.files) {
        if (!file.create || currentFiles[file.path] !== undefined ||
            state.dirtyFiles.has(file.path)) continue;
        const version = ++state.editVersion;
        state.deletedFiles?.set(file.path, version);
        state.dirtyFiles.set(file.path, version);
      }
    }
    for (const file of snapshot.deletes) {
      if (!(result.deleted || []).includes(file.path)) continue;
      state.fileHashes?.delete(file.path);
      if (currentFiles?.[file.path] === undefined) {
        state.deletedFiles?.delete(file.path);
        state.dirtyFiles.delete(file.path);
      } else {
        const version = state.dirtyFiles.get(file.path);
        if (version !== undefined) {
          this.setCreatedFileMode(file.path, true);
          state.deletedFiles?.delete(file.path);
        }
      }
      updatedFilePaths.delete(file.path);
    }
    state.projectFilePaths = [...updatedFilePaths];
    state.hasEdits = state.dirtyFiles.size > 0;
    const completionStatus = this.getSaveCompletionStatus(recoveryCleanupErrors);
    this.setPersistenceStatus(completionStatus.state, completionStatus.message);
    services.renderNavigation();
    this.updateSaveControls();
    if (!state.hasEdits && announce) {
      const savedCount = result.saved.length + (result.deleted?.length || 0);
      services.showEditorMessage(
        "Changes saved",
        `${savedCount} project file${savedCount === 1 ? "" : "s"} updated in specux/.`
      );
    }
  }

  /** Describes save completion without hiding recovery-draft cleanup failures. */
  getSaveCompletionStatus(recoveryCleanupErrors) {
    if (recoveryCleanupErrors.length) {
      return {
        state: "error",
        message: `Saved, but a recovery draft could not be cleared: ${recoveryCleanupErrors.join("; ")}`
      };
    }
    return this.state.hasEdits
      ? { state: "pending", message: "Pending changes" }
      : { state: "saved", message: "Saved" };
  }

  /** Stores an invalid source draft separately from the last valid project file. */
  saveRecoveryDraft(filePath, content, message, type) {
    const storage = this.services.recoveryStorage;
    if (!storage || typeof content !== "string") {
      throw new Error("Recovery draft storage is unavailable.");
    }
    try {
      const drafts = this.readRecoveryDrafts();
      drafts[filePath] = { content, message, type };
      storage.setItem(this.services.recoveryStorageKey, JSON.stringify(drafts));
    } catch (error) {
      const detail = error.message || String(error);
      this.setPersistenceStatus("error", `Invalid source is not recoverable: ${detail}`);
      this.services.showEditorMessage("Could not preserve invalid source", detail);
    }
  }

  /** Restores invalid source drafts after their valid project files are loaded. */
  restoreRecoveryDrafts() {
    let drafts;
    try {
      drafts = this.readRecoveryDrafts();
    } catch (error) {
      const detail = error.message || String(error);
      this.setPersistenceStatus("error", `Could not restore an invalid-source draft: ${detail}`);
      this.services.showEditorMessage("Could not restore invalid source", detail);
      return;
    }
    for (const [filePath, draft] of Object.entries(drafts)) {
      if (draft.type === "screen") {
        const screen = this.state.screens.find((entry) => entry.file === filePath);
        if (!screen) continue;
        screen.yamlSource = draft.content;
        screen.yamlSourceMode = "source";
        this.state.invalidYamlFiles.set(filePath, draft.message);
      } else if (draft.type === "material") {
        const material = this.state.materialFiles.get(filePath);
        if (!material) continue;
        material.documentSource = draft.content;
        this.state.invalidYamlFiles.set(filePath, draft.message);
      } else if (draft.type === "workflow" && this.state.workflowSources.has(filePath)) {
        this.state.workflowSources.set(filePath, draft.content);
        this.state.invalidWorkflowFiles.set(filePath, draft.message);
      } else {
        continue;
      }
      this.markEdited(filePath, { yamlSource: draft.type === "screen" });
    }
    this.updateSaveControls();
  }

  /** Reads and validates drafts scoped to the current project. */
  readRecoveryDrafts() {
    const storage = this.services.recoveryStorage;
    if (!storage) return {};
    const serialized = storage.getItem(this.services.recoveryStorageKey);
    if (!serialized) return {};
    const drafts = JSON.parse(serialized);
    if (!drafts || Array.isArray(drafts) || typeof drafts !== "object" ||
        Object.entries(drafts).some(([, draft]) =>
          !draft || Array.isArray(draft) || typeof draft !== "object" ||
          typeof draft.content !== "string" || typeof draft.message !== "string" ||
          !["screen", "material", "workflow"].includes(draft.type)
        )) {
      throw new Error("Stored recovery drafts are invalid.");
    }
    return drafts;
  }

  /** Removes a recovery draft after the corresponding valid file is saved. */
  clearRecoveryDraft(filePath) {
    const storage = this.services.recoveryStorage;
    if (!storage) return null;
    try {
      const drafts = this.readRecoveryDrafts();
      if (!Object.hasOwn(drafts, filePath)) return null;
      delete drafts[filePath];
      if (Object.keys(drafts).length) {
        storage.setItem(this.services.recoveryStorageKey, JSON.stringify(drafts));
      } else {
        storage.removeItem(this.services.recoveryStorageKey);
      }
      return null;
    } catch (error) {
      return error.message || String(error);
    }
  }

  /** Preserves local and external versions when a save detects an external write. */
  recordExternalWriteConflicts(snapshot, conflicts, deleteSnapshot = []) {
    const snapshotByPath = new Map(snapshot.map((file) => [file.path, file]));
    const deletionsByPath = new Set(deleteSnapshot.map((file) => file.path));
    for (const conflict of conflicts) {
      const localFile = snapshotByPath.get(conflict.path);
      this.state.externalWriteConflicts.set(conflict.path, {
        ...conflict,
        localDeleted: deletionsByPath.has(conflict.path),
        localContent: deletionsByPath.has(conflict.path)
          ? null
          : typeof localFile?.content === "string"
          ? localFile.content
          : JSON.stringify(localFile?.data ?? null, null, 2)
      });
    }
    this.persistExternalWriteConflicts();
    this.setPersistenceStatus("error", "External file changes need review");
    this.services.showExternalWriteConflicts?.(
      [...this.state.externalWriteConflicts.values()]
    );
  }

  /** Stores outstanding external-write conflicts for recovery after a reload. */
  persistExternalWriteConflicts() {
    const { externalConflictStorage, externalConflictStorageKey } = this.services;
    if (!externalConflictStorage) return;
    try {
      const conflicts = Object.fromEntries(this.state.externalWriteConflicts);
      if (Object.keys(conflicts).length) {
        externalConflictStorage.setItem(externalConflictStorageKey, JSON.stringify(conflicts));
      } else {
        externalConflictStorage.removeItem(externalConflictStorageKey);
      }
    } catch (error) {
      const detail = error.message || String(error);
      this.setPersistenceStatus("error", `External versions could not be preserved: ${detail}`);
      this.services.showEditorMessage("Could not preserve external changes", detail);
    }
  }

  /** Restores unresolved external-write choices when reopening a project. */
  async restoreExternalWriteConflicts() {
    const { externalConflictStorage, externalConflictStorageKey } = this.services;
    if (!externalConflictStorage) return;
    try {
      const serialized = externalConflictStorage.getItem(externalConflictStorageKey);
      if (!serialized) return;
      const conflicts = this.parseExternalWriteConflicts(serialized);
      for (const conflict of conflicts) await this.restoreExternalWriteConflict(conflict);
      this.setPersistenceStatus("error", "External file changes need review");
      this.services.showExternalWriteConflicts?.(
        [...this.state.externalWriteConflicts.values()]
      );
    } catch (error) {
      const detail = error.message || String(error);
      this.setPersistenceStatus("error", `Could not restore external changes: ${detail}`);
      this.services.showEditorMessage("Could not restore external changes", detail);
    }
  }

  /** Parses and validates persisted external-write conflicts. */
  parseExternalWriteConflicts(serialized) {
    const conflicts = JSON.parse(serialized);
    if (!conflicts || Array.isArray(conflicts) || typeof conflicts !== "object") {
      throw new Error("Stored external-write conflicts are invalid.");
    }
    const entries = Object.entries(conflicts);
    if (entries.some(([filePath, conflict]) =>
      !conflict || conflict.path !== filePath ||
      (conflict.localDeleted
        ? conflict.localContent !== null
        : typeof conflict.localContent !== "string") ||
      (conflict.diskContent !== null && typeof conflict.diskContent !== "string") ||
      (conflict.diskHash !== null &&
        (typeof conflict.diskHash !== "string" || !/^[a-f\d]{64}$/i.test(conflict.diskHash)))
    )) {
      throw new Error("Stored external-write conflicts are invalid.");
    }
    return entries.map(([, conflict]) => conflict);
  }

  /** Reapplies the local side of a persisted conflict after project load. */
  async restoreExternalWriteConflict(conflict) {
    this.state.externalWriteConflicts.set(conflict.path, conflict);
    if (conflict.localDeleted) {
      await this.services.removeExternalFile?.(conflict.path);
      const version = ++this.state.editVersion;
      this.state.deletedFiles.set(conflict.path, version);
      this.state.dirtyFiles.set(conflict.path, version);
      this.state.hasEdits = true;
    } else {
      await this.services.applyExternalFileContent?.(
        conflict.path,
        conflict.localContent,
        { merged: true }
      );
      this.markEdited(conflict.path);
    }
  }

  /** Applies a user-selected response to one external-write conflict. */
  async resolveExternalWriteConflict(filePath, action, mergedContent) {
    const conflict = this.state.externalWriteConflicts.get(filePath);
    if (!conflict) throw new Error(`No external-write conflict exists for "${filePath}".`);
    switch (action) {
      case "reload":
        await this.reloadExternalWriteConflict(filePath, conflict);
        break;
      case "keep":
        this.keepExternalWriteConflict(filePath, conflict);
        break;
      case "merge":
        await this.mergeExternalWriteConflict(filePath, conflict, mergedContent);
        return;
      default:
        throw new Error(`Unsupported external-write action "${action}".`);
    }
    this.state.externalWriteConflicts.delete(filePath);
    this.persistExternalWriteConflicts();
    this.updateSaveControls();
    if (this.state.externalWriteConflicts.size === 0) {
      this.setPersistenceStatus(this.state.hasEdits ? "pending" : "saved",
        this.state.hasEdits ? "Pending changes" : "Saved");
      if (action === "keep") this.scheduleAutosave(true);
    }
    this.services.showExternalWriteConflicts?.(
      [...this.state.externalWriteConflicts.values()]
    );
  }

  /** Reloads the external version and clears the local pending edit. */
  async reloadExternalWriteConflict(filePath, conflict) {
    if (conflict.diskContent === null) {
      throw new Error(`"${filePath}" was deleted externally and cannot be reloaded.`);
    }
    await this.services.applyExternalFileContent(
      filePath,
      conflict.diskContent,
      { reload: conflict.localDeleted }
    );
    this.state.dirtyFiles.delete(filePath);
    this.state.deletedFiles.delete(filePath);
    this.state.invalidYamlFiles.delete(filePath);
    this.state.invalidWorkflowFiles.delete(filePath);
    this.state.fileHashes.set(filePath, conflict.diskHash);
    this.clearRecoveryDraft(filePath);
    this.state.hasEdits = this.state.dirtyFiles.size > 0;
  }

  /** Keeps a merged source and schedules it against the current disk version. */
  async mergeExternalWriteConflict(filePath, conflict, mergedContent) {
    if (conflict.localDeleted) {
      throw new Error("A locally deleted file cannot be merged as source text.");
    }
    if (typeof mergedContent !== "string") {
      throw new Error("Merged project content must be text.");
    }
    await this.services.applyExternalFileContent(filePath, mergedContent, { merged: true });
    this.state.fileHashes.set(filePath, conflict.diskHash);
    this.setCreatedFileMode(filePath, conflict.diskHash === null);
    this.state.externalWriteConflicts.delete(filePath);
    this.persistExternalWriteConflicts();
    this.markEdited(filePath);
    this.scheduleAutosave(true);
  }

  /** Accepts the local version as the next save baseline after user confirmation. */
  keepExternalWriteConflict(filePath, conflict) {
    if (conflict.localDeleted && conflict.diskHash === null) {
      this.state.fileHashes.delete(filePath);
      this.state.deletedFiles.delete(filePath);
      this.state.dirtyFiles.delete(filePath);
      this.state.projectFilePaths = this.state.projectFilePaths.filter((path) => path !== filePath);
      this.setCreatedFileMode(filePath, false);
      this.state.hasEdits = this.state.dirtyFiles.size > 0;
      return;
    }
    this.state.fileHashes.set(filePath, conflict.diskHash);
    this.setCreatedFileMode(filePath, conflict.diskHash === null);
  }

  /** Marks an externally created or removed file for the next save operation. */
  setCreatedFileMode(filePath, isNewFile) {
    const { state } = this;
    const sets = [
      state.createdScreenFiles,
      state.createdMaterialFiles,
      state.createdSpecFiles,
      state.createdWorkflowFiles
    ].filter(Boolean);
    for (const set of sets) set.delete(filePath);
    if (!isNewFile) return;
    if (filePath.endsWith(".stml")) state.createdMaterialFiles.add(filePath);
    else if (filePath.endsWith(".mmd")) state.createdWorkflowFiles.add(filePath);
    else if (filePath.endsWith(".md")) state.createdSpecFiles.add(filePath);
    else state.createdScreenFiles.add(filePath);
  }

  /** Sends a stable save snapshot to the project-file API. */
  async submitSaveSnapshot(snapshot, announce = true) {
    const { services } = this;
    const response = await services.fetcher("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: snapshot.files.map(({ version, ...file }) => file),
        deletes: snapshot.deletes.map(({ version, ...file }) => file)
      })
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || `Save failed (HTTP ${response.status}).`);
      error.conflicts = result.conflicts || [];
      throw error;
    }
    this.finishSuccessfulSave(snapshot, result, announce);
  }

  /** Validates current edits and snapshots their file entries for saving. */
  prepareSaveSnapshot() {
    const { state } = this;
    if (state.invalidYamlFiles.size > 0 || state.invalidWorkflowFiles.size > 0) {
      this.setPersistenceStatus("error", "Fix invalid source before saving");
      this.updateSaveControls();
      return null;
    }
    this.updateCreatedSpecDrafts();
    if (!this.validateSpecSourceReferences() || !this.validateScreensForSave()) return null;
    if (state.dirtyFiles.size === 0) return null;
    return {
      files: this.createSaveSnapshot(this.createSaveEntries()),
      deletes: this.createDeleteSnapshot()
    };
  }

  /** Validates and persists the current editor changes to project files. */
  async save({ automatic = false } = {}) {
    const { state, services } = this;
    if (state.isSaving || state.dirtyFiles.size === 0) return;
    const snapshot = this.prepareSaveSnapshot();
    if (!snapshot) return;
    this.setSavingUi(true);
    let succeeded = false;
    try {
      await this.submitSaveSnapshot(snapshot, !automatic);
      succeeded = true;
    } catch (error) {
      if (error.conflicts?.length) {
        this.recordExternalWriteConflicts(snapshot.files, error.conflicts, snapshot.deletes);
      } else {
        this.setPersistenceStatus("error", `Save failed: ${error.message || String(error)}`);
        services.showEditorMessage("Could not save changes", error.message || String(error));
      }
    } finally {
      this.setSavingUi(false);
      if (succeeded && state.dirtyFiles.size > 0) this.scheduleAutosave(true);
    }
  }
}
