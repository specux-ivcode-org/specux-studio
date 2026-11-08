export class ProjectPersistence {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

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

  clearEdited(filePath) {
    if (!this.state.dirtyFiles.delete(filePath)) return;
    this.state.hasEdits = this.state.dirtyFiles.size > 0;
    this.updateSaveControls();
  }

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

  async save() {
    const { state, services } = this;
    if (state.isSaving || state.dirtyFiles.size === 0) return;
    if (state.invalidYamlFiles.size > 0 || state.invalidWorkflowFiles.size > 0) {
      this.updateSaveControls();
      return;
    }
    for (const [filePath, draft] of state.createdSpecDrafts) {
      if (state.specSources.get(filePath) === draft.initialContent) continue;
      if (draft.owner === "project") {
        state.project.spec = filePath;
        state.createdSpecFiles.add(filePath);
        continue;
      }
      const screen = state.screens.find((entry) => entry.file === draft.screenFile);
      if (draft.owner === "screen" && screen) {
        screen.data.spec = filePath;
        state.createdSpecFiles.add(filePath);
        continue;
      }
      const instance = screen && services.getInstanceAtPath(screen, draft.instancePath);
      if (!instance) {
        state.createdSpecDrafts.delete(filePath);
        state.createdSpecFiles.delete(filePath);
        state.specSources.delete(filePath);
        state.elementSpecOwners.delete(filePath);
        this.clearEdited(filePath);
        continue;
      }
      state.createdSpecFiles.add(filePath);
    }
    for (const [specPath, content] of state.specSources) {
      try {
        services.validation.validateSpecScreenReferences(content, state.screens, specPath);
      } catch (error) {
        services.showEditorMessage("Could not save changes", error.message || String(error));
        return;
      }
    }
    for (const screen of state.screens) {
      try {
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
          const identity = services.validation.getElementSpecIdentity(specPath);
          if (!identity || identity.screenId !== screen.id) {
            throw new Error(`${specPath} is not a valid Element spec path for Screen "${screen.id}".`);
          }
          const { elementId } = identity;
          services.validation.validateElementSpecPath(specPath, elementId);
          const references = services.validation.parseSpecScreenReferences(content, specPath);
          if (!references.some((reference) =>
            reference.screenId === screen.id && reference.placementId === elementId
          )) {
            throw new Error(
              `${specPath} must include a SpecUX Screen link to its Element "${elementId}".`
            );
          }
          const instancePath = services.findInstancePathById(screen.data.materials || [], elementId);
          if (!instancePath) {
            throw new Error(`${specPath} links to unavailable Element "${elementId}".`);
          }
          if (linkedElementIds.has(elementId)) {
            throw new Error(`${specPath}: Element "${elementId}" has more than one behavior spec.`);
          }
          linkedElementIds.add(elementId);
          state.elementSpecOwners.set(specPath, { screenFile: screen.file, elementId, instancePath });
          linkedSpecPaths.add(specPath);
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
      } catch (error) {
        services.showEditorMessage("Could not save changes", error.message || String(error));
        return;
      }
    }
    if (state.dirtyFiles.size === 0) return;
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
    const savePriority = (file) => file.create && file.path.endsWith(".md")
      ? 0
      : file.create
        ? 1
        : 2;
    const snapshot = [...saveEntries.values()].sort((left, right) =>
      savePriority(left) - savePriority(right)
    );
    state.isSaving = true;
    services.byId("spec-source").disabled = true;
    services.byId("reset-project").disabled = true;
    this.updateSaveControls();
    try {
      const response = await services.fetcher("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: snapshot.map(({ version, ...file }) => file)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Save failed (HTTP ${response.status}).`);
      for (const file of snapshot) {
        if (file.create) state.createdScreenFiles.delete(file.path);
        if (file.create) state.createdMaterialFiles?.delete(file.path);
        if (file.create) state.createdSpecFiles.delete(file.path);
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
        if (savedScreen && savedCurrentVersion) {
          services.setScreenYamlStatus(savedScreen, "Saved.");
        }
      }
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
    } catch (error) {
      services.showEditorMessage("Could not save changes", error.message || String(error));
    } finally {
      state.isSaving = false;
      services.byId("spec-source").disabled = false;
      this.updateSaveControls();
      services.byId("reset-project").disabled = false;
    }
  }
}
