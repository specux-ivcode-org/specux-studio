import { isScreenGroup } from "../../shared/ScreenGroups.mjs";

export class ScreenMaterialRenderer {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  render(material, index, path = [index]) {
    const { state, services } = this;
    const group = isScreenGroup(material);
    const editorInteractionsEnabled = !state.isRenderOnly &&
      !state.viewingWorkflow && !state.viewingTheme;
    const definition = group ? null : state.materialFiles.get(material.src);
    if (!group && !definition) {
      throw new Error(`Screen placement "${material.id}" references unavailable Material "${material.src}".`);
    }
    const host = services.document.createElement("div");
    host.className = `material-instance${group ? " material-group" : ""}`;
    host.id = `specux-material-${path.join("-")}`;
    host.dataset.instancePath = JSON.stringify(path);
    host.dataset.materialId = material.id;
    if (material.src) host.dataset.materialSrc = material.src;
    host.setAttribute("aria-label", group
      ? `Group: ${material.id}`
      : `Material: ${definition.data.name}`);
    if (editorInteractionsEnabled) {
      host.tabIndex = 0;
      host.setAttribute("role", "group");
    }
    const selectedPaths = state.activeInstancePaths || [state.activeInstancePath || []];
    if (!state.isRenderOnly && selectedPaths.some((selectedPath) =>
      services.sameInstancePath(selectedPath, path)
    )) {
      host.classList.add("selected");
    }

    if (group) {
      host.setAttribute("aria-label", `Group: ${material.id}`);
    } else {
      services.templateMarkupRenderer.mount(host, definition.html, definition.base, material, definition);
    }
    if (editorInteractionsEnabled) {
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
    return host;
  }
}
