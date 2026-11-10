import { isScreenGroup } from "../../shared/ScreenGroups.mjs";

/** Renders Screen Material placements and their visual states. */
export class ScreenMaterialRenderer {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  render(material, index, path = [index]) {
    const { state, services } = this;
    const group = isScreenGroup(material);
    const definition = this.getMaterialDefinition(material, group);
    const host = this.createHost(material, path, group);
    this.configureHostSemantics(host, material, group, definition);
    this.markHostSelection(host, path);
    this.renderHostContent(host, material, group, definition);
    this.bindHostInteractions(host, material, path);
    return host;
  }

  /** Returns the loaded Material definition for a placement source path. */
  getMaterialDefinition(material, group) {
    if (group) return null;
    const definition = this.state.materialFiles.get(material.src);
    if (!definition) {
      throw new Error(`Screen placement "${material.id}" references unavailable Material "${material.src}".`);
    }
    return definition;
  }

  /** Creates the canvas host that receives a rendered Material instance. */
  createHost(material, path, group) {
    const host = this.services.document.createElement("div");
    host.className = `material-instance${group ? " material-group" : ""}`;
    host.id = `specux-material-${path.join("-")}`;
    host.dataset.instancePath = JSON.stringify(path);
    host.dataset.materialId = material.id;
    if (material.src) host.dataset.materialSrc = material.src;
    return host;
  }

  /** Updates the host semantics for the current editor state. */
  configureHostSemantics(host, material, group, definition) {
    const editorInteractionsEnabled = this.areEditorInteractionsEnabled();
    host.setAttribute("aria-label", group
      ? `Group: ${material.id}`
      : `Material: ${definition.data.name}`);
    if (editorInteractionsEnabled) {
      host.tabIndex = 0;
      host.setAttribute("role", "group");
    }
  }

  /** Checks whether editor interactions are enabled for the active view. */
  areEditorInteractionsEnabled() {
    const { state } = this;
    return !state.isRenderOnly && !state.viewingWorkflow && !state.viewingTheme;
  }

  /** Marks the host selection for the current editor state. */
  markHostSelection(host, path) {
    const { state, services } = this;
    const selectedPaths = state.activeInstancePaths || [state.activeInstancePath || []];
    if (!state.isRenderOnly && selectedPaths.some((selectedPath) =>
      services.sameInstancePath(selectedPath, path)
    )) {
      host.classList.add("selected");
    }
  }

  /** Renders the host content from the current editor data. */
  renderHostContent(host, material, group, definition) {
    if (group) {
      host.setAttribute("aria-label", `Group: ${material.id}`);
      return;
    }
    this.services.templateMarkupRenderer.mount(
      host, definition.html, definition.base, material, definition
    );
  }

  /** Registers event listeners for host interactions interactions. */
  bindHostInteractions(host, material, path) {
    if (!this.areEditorInteractionsEnabled()) return;
    const { state, services } = this;
    host.addEventListener("click", (event) => {
      if (event?.detail > 0 && !state.viewingSpec) return;
      event?.stopPropagation?.();
      services.selectInstance(path, material.src || null, {
        toggle: Boolean(event?.ctrlKey)
      });
    });
    host.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      services.selectInstance(path, material.src || null);
    });
  }
}
