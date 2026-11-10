import {
  isScreenGroup,
  multiplyAffineMatrices,
  getScreenPlacementMatrix
} from "../../shared/ScreenGroups.mjs";

/** Renders the workspace view selected by the editor. */
export class WorkspaceViewRenderer {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  /** Renders the screen from the current editor data. */
  async renderScreen(index, options = {}) {
    const selected = this.state.screens[index];
    if (!selected) return;
    this.configureScreenView(index, selected, options);
    const content = this.createScreenPreview(selected);
    this.renderScreenContent(selected, content);
  }

  /** Updates the screen view for the current editor state. */
  configureScreenView(index, selected, options) {
    const { state, services } = this;
    const preserveTheme = options.preserveTheme === true;
    const preserveSpec = options.preserveSpec === true;
    if (!preserveSpec) services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = preserveTheme
      ? state.project?.theme
      : preserveSpec ? state.activeSpecPath : selected.file;
    this.resetScreenViewUi(preserveSpec, options.preserveWorkflow === true);
    state.activeScreenIndex = index;
    services.renderScreenSelector();
    services.projectFileTree.reveal(selected.file);
    this.setScreenViewState(selected, preserveTheme, preserveSpec, options);
    this.updateScreenViewPresentation(selected, preserveTheme, preserveSpec);
  }

  /** Resets the screen view ui for the current editor state. */
  resetScreenViewUi(preserveSpec, preserveWorkflow) {
    const { state, services } = this;
    services.closeScreenPlacementContextMenu();
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
    state.previewVersion += 1;
    const main = services.byId("main");
    main.classList.remove("material-editing");
    if (!preserveSpec) main.classList.remove("spec-editing");
    if (!preserveWorkflow) {
      main.classList.remove("workflow-editing");
      services.byId("workflow-editor-panel").hidden = true;
      services.byId("workflow-source").oninput = null;
    }
    main.classList.add("screen-editing");
    services.byId("material-document-editor-panel").hidden = true;
    services.byId("material-document-source").oninput = null;
    if (!preserveSpec) {
      services.byId("spec-editor-panel").hidden = true;
      services.byId("spec-source").oninput = null;
    }
  }

  /** Sets the screen view state from the supplied data. */
  setScreenViewState(selected, preserveTheme, preserveSpec, options) {
    const { state, services } = this;
    const preserveWorkflow = options.preserveWorkflow === true;
    state.viewingMaterialFile = false;
    state.viewingTheme = preserveTheme;
    state.viewingProject = false;
    state.viewingSpec = preserveSpec;
    state.viewingPreviewState = options.previewStateSelected === true;
    state.viewingWorkflow = preserveWorkflow;
    if (!preserveWorkflow) state.activeWorkflowPath = null;
    if (!preserveSpec) {
      state.activeSpecPath = null;
      state.activeSpecScreenFile = null;
      state.activeSpecInstancePath = [];
    }
    if (!preserveWorkflow && !preserveSpec) state.activeInstancePath = [];
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.updateScreenDomContext(selected);
  }

  /** Applies the selected Screen preview or YAML presentation mode. */
  updateScreenViewPresentation(selected, preserveTheme, preserveSpec) {
    const { state, services } = this;
    services.byId("screen-heading").textContent = preserveTheme
      ? "Theme"
      : preserveSpec ? `Spec: ${state.activeSpecPath}` : selected.data.name || selected.id;
    services.byId("breadcrumb").textContent = preserveTheme
      ? "Project theme"
      : preserveSpec ? "Behavior spec" : "Screens";
    services.renderPreviewStateControls(selected.data);
    services.configureScreenYamlEditor(selected);
    services.syncScreenViewMode();
  }

  /** Creates the Screen preview host and its selected-state content. */
  createScreenPreview(selected) {
    const { services } = this;
    const preview = services.byId("screen-preview");
    preview.className = "screen-preview";
    preview.setAttribute("aria-label", `${selected.data.name || selected.id} Screen preview`);
    preview.title = "Pan by dragging empty space, or anywhere in Workflow preview; middle mouse or Space+drag also pan. Zoom with the mouse wheel.";
    preview.replaceChildren();
    const content = services.element("div", "form-content");
    services.setScreenDomContext(content, selected);
    preview.append(content);
    return content;
  }

  /** Renders the screen content from the current editor data. */
  renderScreenContent(selected, content) {
    const { services } = this;
    try {
      if (!Array.isArray(selected.data.materials)) {
        throw new Error(`Screen "${selected.id}" materials must be a list.`);
      }
      if (selected.data.materials.length === 0) {
        services.byId("screen-stage").setAttribute(
          "aria-label",
          "Empty Screen preview; add materials using the sidebar"
        );
        content.append(services.element(
          "div",
          "empty-screen-drop-zone",
          "Select a Material file in the project tree to place it on this Screen."
        ));
        services.renderInspector();
        return;
      }
      services.byId("screen-stage").setAttribute(
        "aria-label",
        "Screen canvas with positioned materials"
      );
      const stateId = services.getActivePreviewStateId(selected.data);
      this.renderPlacements(selected, selected.data.materials, content, stateId, content);
      services.renderInspector();
    } catch (error) {
      services.setPreviewMessage("error", error.message);
      services.renderInspector();
    }
  }

