export class ScreenMaterialRenderer {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  render(material, index) {
    const { state, services } = this;
    const definition = state.materialFiles.get(material.src);
    if (!definition) {
      throw new Error(`Screen placement "${material.id}" references unavailable Material "${material.src}".`);
    }
    const host = services.document.createElement("div");
    host.className = "material-instance";
    host.id = `specux-material-${index}`;
    host.dataset.instancePath = JSON.stringify([index]);
    host.dataset.materialId = material.id;
    host.dataset.materialSrc = material.src;
    host.setAttribute("aria-label", `Material: ${definition.data.name}`);
    if (!state.isRenderOnly) {
      host.tabIndex = 0;
      host.setAttribute("role", "group");
    }
    if (!state.isRenderOnly && services.sameInstancePath(state.activeInstancePath, [index])) {
      host.classList.add("selected");
    }

    services.templateMarkupRenderer.mount(host, definition.html, definition.base, material, definition);
    if (!state.isRenderOnly) {
      host.addEventListener("click", () => services.selectInstance([index], null));
      host.addEventListener("focus", () => services.selectInstance([index], null));
    }
    return host;
  }
}
