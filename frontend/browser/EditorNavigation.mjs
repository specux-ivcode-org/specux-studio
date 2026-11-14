import { getScreenPlacementIdPath } from "../../shared/ScreenGroups.mjs";

/** Coordinates selection changes and navigation between editor views. */
export class EditorNavigation {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services, browserHistory }) {
    this.state = state;
    this.services = services;
    this.browserHistory = browserHistory;
    this.linkedDockStack = [];
    this.closedPrimaryDock = null;
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

  /** Returns an explicit workspace-context snapshot without owning editor internals. */
  getWorkspaceContext() {
    const selection = this.currentSelection();
    const documentFile = this.getSelectionFilePath(selection);
    const materialWorkspace = selection.view === "material-file";
    return {
      activeMode: materialWorkspace ? "material" : selection.view,
      workspace: materialWorkspace ? "material" : "screen",
      document: { view: selection.view, file: documentFile },
      documentOwner: this.getDocumentOwner(selection),
      canvas: this.getCanvasContext(),
      dock: this.getDockContext(selection, documentFile)
    };
  }

  /** Selects a Screen from the toolbar and exits the current editor mode. */
  async selectScreenManually(screenIndex) {
    if (!this.state.screens[screenIndex]) {
      throw new Error(`Screen index "${screenIndex}" is not available.`);
    }
    const selection = this.currentSelection();
    if (["spec", "workflow"].includes(selection.view)) {
      this.closedPrimaryDock = {
        selection: this.cloneDockSelection(selection),
        context: this.getWorkspaceContext()
      };
    }
    this.linkedDockStack = [];
    await this.services.renderScreen(screenIndex, { centerPreview: true });
    this.state.workflowScreenIndex = screenIndex;
  }

  /** Changes the canvas target while retaining the referencing editor mode and owner. */
  async navigateToReferencedScreen(screenIndex, sourceMode, options = {}) {
    if (!this.state.screens[screenIndex]) {
      throw new Error(`Screen index "${screenIndex}" is not available.`);
    }
    if (!["spec", "workflow"].includes(sourceMode)) {
      throw new Error(`Unsupported reference navigation mode "${sourceMode}".`);
    }
    await this.services.renderScreen(screenIndex, {
      ...options,
      preserveSpec: sourceMode === "spec",
      preserveWorkflow: sourceMode === "workflow"
    });
  }

  /** Returns the displayed Screen and its active canvas target. */
  getCanvasContext() {
    const { state } = this;
    const displayedScreen = state.screens[state.activeScreenIndex] || null;
    const placementPaths = Array.isArray(state.activeInstancePaths)
      ? state.activeInstancePaths.map((path) => [...path])
      : state.activeInstancePath?.length ? [[...state.activeInstancePath]] : [];
    return {
      screen: this.getScreenContext(displayedScreen),
      stateId: displayedScreen
        ? state.activePreviewStateIds?.get(displayedScreen.id) || "default"
        : null,
      placementPaths
    };
  }

  /** Returns the displayed canvas target as a SpecUX path for URL serialization. */
  getCanvasSpecuxTarget() {
    if (!["screen", "spec", "workflow", "theme"].includes(this.currentSelection().view)) {
      return null;
    }
    const canvas = this.getCanvasContext();
    if (!canvas.screen) return null;
    const screen = this.state.screens.find((entry) => entry.id === canvas.screen.id);
    if (!screen) return null;
    const parameters = new URLSearchParams();
    for (const path of canvas.placementPaths) {
      const placementPath = getScreenPlacementIdPath(screen.data.materials || [], path);
      if (placementPath) parameters.append("placement", placementPath.join("."));
    }
    if (canvas.stateId && canvas.stateId !== "default") {
      parameters.set("state", canvas.stateId);
    }
    const query = parameters.toString();
    return `screen/${encodeURIComponent(screen.id)}/screen.yml${query ? `?${query}` : ""}`;
  }

  /** Returns the primary and linked dock contexts for the active document. */
  getDockContext(selection, documentFile) {
    const derivedPrimary = ["spec", "workflow"].includes(selection.view)
      ? {
        view: selection.view,
        file: documentFile,
        ...(selection.view === "workflow" && this.state.selectedWorkflowNodeId
          ? { nodeId: this.state.selectedWorkflowNodeId }
          : {})
      }
      : null;
    if (this.linkedDockStack.length) {
      const rootDock = this.linkedDockStack[0].parentContext.dock;
      return {
        primary: rootDock.primary,
        linked: this.linkedDockStack.map(({ document }) => ({ ...document })),
        active: "linked",
        reopenable: this.getReopenableDock()
      };
    }
    return {
      primary: derivedPrimary,
      linked: [],
      active: derivedPrimary ? "primary" : null,
      reopenable: this.getReopenableDock()
    };
  }

