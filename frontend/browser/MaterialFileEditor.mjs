import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";

export class MaterialFileEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async render(filePath) {
    const { state, services } = this;
    const material = state.materialFiles.get(filePath);
    if (!material) throw new Error(`Material file "${filePath}" is not available.`);
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = filePath;
    state.activeMaterialFilePath = filePath;
    state.viewingMaterialFile = true;
    state.viewingAssetTemplate = false;
    state.viewingTheme = false;
    state.viewingProject = false;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.activeAssetId = null;
    state.activeInstancePath = [];
    state.activeSpecPath = null;
    state.activeSpecInstancePath = [];
    clearTimeout(state.assetPreviewTimer);
    state.assetPreviewTimer = null;
    state.assetPreviewVersion += 1;
    services.hidePreviewStateControls();
    services.closeAssetContextMenu();
    services.updateScreenDomContext(null);
    services.byId("main").classList.remove("spec-editing");
    services.byId("main").classList.remove("screen-editing");
    services.byId("main").classList.add("asset-editing");
    services.byId("spec-editor-panel").hidden = true;
    services.byId("spec-source").oninput = null;
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.byId("screen-heading").textContent = `${material.data.name} Material`;
    services.byId("screen-stage").setAttribute(
      "aria-label",
      `${material.data.name} Material preview`
    );
    services.byId("breadcrumb").textContent = "Materials";
    services.byId("asset-document-editor-panel").hidden = false;
    services.setAssetViewMode("split");
    services.byId("asset-document-editor-heading").textContent =
      `${material.data.name} — ${filePath.split("/").pop()}`;
    const editor = services.byId("asset-document-source");
    editor.value = material.documentSource;
    editor.setAttribute("aria-label", `${material.data.name} Material source`);
    editor.oninput = () => this.handleSourceInput(material, editor.value);
    const error = state.invalidYamlFiles.get(filePath);
    this.setDocumentStatus(
      material,
      error ? `Invalid Material document: ${error}` : "",
      Boolean(error)
    );
    this.renderPreview(material);
    services.renderInspector();
  }

  handleSourceInput(material, source) {
    const { state, services } = this;
    material.documentSource = source;
    const filePath = material.file;
    const version = (material.parseVersion || 0) + 1;
    material.parseVersion = version;
    state.invalidYamlFiles.set(filePath, "Validating Material document...");
    this.setDocumentStatus(material, "Validating Material document...");
    services.markEdited(filePath);
    clearTimeout(material.parseTimer);
    material.parseTimer = setTimeout(() => {
      this.parseDocument(material, source, version).catch((error) => {
        if (version !== material.parseVersion) return;
        state.invalidYamlFiles.set(filePath, error.message || String(error));
        this.setDocumentStatus(
          material,
          `Invalid Material document: ${error.message || String(error)}`,
          true
        );
        services.updateSaveControls();
      });
    }, 250);
  }

  async parseDocument(material, source, version) {
    const { state, services } = this;
    const filePath = material.file;
    const { header, body } = services.validation.splitAssetDocument(source, filePath);
    const data = await services.parseYamlSource(header, `${filePath} front matter`);
    if (version !== material.parseVersion) return;
    services.validation.validateMaterialDocumentHeader(data, filePath);
    if (data.id !== material.id) throw new Error(`Material id must remain "${material.id}".`);
    services.validation.validateMaterialMarkup(body, filePath);
    services.validation.validateMaterialAttributeMarkup(data, body, filePath);
    material.data = data;
    material.html = body;
    material.documentSource = source;
    state.invalidYamlFiles.delete(filePath);
    this.setDocumentStatus(material, "Material document is valid.");
    services.renderNavigation();
    services.updateSaveControls();
    if (state.viewingMaterialFile && state.activeMaterialFilePath === filePath) {
      services.byId("screen-heading").textContent = `${data.name} Material`;
      services.byId("asset-document-editor-heading").textContent =
        `${data.name} — ${filePath.split("/").pop()}`;
      services.byId("asset-document-source").setAttribute(
        "aria-label",
        `${data.name} Material source`
      );
      this.renderPreview(material);
      services.renderInspector();
    }
  }

  setDocumentStatus(material, message, isError = false) {
    material.documentStatus = { message, isError };
    if (!this.state.viewingMaterialFile ||
        this.state.activeMaterialFilePath !== material.file) return;
    const status = this.services.byId("asset-document-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  renderPreview(material) {
    const { services } = this;
    const preview = services.byId("screen-preview");
    preview.className = "screen-preview";
    preview.setAttribute("aria-label", `${material.data.name} Material preview`);
    preview.replaceChildren();
    try {
      const sample = services.element("div", "form-content material-file-preview-sample");
      sample.id = `material-file-preview-${material.id}`;
      const dimensions = getMaterialDefaultSize(material.data.type);
      if (!dimensions) throw new Error(`Material "${material.file}" has an unsupported type.`);
      const instance = {
        attributes: Object.fromEntries(
          Object.entries(material.data.attributes || {})
            .filter(([, definition]) =>
              definition.overridable === true && Object.hasOwn(definition, "default")
            )
            .map(([name, definition]) => [name, definition.default])
        )
      };
      sample.style.width = `${dimensions.width}px`;
      sample.style.height = `${dimensions.height}px`;
      sample.style.padding = "0";
      preview.append(sample);
      services.templateMarkupRenderer.mount(
        sample,
        material.html,
        material.base,
        instance,
        material
      );
    } catch (error) {
      services.setPreviewMessage("error", error.message || String(error));
    }
  }
}
