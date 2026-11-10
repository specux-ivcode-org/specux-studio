/** Coordinates selection changes and navigation between editor views. */
export class EditorNavigation {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services, browserHistory }) {
    this.state = state;
    this.services = services;
    this.browserHistory = browserHistory;
  }

  /** Builds a selection for the project overview. */
  projectSelection(screenContext) {
    return { view: "project", screen: screenContext };
  }

  /** Builds a selection for the active workflow and its owning Screen. */
  workflowSelection(screenContext) {
    return {
      view: "workflow",
      screen: screenContext,
      workflow: { file: this.state.activeWorkflowPath }
    };
  }

  /** Builds a selection for the active Theme file and mode. */
  themeSelection(screenContext) {
    const { state } = this;
    return {
      view: "theme",
      screen: screenContext,
      file: state.activeProjectFilePath || state.project?.theme || null
    };
  }

  /** Builds a selection for the active behavior or Element spec. */
  specSelection(screen) {
    const { state } = this;
    const ownerScreen = state.screens.find((entry) =>
      entry.file === state.activeSpecScreenFile
    ) || screen;
    return {
      view: "spec",
      screen: state.activeSpecOwner === "project" || !ownerScreen ? null : {
        id: ownerScreen.id,
        name: ownerScreen.data.name || ownerScreen.id,
        file: ownerScreen.file
      },
      spec: state.activeSpecPath ? {
        file: state.activeSpecPath,
        owner: state.activeSpecOwner,
        ...(state.activeSpecOwner === "instance"
          ? { instancePath: state.activeSpecInstancePath }
          : {})
      } : null
    };
  }

  /** Builds a selection for the active Material file. */
  materialSelection(screenContext) {
    const { state } = this;
    const material = state.materialFiles.get(state.activeMaterialFilePath);
    return {
      view: "material-file",
      screen: screenContext,
      material: material ? {
        id: material.id,
        name: material.data.name || material.id,
        file: state.activeMaterialFilePath
      } : null
    };
  }

  /** Builds a selection for the active Screen and placement. */
  screenSelection(screenContext, screen) {
    const { state, services } = this;
    const instance = screen && state.activeInstancePath.length
      ? services.getInstanceAtPath(screen, state.activeInstancePath)
      : null;
    const material = instance ? state.materialFiles.get(instance.src) : null;
    return {
      view: "screen",
      screen: screenContext,
      selectedPlacement: instance ? {
        id: instance.id,
        name: services.getElementLabel(instance),
        instancePath: state.activeInstancePath,
        instance,
        ...(material ? { material: {
          name: material.data.name || material.id,
          description: material.data.description || "",
          attributes: material.data.attributes || {}
        } } : {})
      } : null
    };
  }

  /** Builds the editor selection object from the active view and file. */
  currentSelection() {
    const { state } = this;
    const screen = state.screens[state.activeScreenIndex] || null;
    const workflowScreen = state.viewingWorkflow
      ? state.screens[state.workflowScreenIndex] || null
      : screen;
    const screenContext = this.getScreenContext(workflowScreen);
    if (state.viewingProject) return this.projectSelection(screenContext);
    if (state.viewingWorkflow) return this.workflowSelection(screenContext);
    if (state.viewingTheme) return this.themeSelection(screenContext);
    if (state.viewingSpec) return this.specSelection(screen);
    if (state.viewingMaterialFile) return this.materialSelection(screenContext);
    return this.screenSelection(screenContext, screen);
  }

  /** Returns the screen context. */
  getScreenContext(screen) {
    return screen ? {
      id: screen.id,
      name: screen.data.name || screen.id,
      file: screen.file
    } : null;
  }

  /** Returns the project file represented by the supplied editor selection. */
  getSelectionFilePath(selection) {
    const { state } = this;
    const fileByView = {
      project: "project.yml",
      workflow: selection.workflow?.file || null,
      theme: selection.file || state.project?.theme || null,
      spec: selection.spec?.file || null,
      "material-file": selection.material?.file || null
    };
    if (Object.hasOwn(fileByView, selection.view)) return fileByView[selection.view];
    return selection.screen?.file || state.screens[state.activeScreenIndex]?.file || null;
  }

  /** Builds an editor selection from the URL file, view, owner, and nested-path parameters. */
  selectionFromLocation() {
    return this.browserHistory.selectionFromLocation();
  }

  /** Updates browser history to reflect the current selection. */
  syncHistory(forceReplace = false) {
    this.browserHistory.sync(forceReplace);
  }

  /** Translates URL parameters into the editor selection and opens the referenced view. */
  async restoreUrlSelection(selection) {
    const { state, services } = this;
    const action = services.getProjectFileAction(selection.file);
    if (action) {
      await this.restoreUrlFileAction(selection, action);
      return;
    }
    await this.restoreMissingUrlSelection(selection);
  }

  /** Opens the project file named by the current URL. */
  async restoreUrlFileAction(selection, action) {
    const { state, services } = this;
    await services.openProjectFile(selection.file);
    if (action.kind !== "screen" || !Array.isArray(selection.instancePath)) return;
    const screen = state.screens[action.screenIndex];
    const instance = screen && services.getInstanceAtPath(screen, selection.instancePath);
    if (instance) services.selectInstance(selection.instancePath, instance.src || null);
  }

  /** Falls back to the project selection when the URL target no longer exists. */
  async restoreMissingUrlSelection(selection) {
    const { state, services } = this;
    if (selection.requestedView !== "spec") {
      await services.renderScreen(0);
      return;
    }
    if (selection.owner === "project") {
      await services.renderProjectOverview();
      await services.createProjectSpec();
      return;
    }
    const screenIndex = state.screens.findIndex((screen) =>
      screen.id === selection.screen?.id
    );
    if (screenIndex < 0) {
      await services.renderScreen(0);
      return;
    }
    await services.renderScreen(screenIndex);
    if (selection.owner === "screen") {
      await services.createSpecForScreen();
      return;
    }
    const screen = state.screens[screenIndex];
    if (selection.owner === "instance" &&
        Array.isArray(selection.instancePath) &&
        services.getInstanceAtPath(screen, selection.instancePath)) {
      await services.createSpecForInstance(selection.instancePath);
      return;
    }
    await services.renderScreen(0);
  }

  /** Opens the project overview and restores its navigation state. */
  async restoreProjectSelection(selection) {
    const { state, services } = this;
    if (selection.view !== "project") return false;
    await services.renderProjectOverview();
    return true;
  }

  /** Opens the Theme file and restores its selected mode. */
  async restoreThemeSelection(selection) {
    const { state, services } = this;
    if (selection.view !== "theme") return false;
    await services.renderThemeView(selection.file || state.project?.theme);
    return true;
  }

  /** Opens the Material file and restores its preview selection. */
  async restoreMaterialSelection(selection) {
    const { state, services } = this;
    if (selection.view !== "material-file" || !state.materialFiles.has(selection.material?.file)) {
      return false;
    }
    await services.renderMaterialFile(selection.material.file);
    return true;
  }

  /** Opens the workflow and restores its selected node and owning Screen. */
  async restoreWorkflowSelection(selection) {
    const { state, services } = this;
    if (selection.view !== "workflow" || !state.workflowSources.has(selection.workflow?.file)) {
      return false;
    }
    const workflowScreenIndex = state.screens.findIndex((screen) =>
      screen.id === selection.screen?.id
    );
    if (workflowScreenIndex < 0) return false;
    await services.renderScreen(workflowScreenIndex);
    await services.renderWorkflowEditor(selection.workflow.file, workflowScreenIndex);
    return true;
  }

  /** Opens the project-level behavior spec at its saved selection. */
  async restoreProjectSpecSelection(selection) {
    const { state, services } = this;
    if (selection.view !== "spec" || selection.spec?.owner !== "project") return false;
    await services.renderProjectOverview();
    const draft = state.createdSpecDrafts.get(selection.spec.file);
    if (state.project.spec === selection.spec.file || draft?.owner === "project") {
      await services.renderSpecEditor(selection.spec.file, [], "project");
    } else {
      await services.createProjectSpec();
    }
    return true;
  }

  /** Opens the Screen-level spec and restores its target context. */
  async restoreScreenSpecSelection(selection, screen) {
    const { state, services } = this;
    if (selection.view !== "spec" || !screen) return false;
    const instancePath = selection.spec?.instancePath;
    if (selection.spec?.owner === "screen") {
      const draft = state.createdSpecDrafts.get(selection.spec.file);
      if (screen.data.spec === selection.spec.file ||
          (draft?.owner === "screen" && draft.screenFile === screen.file)) {
        await services.renderSpecEditor(selection.spec.file, [], "screen");
      } else {
        await services.createSpecForScreen();
      }
      return true;
    }
    return this.restoreInstanceSpecSelection(selection, screen, instancePath);
  }

  /** Opens the Element spec for the specified instance path. */
  async restoreInstanceSpecSelection(selection, screen, instancePath) {
    const { state, services } = this;
    const instance = Array.isArray(instancePath)
      ? services.getInstanceAtPath(screen, instancePath)
      : null;
    if (!instance) return false;
    const elementSpecOwner = typeof selection.spec?.file === "string"
      ? state.elementSpecOwners.get(selection.spec.file)
      : null;
    const draft = state.createdSpecDrafts.get(selection.spec?.file);
    const matchesOwner = elementSpecOwner?.screenFile === screen.file &&
      services.sameInstancePath(elementSpecOwner.instancePath, instancePath);
    const matchesDraft = draft?.owner === "instance" && draft.screenFile === screen.file &&
      services.sameInstancePath(draft.instancePath, instancePath);
    if (typeof selection.spec?.file === "string" && (matchesOwner || matchesDraft)) {
      await services.renderSpecEditor(selection.spec.file, instancePath);
      return true;
    }
    await services.createSpecForInstance(instancePath);
    return true;
  }

  /** Selects the restored placement and updates the related editor state. */
  selectRestoredPlacement(selection) {
    const { state, services } = this;
    const instancePath = selection.selectedPlacement?.instancePath;
    if (!Array.isArray(instancePath)) return;
    const screen = state.screens[state.activeScreenIndex];
    const instance = screen && services.getInstanceAtPath(screen, instancePath);
    if (instance) services.selectInstance(instancePath, instance.src || null);
  }

  /** Routes the saved selection to the matching editor view and file. */
  async restoreSelection(selection) {
    const { state, services } = this;
    if (selection.view === "url") {
      await this.restoreUrlSelection(selection);
      return;
    }
    const screenIndex = state.screens.findIndex((screen) => screen.id === selection.screen?.id);
    state.activeScreenIndex = screenIndex >= 0 ? screenIndex : 0;
    if (await this.restoreProjectSelection(selection)) return;
    if (await this.restoreThemeSelection(selection)) return;
    if (await this.restoreMaterialSelection(selection)) return;
    if (await this.restoreWorkflowSelection(selection)) return;
    if (await this.restoreProjectSpecSelection(selection)) return;
    await services.renderScreen(state.activeScreenIndex);
    if (selection.view === "spec") {
      const screen = state.screens[state.activeScreenIndex];
      if (!screen) return;
      await this.restoreScreenSpecSelection(selection, screen);
    }
    this.selectRestoredPlacement(selection);
  }

  /** Reloads the active editor view after project files change externally. */
  refreshFromExternalChanges() {
    if (this.state.hasEdits) {
      this.services.showEditorMessage(
        "Project files changed outside the editor",
        "Save or reset your editor changes before refreshing from disk."
      );
      return;
    }
    this.services.loadProject(this.currentSelection());
  }
}