  /** Adds a linked document while retaining the current primary context. */
  pushLinkedDock(document) {
    if (!["spec", "workflow"].includes(document?.view) ||
        typeof document.file !== "string" || !document.file) {
      throw new Error("A linked dock document must identify a Spec or Workflow file.");
    }
    const parentContext = this.getWorkspaceContext();
    if (!parentContext.dock.primary) {
      throw new Error("A linked dock document requires an open primary Spec or Workflow.");
    }
    this.linkedDockStack.push({
      parentContext,
      document: {
        view: document.view,
        file: document.file,
        ...(document.nodeId ? { nodeId: document.nodeId } : {}),
        readOnly: document.readOnly === true
      }
    });
    return this.getWorkspaceContext();
  }

  /** Pops one linked document and returns its preserved parent context. */
  popLinkedDock() {
    const popped = this.linkedDockStack.pop();
    return popped?.parentContext || null;
  }

  /** Closes the primary dock while retaining its document and canvas context for reopening. */
  async closePrimaryDock() {
    const selection = this.currentSelection();
    if (!["spec", "workflow"].includes(selection.view)) return false;
    this.closedPrimaryDock = {
      selection: this.cloneDockSelection(selection),
      context: this.getWorkspaceContext()
    };
    this.linkedDockStack = [];
    const displayedScreenIndex = this.state.activeScreenIndex;
    if (this.state.screens[displayedScreenIndex]) {
      await this.selectScreenManually(displayedScreenIndex);
    } else {
      await this.services.renderProjectOverview();
    }
    return true;
  }

  /** Reopens the last closed primary dock and restores its canvas target. */
  async reopenPrimaryDock() {
    const closed = this.closedPrimaryDock;
    if (!closed) return false;
    await this.restoreSelection(closed.selection);
    await this.restoreCanvasContext(closed.context);
    this.closedPrimaryDock = null;
    return true;
  }

  /** Applies workspace-level Escape after local interactions have had first refusal. */
  async handleWorkspaceEscape({ localInteractionActive = false } = {}) {
    if (localInteractionActive) {
      return { handled: false, reason: "local-interaction" };
    }
    if (this.linkedDockStack.length) {
      return {
        handled: true,
        action: "pop-linked",
        parentContext: this.popLinkedDock()
      };
    }
    const selection = this.currentSelection();
    if (["spec", "workflow"].includes(selection.view)) {
      await this.closePrimaryDock();
      return { handled: true, action: "close-primary" };
    }
    if (this.state.viewingTheme) {
      await this.selectScreenManually(this.state.activeScreenIndex);
      return { handled: true, action: "exit-theme" };
    }
    return { handled: false, reason: "no-workspace-view" };
  }

  /** Returns a reopen control descriptor for a previously closed primary view. */
  getReopenableDock() {
    if (!this.closedPrimaryDock) return null;
    const selection = this.closedPrimaryDock.selection;
    return {
      view: selection.view,
      file: this.getSelectionFilePath(selection)
    };
  }

  /** Copies the serializable selection data needed to reopen a primary dock. */
  cloneDockSelection(selection) {
    return {
      ...selection,
      ...(selection.screen ? { screen: { ...selection.screen } } : {}),
      ...(selection.workflow ? { workflow: { ...selection.workflow } } : {}),
      ...(selection.spec ? {
        spec: {
          ...selection.spec,
          ...(Array.isArray(selection.spec.instancePath)
            ? { instancePath: [...selection.spec.instancePath] }
            : {})
        }
      } : {})
    };
  }

  /** Restores the displayed canvas after reopening its owning document. */
  async restoreCanvasContext(context) {
    const { state, services } = this;
    const target = context.canvas;
    if (!target.screen) return;
    const screenIndex = state.screens.findIndex((screen) =>
      screen.id === target.screen.id
    );
    if (screenIndex < 0) {
      services.showEditorMessage(
        "Cannot restore canvas target",
        `Screen "${target.screen.id}" is no longer available.`
      );
      return;
    }
    state.activePreviewStateIds?.set(target.screen.id, target.stateId || "default");
    const paths = target.placementPaths.map((path) => [...path]);
    state.activeInstancePath = paths.at(-1) || [];
    state.activeInstancePaths = paths;
    await services.renderScreen(screenIndex, {
      preserveSpec: context.activeMode === "spec",
      preserveWorkflow: context.activeMode === "workflow",
      previewStateSelected: target.stateId !== "default"
    });
    services.selectInstancesInPreview(paths);
  }

  /** Returns document ownership independently from the displayed canvas Screen. */
  getDocumentOwner(selection) {
    if (selection.view === "spec" && selection.spec?.owner === "project") {
      return { kind: "project", file: "project.yml" };
    }
    if (selection.view === "material-file" && selection.material) {
      return {
        kind: "material",
        id: selection.material.id,
        file: selection.material.file
      };
    }
    if (["screen", "spec", "workflow"].includes(selection.view)) {
      return this.getScreenDocumentOwner(selection);
    }
    return { kind: "project", file: "project.yml" };
  }

