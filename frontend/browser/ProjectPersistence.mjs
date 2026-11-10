/** Tracks project edits and saves validated file changes. */
export class ProjectPersistence {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
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
    state.dirtyFiles.set(filePath, ++state.editVersion);
    state.hasEdits = true;
    this.updateSaveControls();
  }

  /** Clears the edited and resets its associated state. */
  clearEdited(filePath) {
    if (!this.state.dirtyFiles.delete(filePath)) return;
    this.state.hasEdits = this.state.dirtyFiles.size > 0;
    this.updateSaveControls();
  }

  /** Updates the save controls to reflect the latest editor state. */
  updateSaveControls() {
    const saveButton = this.services.byId("save-project");
    if (!saveButton) return;
    const { state } = this;
    const invalidYamlMessage = state.invalidYamlFiles.values().next().value;
    const invalidWorkflowMessage = state.invalidWorkflowFiles.values().next().value;
    saveButton.disabled = state.isSaving || state.dirtyFiles.size === 0 ||
      state.invalidYamlFiles.size > 0 || state.invalidWorkflowFiles.size > 0;
    saveButton.textContent = state.isSaving
      ? "Saving..."
      : state.dirtyFiles.size > 0
        ? `Save (${state.dirtyFiles.size})`
        : "Save";
    saveButton.title = invalidYamlMessage
      ? `Fix invalid YAML before saving: ${invalidYamlMessage}`
      : invalidWorkflowMessage
        ? `Fix invalid Mermaid before saving: ${invalidWorkflowMessage}`
        : "";
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
    const linksToElement = references.some((reference) =>
      reference.screenId === screen.id && reference.placementId === elementId
    );
    if (!linksToElement) {
      throw new Error(
        `${specPath} must include a SpecUX Screen link to its Element "${elementId}".`
      );
    }
    const instancePath = services.findInstancePathById(screen.data.materials || [], elementId);
    if (!instancePath) throw new Error(`${specPath} links to unavailable Element "${elementId}".`);
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
    const saveEntries = new Map([...state.dirtyFiles].map(([filePath, version]) => [
      filePath,
      { version, ...this.getProjectFileSaveEntry(filePath) }
    ]));
    for (const [filePath, draft] of state.createdSpecDrafts) {
      if (draft.owner === "instance") continue;
      const linkFile = draft.owner === "project" ? "project.yml" : draft.screenFile;
      if (state.specSources.get(filePath) === draft.initialContent || saveEntries.has(linkFile)) continue;
      saveEntries.set(linkFile, {
        version: state.dirtyFiles.get(linkFile) ?? null,
        ...this.getProjectFileSaveEntry(linkFile)
      });
    }
    return saveEntries;
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

  /** Sets the saving ui from the supplied data. */
  setSavingUi(isSaving) {
    this.state.isSaving = isSaving;
    this.services.byId("spec-source").disabled = isSaving;
    this.services.byId("reset-project").disabled = isSaving;
    this.updateSaveControls();
  }

  /** Reconciles saved file versions with the current dirty-file state. */
  updateSavedFile(file) {
    const { state, services } = this;
    if (file.create) {
      state.createdScreenFiles.delete(file.path);
      state.createdMaterialFiles?.delete(file.path);
      state.createdSpecFiles.delete(file.path);
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
    if (savedCurrentVersion) state.dirtyFiles.delete(file.path);
    const savedScreen = state.screens.find((entry) => entry.file === file.path);
    if (savedScreen && savedCurrentVersion) services.setScreenYamlStatus(savedScreen, "Saved.");
  }

  /** Clears only saved versions of dirty files and refreshes save controls. */
  finishSuccessfulSave(snapshot, result) {
    const { state, services } = this;
    for (const file of snapshot) this.updateSavedFile(file);
    const updatedFilePaths = new Set(state.projectFilePaths);
    for (const file of snapshot) updatedFilePaths.add(file.path);
    state.projectFilePaths = [...updatedFilePaths];
    state.hasEdits = state.dirtyFiles.size > 0;
    services.renderNavigation();
    this.updateSaveControls();
    if (!state.hasEdits) {
      services.showEditorMessage(
        "Changes saved",
        `${result.saved.length} project file${result.saved.length === 1 ? "" : "s"} saved to specux/.`
      );
    }
  }

  /** Sends a stable save snapshot to the project-file API. */
  async submitSaveSnapshot(snapshot) {
    const { services } = this;
    const response = await services.fetcher("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: snapshot.map(({ version, ...file }) => file)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Save failed (HTTP ${response.status}).`);
    this.finishSuccessfulSave(snapshot, result);
  }

  /** Validates and persists the current editor changes to project files. */
  async save() {
    const { state, services } = this;
    if (state.isSaving || state.dirtyFiles.size === 0) return;
    if (state.invalidYamlFiles.size > 0 || state.invalidWorkflowFiles.size > 0) {
      this.updateSaveControls();
      return;
    }
    this.updateCreatedSpecDrafts();
    if (!this.validateSpecSourceReferences() || !this.validateScreensForSave()) return;
    if (state.dirtyFiles.size === 0) return;
    const snapshot = this.createSaveSnapshot(this.createSaveEntries());
    this.setSavingUi(true);
    try {
      await this.submitSaveSnapshot(snapshot);
    } catch (error) {
      services.showEditorMessage("Could not save changes", error.message || String(error));
    } finally {
      this.setSavingUi(false);
    }
  }
}
