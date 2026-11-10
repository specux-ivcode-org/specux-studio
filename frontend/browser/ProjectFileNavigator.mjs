/** Builds and updates navigation for files in the loaded project. */
export class ProjectFileNavigator {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services, projectFileTree }) {
    this.state = state;
    this.services = services;
    this.projectFileTree = projectFileTree;
  }

  /** Returns the path of the currently active project file. */
  activeFilePath() {
    const { state } = this;
    if (state.activeProjectFilePath) return state.activeProjectFilePath;
    if (state.viewingSpec) return state.activeSpecPath;
    if (state.viewingTheme) return state.project?.theme;
    if (state.viewingProject) return "project.yml";
    if (state.viewingMaterialFile) return state.activeMaterialFilePath;
    return state.screens[state.activeScreenIndex]?.file;
  }

  /** Renders the navigation from the current editor data. */
  renderNavigation() {
    const { state, services } = this;
    if (!state.viewingMaterialFile &&
        !state.viewingTheme && !state.viewingProject && !state.viewingSpec &&
        !state.viewingWorkflow) {
      services.byId("breadcrumb").textContent = "Screens";
    }
    const activeFilePath = this.activeFilePath();
    if (activeFilePath) this.projectFileTree.expandPath(activeFilePath);
    this.projectFileTree.render();
    services.updateNavigationSelection();
  }

  /** Renders the screen selector from the current editor data. */
  renderScreenSelector() {
    const { state, services } = this;
    const toggle = services.byId("screen-selector-toggle");
    const optionsContainer = services.byId("screen-selector-options");
    const search = services.byId("screen-selector-search");
    const query = search.value.trim().toLocaleLowerCase();
    const matches = state.screens
      .map((screen, index) => ({ screen, index }))
      .filter(({ screen }) =>
        `${screen.data.name || screen.id} ${screen.id}`.toLocaleLowerCase().includes(query)
      );
    toggle.disabled = state.screens.length === 0;
    toggle.setAttribute(
      "aria-label",
      state.screens.length
        ? `Choose a Screen; current Screen: ${state.screens[state.activeScreenIndex]?.data.name || state.screens[state.activeScreenIndex]?.id}`
        : "No Screens available"
    );
    optionsContainer.replaceChildren(...matches.map(({ screen, index }) => {
      const name = screen.data.name || screen.id;
      const option = services.element("button", "screen-selector-option");
      option.type = "button";
      option.id = `screen-selector-option-${screen.id}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === state.activeScreenIndex));
      option.setAttribute("aria-label", `Open Screen ${name} (${screen.id})`);
      option.append(services.element("span", "screen-selector-option-name", name));
      option.append(services.element("span", "screen-selector-option-id", screen.id));
      option.addEventListener("click", () => {
        this.setScreenSelectorOpen(false, true);
        services.renderScreen(index).catch(services.showFatalError);
      });
      return option;
    }));
    services.byId("screen-selector-no-results").hidden = matches.length > 0;
  }

  /** Sets the screen selector open from the supplied data. */
  setScreenSelectorOpen(open, restoreFocus = false) {
    const { services } = this;
    const toggle = services.byId("screen-selector-toggle");
    const panel = services.byId("screen-selector-panel");
    const search = services.byId("screen-selector-search");
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    search.value = "";
    this.renderScreenSelector();
    if (open) search.focus();
    else if (restoreFocus) toggle.focus();
  }

  /** Collects project files and generated drafts for the navigation tree. */
  getProjectTreeFilePaths() {
    const { state } = this;
    const filePaths = new Set(state.projectFilePaths);
    filePaths.add("project.yml");
    if (state.project?.theme) filePaths.add(state.project.theme);
    for (const screen of state.screens) filePaths.add(screen.file);
    for (const filePath of state.specSources.keys()) filePaths.add(filePath);
    for (const filePath of state.workflowSources.keys()) filePaths.add(filePath);
    for (const filePath of state.createdSpecDrafts.keys()) filePaths.add(filePath);
    for (const filePath of state.createdScreenFiles) filePaths.add(filePath);
    for (const filePath of state.createdSpecFiles) filePaths.add(filePath);
    return [...filePaths].filter((filePath) =>
      typeof filePath === "string" && filePath && !filePath.startsWith("/") &&
      !filePath.includes("\\")
    ).sort((left, right) => left.localeCompare(right));
  }

  /** Renders the project file from the current editor data. */
  renderProjectFile(file) {
    const { state, services } = this;
    const action = this.getProjectFileAction(file.path);
    const button = services.element("button", "file-tree-file");
    button.type = "button";
    button.dataset.projectFile = file.path;
    button.disabled = !action;
    button.title = action ? `Open ${file.path}` : `${file.path} (not editable in Studio)`;
    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1)
      : "file";
    button.append(services.element("span", "file-tree-type", extension));
    button.append(services.element("span", "file-tree-name", file.name));
    if (action?.kind === "screen") {
      const screen = state.screens[action.screenIndex];
      button.dataset.specuxScreenId = screen.id;
      button.dataset.specuxScreenName = screen.data.name || screen.id;
      button.setAttribute(
        "aria-label",
        `Open Screen ${screen.data.name || screen.id} (${file.path})`
      );
    }
    if (action) {
      button.addEventListener("click", () =>
        this.openProjectFile(file.path).catch((error) =>
          services.showEditorMessage("Could not open file", error.message || String(error))
        )
      );
    }
    return button;
  }

  /** Returns the project file action. */
  getProjectFileAction(filePath) {
    const { state } = this;
    if (filePath === "project.yml") return { kind: "project" };
    const screenIndex = state.screens.findIndex((screen) => screen.file === filePath);
    if (screenIndex >= 0) return { kind: "screen", screenIndex };
    if (filePath === state.project?.theme) return { kind: "theme" };
    if (state.materialFiles?.has(filePath)) {
      return { kind: "material", material: state.materialFiles.get(filePath) };
    }
    const specAction = this.getSpecFileAction(filePath);
    if (specAction) return { kind: "spec", ...specAction };
    const workflowScreenIndex = state.screens.findIndex((screen) =>
      filePath.startsWith(`screens/${screen.id}/workflows/`) &&
      state.workflowSources.has(filePath)
    );
    return workflowScreenIndex >= 0
      ? { kind: "workflow", screenIndex: workflowScreenIndex }
      : null;
  }

  /** Returns the spec file action. */
  getSpecFileAction(filePath) {
    const { state } = this;
    if (state.project?.spec === filePath ||
        state.createdSpecDrafts.get(filePath)?.owner === "project") {
      return { owner: "project", instancePath: [] };
    }
    for (let screenIndex = 0; screenIndex < state.screens.length; screenIndex += 1) {
      const screen = state.screens[screenIndex];
      if (screen.data.spec === filePath) return { owner: "screen", screenIndex, instancePath: [] };
      const draft = state.createdSpecDrafts.get(filePath);
      if (draft?.owner === "screen" && draft.screenFile === screen.file) {
        return { owner: "screen", screenIndex, instancePath: [] };
      }
      const elementSpecOwner = state.elementSpecOwners.get(filePath);
      if (elementSpecOwner?.screenFile === screen.file) {
        return { owner: "instance", screenIndex, instancePath: elementSpecOwner.instancePath };
      }
      if (draft?.owner === "instance" && draft.screenFile === screen.file) {
        return { owner: "instance", screenIndex, instancePath: draft.instancePath };
      }
    }
    return null;
  }

  /** Renders the spec action from the current editor data. */
  async renderSpecAction(filePath, action) {
    const { state, services } = this;
    state.activeScreenIndex = action.screenIndex ?? state.activeScreenIndex;
    if (state.viewingSpec && state.activeSpecPath === filePath) {
      await services.renderSpecEditor(filePath, action.instancePath, action.owner);
      return;
    }
    if (action.owner === "project") await services.renderProjectOverview();
    else await services.renderScreen(state.activeScreenIndex);
    await services.renderSpecEditor(filePath, action.instancePath, action.owner);
  }

  /** Renders the file action from the current editor data. */
  async renderFileAction(filePath, action) {
    const { services, state } = this;
    if (action.kind === "project") return services.renderProjectOverview();
    if (action.kind === "screen") return services.renderScreen(action.screenIndex);
    if (action.kind === "theme") return services.renderThemeView(filePath);
    if (action.kind === "material") return services.renderMaterialFile(filePath);
    if (action.kind === "spec") return this.renderSpecAction(filePath, action);
    state.activeScreenIndex = action.screenIndex;
    await services.renderScreen(action.screenIndex);
    return services.renderWorkflowEditor(filePath, action.screenIndex);
  }

  /** Opens the project file in the editor. */
  async openProjectFile(filePath) {
    const { state, services } = this;
    const action = this.getProjectFileAction(filePath);
    if (!action) return;
    const wasHistoryUpdateSuppressed = state.historyUpdateSuppressed;
    state.historyUpdateSuppressed = true;
    try {
      await this.renderFileAction(filePath, action);
    } finally {
      state.historyUpdateSuppressed = wasHistoryUpdateSuppressed;
    }
    if (!wasHistoryUpdateSuppressed) services.syncBrowserHistory();
  }

}