  /** Returns the Screen or placement owner of a Screen-related document. */
  getScreenDocumentOwner(selection) {
    if (!selection.screen) return { kind: "project", file: "project.yml" };
    const isInstanceSpec = selection.view === "spec" &&
      selection.spec?.owner === "instance";
    return {
      kind: isInstanceSpec ? "instance" : "screen",
      screenId: selection.screen.id,
      file: selection.screen.file,
      ...(isInstanceSpec && Array.isArray(selection.spec?.instancePath)
        ? { instancePath: [...selection.spec.instancePath] }
        : {})
    };
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
      await this.restoreUrlWorkflowNode(selection);
      await this.restoreUrlCanvasTarget(selection);
      await this.restoreUrlLinkedDocument(selection);
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

  /** Restores the linked document and selected node encoded in the URL. */
  async restoreUrlLinkedDocument(selection) {
    if (!selection.linkedFile) return;
    const { services } = this;
    const action = services.getProjectFileAction(selection.linkedFile);
    const primary = this.currentSelection();
    if (action?.kind === "workflow" && primary.view === "spec") {
      await services.showLinkedWorkflowPreview({
        workflowPath: selection.linkedFile,
        nodeId: selection.nodeId || null
      }, primary.spec.file);
      return;
    }
    if (action?.kind === "spec" && primary.view === "workflow" && selection.nodeId) {
      this.pushLinkedDock({
        view: "spec",
        file: selection.linkedFile,
        nodeId: selection.nodeId
      });
      try {
        services.showWorkflowNodeSpecPreview(selection.linkedFile, selection.nodeId);
      } catch (error) {
        this.popLinkedDock();
        throw error;
      }
      return;
    }
    services.showEditorMessage(
      "Cannot restore linked document",
      `The linked file "${selection.linkedFile}" is not available in this editor context.`
    );
  }

  /** Restores a selected node in the primary Workflow when the URL provides one. */
  async restoreUrlWorkflowNode(selection) {
    if (this.currentSelection().view !== "workflow" || !selection.nodeId) return;
    await this.services.restoreWorkflowNodeSelection(selection.nodeId);
  }

  /** Restores a complete SpecUX canvas target from a URL fragment. */
  async restoreUrlCanvasTarget(selection) {
    if (!selection.canvasTarget) return;
    try {
      const target = this.parseSpecuxCanvasTarget(selection.canvasTarget);
      const screen = this.state.screens.find((entry) => entry.id === target.screenId);
      if (!screen) throw new Error(`Screen "${target.screenId}" is no longer available.`);
      const states = screen.data["preview-states"] || [];
      if (target.stateId !== "default" && !states.some((entry) => entry.id === target.stateId)) {
        throw new Error(`Screen State "${target.stateId}" is no longer available.`);
      }
      const placementPaths = target.placementIds.map((path) =>
        this.resolvePlacementIdPath(screen, path)
      );
      if (placementPaths.some((path) => !path)) {
        throw new Error("One or more SpecUX placement targets are no longer available.");
      }
      await this.restoreCanvasContext({
        activeMode: this.currentSelection().view,
        canvas: {
          screen: this.getScreenContext(screen),
          stateId: target.stateId,
          placementPaths
        }
      });
    } catch (error) {
      this.services.showEditorMessage(
        "Cannot restore canvas target",
        error.message || String(error)
      );
    }
  }

  /** Parses the screen, state, and repeated placement values in a SpecUX path. */
  parseSpecuxCanvasTarget(target) {
    const url = new URL(`specux://${target}`);
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "specux:" || url.hostname !== "screen" ||
        segments.length !== 2 || segments[1] !== "screen.yml") {
      throw new Error("The specux fragment must identify a Screen file.");
    }
    const parameters = new URLSearchParams(url.search);
    for (const key of parameters.keys()) {
      if (!["placement", "state"].includes(key)) {
        throw new Error(`The specux fragment contains unsupported parameter "${key}".`);
      }
    }
    const states = parameters.getAll("state");
    if (states.length > 1) throw new Error("The specux fragment can contain only one state.");
    const placementIds = parameters.getAll("placement").map((value) => value.split("."));
    if (placementIds.some((path) => path.some((part) => !part))) {
      throw new Error("The specux fragment contains an invalid placement path.");
    }
    return {
      screenId: decodeURIComponent(segments[0]),
      stateId: states[0] || "default",
      placementIds
    };
  }

  /** Resolves a dot-separated placement identity path to its Screen index path. */
  resolvePlacementIdPath(screen, placementIds) {
    let siblings = screen.data.materials || [];
    const path = [];
    for (const id of placementIds) {
      const index = siblings.findIndex((placement) => placement.id === id);
      if (index < 0) return null;
      path.push(index);
      siblings = siblings[index].children || [];
    }
    return path;
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
