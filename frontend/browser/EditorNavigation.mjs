export class EditorNavigation {
  constructor({ state, services, browserHistory }) {
    this.state = state;
    this.services = services;
    this.browserHistory = browserHistory;
  }

  currentSelection() {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex] || null;
    const workflowScreen = state.viewingWorkflow
      ? state.screens[state.workflowScreenIndex] || null
      : screen;
    const screenContext = workflowScreen ? {
      id: workflowScreen.id,
      name: workflowScreen.data.name || workflowScreen.id,
      file: workflowScreen.file
    } : null;
    if (state.viewingProject) return { view: "project", screen: screenContext };
    if (state.viewingWorkflow) {
      return {
        view: "workflow",
        screen: screenContext,
        workflow: { file: state.activeWorkflowPath }
      };
    }
    if (state.viewingTheme) {
      return {
        view: "theme",
        screen: screenContext,
        file: state.activeProjectFilePath || state.project?.theme || null
      };
    }
    if (state.viewingSpec) {
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
    if (state.viewingMaterialFile) {
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

  getSelectionFilePath(selection) {
    const { state } = this;
    if (selection.view === "project") return "project.yml";
    if (selection.view === "workflow") return selection.workflow?.file || null;
    if (selection.view === "theme") return selection.file || state.project?.theme || null;
    if (selection.view === "spec") return selection.spec?.file || null;
    if (selection.view === "material-file") return selection.material?.file || null;
    return selection.screen?.file || state.screens[state.activeScreenIndex]?.file || null;
  }

  selectionFromLocation() {
    return this.browserHistory.selectionFromLocation();
  }

  syncHistory(forceReplace = false) {
    this.browserHistory.sync(forceReplace);
  }

  async restoreUrlSelection(selection) {
    const { state, services } = this;
    const action = services.getProjectFileAction(selection.file);
    if (action) {
      await services.openProjectFile(selection.file);
      if (action.kind === "screen" && Array.isArray(selection.instancePath)) {
        const screen = state.screens[action.screenIndex];
        const instance = screen && services.getInstanceAtPath(screen, selection.instancePath);
        if (instance) services.selectInstance(selection.instancePath, instance.src || null);
      }
      return;
    }
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

  async restoreSelection(selection) {
    const { state, services } = this;
    if (selection.view === "url") {
      await this.restoreUrlSelection(selection);
      return;
    }
    const screenIndex = state.screens.findIndex((screen) => screen.id === selection.screen?.id);
    state.activeScreenIndex = screenIndex >= 0 ? screenIndex : 0;
    if (selection.view === "project") {
      await services.renderProjectOverview();
      return;
    }
    if (selection.view === "theme") {
      await services.renderThemeView(selection.file || state.project?.theme);
      return;
    }
    if (selection.view === "material-file" && state.materialFiles.has(selection.material?.file)) {
      await services.renderMaterialFile(selection.material.file);
      return;
    }
    if (selection.view === "workflow" && state.workflowSources.has(selection.workflow?.file)) {
      const workflowScreenIndex = state.screens.findIndex((screen) =>
        screen.id === selection.screen?.id
      );
      if (workflowScreenIndex >= 0) {
        await services.renderScreen(workflowScreenIndex);
        await services.renderWorkflowEditor(
          selection.workflow.file,
          workflowScreenIndex
        );
        return;
      }
    }
    if (selection.view === "spec" && selection.spec?.owner === "project") {
      await services.renderProjectOverview();
      const draft = state.createdSpecDrafts.get(selection.spec.file);
      if (state.project.spec === selection.spec.file || draft?.owner === "project") {
        await services.renderSpecEditor(selection.spec.file, [], "project");
      } else {
        await services.createProjectSpec();
      }
      return;
    }
    await services.renderScreen(state.activeScreenIndex);
    if (selection.view === "spec") {
      const screen = state.screens[state.activeScreenIndex];
      if (!screen) return;
      const instancePath = selection.spec?.instancePath;
      if (selection.spec?.owner === "screen") {
        const draft = state.createdSpecDrafts.get(selection.spec.file);
        if (screen.data.spec === selection.spec.file ||
            (draft?.owner === "screen" && draft.screenFile === screen.file)) {
          await services.renderSpecEditor(selection.spec.file, [], "screen");
        } else {
          await services.createSpecForScreen();
        }
        return;
      }
      const instance = Array.isArray(instancePath)
        ? services.getInstanceAtPath(screen, instancePath)
        : null;
      const elementSpecOwner = typeof selection.spec?.file === "string"
        ? state.elementSpecOwners.get(selection.spec.file)
        : null;
      const draft = state.createdSpecDrafts.get(selection.spec?.file);
      if (instance && typeof selection.spec?.file === "string" &&
          ((elementSpecOwner?.screenFile === screen.file &&
            services.sameInstancePath(elementSpecOwner.instancePath, instancePath)) ||
           (draft?.owner === "instance" && draft.screenFile === screen.file &&
            services.sameInstancePath(draft.instancePath, instancePath)))) {
        await services.renderSpecEditor(selection.spec.file, instancePath);
        return;
      }
      if (instance) {
        await services.createSpecForInstance(instancePath);
        return;
      }
    }
    const instancePath = selection.selectedPlacement?.instancePath;
    if (Array.isArray(instancePath)) {
      const screen = state.screens[state.activeScreenIndex];
      const instance = screen && services.getInstanceAtPath(screen, instancePath);
      if (instance) services.selectInstance(instancePath, instance.src || null);
    }
  }

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