  /** Renders the placements from the current editor data. */
  renderPlacements(
    screen,
    placements,
    parent,
    stateId,
    content,
    parentPath = [],
    parentTransform = { matrix: { a: 1, b: 0, c: 0, d: 1 } }
  ) {
    const { services } = this;
    for (const [placementIndex, basePlacement] of placements.entries()) {
      const path = [...parentPath, placementIndex];
      if (!this.isPlacementVisible(screen, basePlacement, path, stateId)) continue;
      const placement = services.resolvePlacementForState(basePlacement, stateId, screen.data);
      const host = services.renderMaterial(placement, placementIndex, path);
      const frame = services.createMaterialFrame(
        host, placement, placementIndex, parent, screen, path, parentTransform, content
      );
      parent.append(frame);
      if (isScreenGroup(placement)) {
        this.renderPlacements(
          screen,
          placement.children,
          host,
          stateId,
          content,
          path,
          { matrix: multiplyAffineMatrices(parentTransform.matrix, getScreenPlacementMatrix(placement)) }
        );
      }
    }
  }

  /** Checks whether the placement is visible in the active preview state. */
  isPlacementVisible(screen, placement, path, stateId) {
    if (!this.services.isInstanceVisible(placement, stateId, screen.data)) return false;
    if (path.length !== 1) return true;
    const layer = screen.data.layers?.find((entry) => entry.id === placement.layer);
    return this.services.isLayerVisible(layer, stateId, screen.data);
  }

  /** Renders the project overview from the current editor data. */
  renderProjectOverview() {
    const { state, services } = this;
    if (!state.project) return;
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = "project.yml";
    services.hidePreviewStateControls();
    services.closeScreenPlacementContextMenu();
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
    state.previewVersion += 1;
    services.byId("main").classList.remove("material-editing");
    services.byId("main").classList.remove("spec-editing");
    services.byId("main").classList.remove("workflow-editing");
    services.byId("workflow-editor-panel").hidden = true;
    services.byId("workflow-source").oninput = null;
    services.byId("material-document-editor-panel").hidden = true;
    services.byId("material-document-source").oninput = null;
    services.byId("spec-editor-panel").hidden = true;
    services.byId("spec-source").oninput = null;
    state.viewingMaterialFile = false;
    state.viewingTheme = false;
    state.viewingProject = true;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.viewingWorkflow = false;
    state.activeWorkflowPath = null;
    state.activeSpecPath = null;
    state.activeSpecScreenFile = null;
    state.activeSpecInstancePath = [];
    state.activeInstancePath = [];
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.updateScreenDomContext(null);
    services.byId("screen-stage").setAttribute("aria-label", "Project overview");
    services.byId("screen-heading").textContent = "Overview";
    services.byId("breadcrumb").textContent = "Project";
    const preview = services.byId("screen-preview");
    preview.className = "screen-preview project-overview-preview";
    preview.setAttribute("aria-label", "Project overview");
    preview.replaceChildren();

    const content = services.element("div", "project-overview-content");
    const hero = services.element("section", "project-overview-hero");
    hero.append(
      services.element("div", "project-overview-eyebrow", "PROJECT OVERVIEW"),
      services.element("h2", "project-overview-title", state.project.name || "Untitled project"),
      services.element(
        "p",
        "project-overview-description",
        state.project.description || "No project description has been provided."
      )
    );
    content.append(hero);

    const stats = services.element("div", "project-overview-stats");
    for (const [label, value] of [
      ["Screens", state.screens.length],
      ["Materials", state.screens.reduce((total, screen) => total + (screen.data.materials?.length || 0), 0)],
      ["Behavior specs", state.specSources.size]
    ]) {
      const stat = services.element("div", "project-overview-stat");
      stat.append(services.element("span", "project-overview-stat-label", label));
      stat.append(services.element("strong", "project-overview-stat-value", String(value)));
      stats.append(stat);
    }
    content.append(stats);

    const sections = services.element("div", "project-overview-sections");
    const screenSection = services.element("section", "project-overview-panel");
    screenSection.append(
      services.element("h3", "project-overview-section-title", "Screens")
    );
    if (state.screens.length) {
      const screenList = services.element("div", "project-overview-screen-list");
      state.screens.forEach((screen, index) => {
        const name = screen.data.name || screen.id;
        const screenButton = services.element("button", "project-overview-screen");
        screenButton.type = "button";
        screenButton.setAttribute("aria-label", `Open Screen ${name}`);
        screenButton.append(services.element("span", "project-overview-screen-name", name));
        screenButton.append(services.element("span", "project-overview-screen-id", screen.id));
        screenButton.append(services.element(
          "span",
          "project-overview-screen-description",
          screen.data.description || "No description provided."
        ));
        screenButton.addEventListener("click", () => services.renderScreen(index));
        screenList.append(screenButton);
      });
      screenSection.append(screenList);
    } else {
      screenSection.append(services.element(
        "p",
        "project-overview-empty",
        "No Screens are defined in this project."
      ));
    }
    sections.append(screenSection);

    const configuration = services.element("section", "project-overview-panel");
    configuration.append(
      services.element("h3", "project-overview-section-title", "Project configuration"),
      services.element("div", "project-overview-config-label", "Theme"),
      services.element(
        "div",
        "project-overview-config-value",
        state.theme?.name || "Not configured"
      ),
      services.element("div", "project-overview-config-label", "Behavior specs"),
      services.element(
        "div",
        "project-overview-config-value",
        `${state.specSources.size} attached`
      ),
      services.element("div", "project-overview-config-label", "Project manifest"),
      services.element("div", "project-overview-config-value", "specux/project.yml"),
      services.element("div", "project-overview-config-label", "Source of truth"),
      services.element(
        "p",
        "project-overview-config-note",
        "Project-wide specs cover behavior shared across Screens. Use a Screen-level spec for page behavior and Screen State activation."
      )
    );
    sections.append(configuration);
    content.append(sections);
    preview.append(content);
    services.renderInspector();
  }
}
