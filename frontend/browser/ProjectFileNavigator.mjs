import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";
import { getMaterialPreviewSize } from "./MaterialPreviewSize.mjs";

/** Builds and updates navigation for files in the loaded project. */
export class ProjectFileNavigator {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services, projectFileTree }) {
    this.state = state;
    this.services = services;
    this.projectFileTree = projectFileTree;
    this.sidebarTab = "materials";
    this.suppressNextMaterialClick = false;
    this.materialContextMenuFile = null;
    this.materialPreviewObserver = null;
    this.materialDrag = {
      pointerId: null,
      startX: 0,
      startY: 0,
      active: false,
      filePath: null,
      size: null
    };
    this.materialDropOutline = null;
  }

  /** Binds the persistent left-panel tabs and their keyboard navigation. */
  bindSidebarTabs() {
    const tabs = [
      ["materials", "sidebar-materials-tab"],
      ["project", "sidebar-project-tab"]
    ];
    for (const [tabName, tabId] of tabs) {
      const tab = this.services.byId(tabId);
      tab.addEventListener("click", () => this.setSidebarTab(tabName));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex(([, candidateId]) => candidateId === tabId);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        const [nextTabName, nextTabId] = tabs[nextIndex];
        this.setSidebarTab(nextTabName);
        this.services.byId(nextTabId).focus();
      });
    }
    this.setSidebarTab(this.sidebarTab);
    this.bindMaterialContextMenu();
    this.bindMaterialDrag();
  }

  /** Binds the Material selector context menu and its dismiss interactions. */
  bindMaterialContextMenu() {
    const menu = this.services.byId("material-selector-context-menu");
    const editButton = this.services.byId("material-selector-context-edit");
    editButton.addEventListener("click", () => {
      const filePath = this.materialContextMenuFile;
      this.closeMaterialContextMenu();
      if (!filePath) return;
      return this.services.renderMaterialFile(filePath).catch((error) =>
        this.services.showEditorMessage("Could not open Material", error.message || String(error))
      );
    });
    this.services.document.addEventListener("pointerdown", (event) => {
      if (!menu.hidden && !menu.contains(event.target)) this.closeMaterialContextMenu();
    }, true);
  }

  /** Opens the Material edit action at the pointer position. */
  openMaterialContextMenu(event, filePath) {
    event.preventDefault();
    const menu = this.services.byId("material-selector-context-menu");
    this.materialContextMenuFile = filePath;
    menu.hidden = false;
    const width = menu.offsetWidth || 190;
    const height = menu.offsetHeight || 42;
    const window = this.services.window;
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
    this.services.byId("material-selector-context-edit").focus();
  }

  /** Closes the Material selector context menu. */
  closeMaterialContextMenu() {
    this.services.byId("material-selector-context-menu").hidden = true;
    this.materialContextMenuFile = null;
  }

  /** Activates a left-panel view and updates its accessible tab state. */
  setSidebarTab(tabName) {
    if (!["materials", "project"].includes(tabName)) return;
    this.sidebarTab = tabName;
    const { services } = this;
    for (const [name, tabId, panelId] of [
      ["materials", "sidebar-materials-tab", "material-selector-panel"],
      ["project", "sidebar-project-tab", "project-files-panel"]
    ]) {
      const selected = name === tabName;
      const tab = services.byId(tabId);
      tab.classList.toggle("selected", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      services.byId(panelId).hidden = !selected;
    }
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
    this.renderMaterialSelector();
    this.setSidebarTab(this.sidebarTab);
    const activeFilePath = this.activeFilePath();
    if (activeFilePath) this.projectFileTree.expandPath(activeFilePath);
    this.projectFileTree.render();
    services.updateNavigationSelection();
  }

  /** Renders the reusable Material list in the left workspace panel. */
  renderMaterialSelector() {
    const { state, services } = this;
    const list = services.byId("material-selector-list");
    this.materialPreviewObserver?.disconnect();
    this.materialPreviewObserver = null;
    const materials = [...state.materialFiles.values()]
      .sort((left, right) =>
        (left.data.name || left.id).localeCompare(right.data.name || right.id)
      );
    if (!materials.length) {
      list.replaceChildren(services.element(
        "p",
        "material-selector-empty",
        "No reusable Materials are available in this project."
      ));
      return;
    }
    const previewLayouts = [];
    list.replaceChildren(...materials.map((material, index) => {
      const item = services.element("article", "material-selector-item");
      const addButton = services.element("button", "material-selector-add");
      addButton.type = "button";
      addButton.setAttribute(
        "aria-label",
        state.viewingMaterialFile
          ? `Edit Material ${material.data.name || material.id}`
          : `Add Material ${material.data.name || material.id} to the current Screen`
      );
      const preview = services.element("div", "material-selector-preview");
      const previewCanvas = services.element("div", "material-selector-preview-canvas");
      const size = getMaterialPreviewSize(material);
      if (!size) throw new Error(`Material "${material.file}" has no supported preview size.`);
      const placementSize = getMaterialDefaultSize(material.data.type);
      if (!placementSize) {
        throw new Error(`Material "${material.file}" has no supported placement size.`);
      }
      const scale = Math.min(1, 160 / size.width, 68 / size.height);
      const viewport = services.element("div", "material-selector-preview-viewport");
      viewport.style.width = `${size.width * scale}px`;
      viewport.style.height = `${size.height * scale}px`;
      previewCanvas.id = `material-selector-preview-${index}`;
      previewCanvas.classList.add("material-instance");
      previewCanvas.style.width = `${size.width}px`;
      previewCanvas.style.height = `${size.height}px`;
      previewCanvas.style.left = "0px";
      previewCanvas.style.top = "0px";
      previewCanvas.style.transform = `scale(${scale})`;
      const attributes = Object.fromEntries(
        Object.entries(material.data.attributes || {})
          .filter(([, attribute]) =>
            attribute.overridable === true && Object.hasOwn(attribute, "default")
          )
          .map(([name, attribute]) => [name, attribute.default])
      );
      services.templateMarkupRenderer.mount(
        previewCanvas,
        material.html,
        material.base,
        { id: material.id, src: material.file, size, attributes },
        material
      );
      viewport.append(previewCanvas);
      preview.append(viewport);
      const heading = services.element("div", "material-selector-item-heading");
      heading.append(
        services.element("div", "material-selector-item-name", material.data.name || material.id),
        services.element("div", "material-selector-item-meta", `${size.width} x ${size.height}`)
      );
      this.bindMaterialDragButton(addButton, material.file, placementSize);
      addButton.append(preview, heading);
      previewLayouts.push({ preview, viewport, previewCanvas, size });
      addButton.addEventListener("click", () =>
        this.handleMaterialSelectorClick(material.file)
      );
      item.append(addButton);
      item.addEventListener("contextmenu", (event) =>
        this.openMaterialContextMenu(event, material.file)
      );
      return item;
    }));
    for (const layout of previewLayouts) this.fitMaterialSelectorPreview(layout);
    const ResizeObserverClass = services.window?.ResizeObserver;
    if (ResizeObserverClass) {
      const layoutsByPreview = new Map(
        previewLayouts.map((layout) => [layout.preview, layout])
      );
      this.materialPreviewObserver = new ResizeObserverClass((entries) => {
        for (const entry of entries) {
          const layout = layoutsByPreview.get(entry.target);
          if (layout) this.fitMaterialSelectorPreview(layout);
        }
      });
      for (const layout of previewLayouts) {
        this.materialPreviewObserver.observe(layout.preview);
      }
    }
  }

  /** Scales a selector preview to fit its available width and height. */
  fitMaterialSelectorPreview({ preview, viewport, previewCanvas, size }) {
    const availableWidth = Math.min(160, preview.clientWidth || 160);
    const scale = Math.min(1, availableWidth / size.width, 68 / size.height);
    viewport.style.width = `${size.width * scale}px`;
    viewport.style.height = `${size.height * scale}px`;
    previewCanvas.style.left = "0px";
    previewCanvas.style.top = "0px";
    previewCanvas.style.transform = `scale(${scale})`;
  }

  /** Binds pointer-drag placement to the Material selector. */
  bindMaterialDrag() {
    if (this.materialDragBound) return;
    const { document } = this.services;
    const drag = this.materialDrag;
    const outline = this.services.element("div", "material-drop-outline");
    outline.setAttribute("aria-hidden", "true");
    outline.hidden = true;
    this.materialDropOutline = outline;
    document.addEventListener("pointermove", (event) =>
      this.moveMaterialDrag(event, drag, outline)
    );
    document.addEventListener("pointerup", (event) =>
      this.finishMaterialDrag(event, drag, outline)
    );
    document.addEventListener("pointercancel", () =>
      this.cancelMaterialDrag(drag, outline)
    );
    this.materialDragBound = true;
  }

  /** Binds a selector tile to the shared Material drag controller. */
  bindMaterialDragButton(button, filePath, size) {
    this.bindMaterialDrag();
    const drag = this.materialDrag;
    const outline = this.materialDropOutline;
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !Number.isFinite(event.clientX) ||
          !Number.isFinite(event.clientY)) return;
      drag.pointerId = event.pointerId;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.active = false;
      drag.filePath = filePath;
      drag.size = size;
    });
  }

  /** Starts and updates the selector drag preview over the Screen canvas. */
  moveMaterialDrag(event, drag, outline) {
    if (drag.pointerId === null || event.pointerId !== drag.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.active && Math.hypot(deltaX, deltaY) < 5) return;
    drag.active = true;
    const geometry = this.services.getMaterialDropGeometry(
      event.clientX,
      event.clientY,
      drag.size
    );
    if (!geometry.inside) {
      outline.hidden = true;
      return;
    }
    if (!outline.isConnected) this.services.byId("screen-preview").append(outline);
    outline.hidden = false;
    outline.style.left = `${geometry.outline.left}px`;
    outline.style.top = `${geometry.outline.top}px`;
    outline.style.width = `${geometry.outline.width}px`;
    outline.style.height = `${geometry.outline.height}px`;
  }

  /** Completes a Material selector drag over the Screen canvas. */
  async finishMaterialDrag(event, drag, outline) {
    if (drag.pointerId === null || event.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    const geometry = wasActive
      ? this.services.getMaterialDropGeometry(event.clientX, event.clientY, drag.size)
      : null;
    drag.pointerId = null;
    drag.active = false;
    outline.hidden = true;
    if (!wasActive) return;
    this.suppressNextMaterialClick = true;
    this.services.window.setTimeout(() => {
      this.suppressNextMaterialClick = false;
    }, 0);
    if (!geometry?.inside) return;
    await this.services.placeMaterialFile(drag.filePath, geometry.position).catch((error) =>
      this.services.showEditorMessage("Could not add Material", error.message || String(error))
    );
  }

  /** Cancels a Material selector drag without placing it. */
  cancelMaterialDrag(drag, outline) {
    drag.pointerId = null;
    drag.active = false;
    outline.hidden = true;
  }

  /** Places a Material on the Screen or opens it when Material authoring is active. */
  handleMaterialSelectorClick(filePath) {
    if (this.suppressNextMaterialClick) {
      this.suppressNextMaterialClick = false;
      return;
    }
    if (!this.state.viewingMaterialFile) {
      return this.services.placeMaterialFile(filePath).catch((error) =>
        this.services.showEditorMessage("Could not add Material", error.message || String(error))
      );
    }
    if (this.state.activeMaterialFilePath === filePath) return;
    return this.services.renderMaterialFile(filePath).catch((error) =>
      this.services.showEditorMessage("Could not open Material", error.message || String(error))
    );
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
    services.byId("screen-selector-current").textContent =
      state.screens[state.activeScreenIndex]?.data.name ||
      state.screens[state.activeScreenIndex]?.id ||
      "Choose Screen";
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
        services.selectScreenManually(index).catch(services.showFatalError);
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
    if (action.kind === "screen") return services.selectScreenManually(action.screenIndex);
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
