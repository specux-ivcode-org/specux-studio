import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";

export class MaterialFileEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    const sourceEditor = services.byId("material-document-source");
    const sourceContainer = services.byId("material-source-container");
    const sourceHighlight = services.byId("material-source-highlight");
    if (sourceEditor && sourceContainer && sourceHighlight) {
      sourceEditor.addEventListener("scroll", () => {
        if (sourceHighlight.scrollTop !== sourceEditor.scrollTop) {
          sourceHighlight.scrollTop = sourceEditor.scrollTop;
        }
        if (sourceHighlight.scrollLeft !== sourceEditor.scrollLeft) {
          sourceHighlight.scrollLeft = sourceEditor.scrollLeft;
        }
      });
      sourceHighlight.addEventListener("scroll", () => {
        if (sourceEditor.scrollTop !== sourceHighlight.scrollTop) {
          sourceEditor.scrollTop = sourceHighlight.scrollTop;
        }
        if (sourceEditor.scrollLeft !== sourceHighlight.scrollLeft) {
          sourceEditor.scrollLeft = sourceHighlight.scrollLeft;
        }
      });
      const publishTextSelection = () => {
        if (this.state.viewingMaterialFile) this.services.publishSelection();
      };
      sourceEditor.addEventListener("select", publishTextSelection);
      sourceEditor.addEventListener("keyup", publishTextSelection);
      sourceEditor.addEventListener("mouseup", publishTextSelection);
      sourceEditor.addEventListener("input", publishTextSelection);
      sourceEditor.addEventListener("blur", () => {
        if (!this.state.viewingMaterialFile) return;
        this.renderSourceHighlight(true);
        this.services.publishSelection();
      });
    }
  }

  async render(filePath) {
    const { state, services } = this;
    const material = state.materialFiles.get(filePath);
    if (!material) throw new Error(`Material file "${filePath}" is not available.`);
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = filePath;
    state.activeMaterialFilePath = filePath;
    state.viewingMaterialFile = true;
    state.viewingTheme = false;
    state.viewingProject = false;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.activeInstancePath = [];
    state.activeSpecPath = null;
    state.activeSpecScreenFile = null;
    state.activeSpecInstancePath = [];
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
    state.previewVersion += 1;
    services.hidePreviewStateControls();
    services.updateScreenDomContext(null);
    services.byId("main").classList.remove("spec-editing");
    services.byId("main").classList.remove("screen-editing");
    services.byId("main").classList.add("material-editing");
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
    services.byId("material-document-editor-panel").hidden = false;
    services.setMaterialViewMode("split");
    services.byId("material-document-editor-heading").textContent =
      `${material.data.name} — ${filePath.split("/").pop()}`;
    const editor = services.byId("material-document-source");
    editor.value = material.documentSource;
    editor.setAttribute("aria-label", `${material.data.name} Material source`);
    editor.oninput = () => this.handleSourceInput(material, editor.value);
    this.renderSourceHighlight();
    const error = state.invalidYamlFiles.get(filePath);
    this.setDocumentStatus(
      material,
      error ? `Invalid Material document: ${error}` : "",
      Boolean(error)
    );
    this.renderPreview(material);
    services.renderInspector();
  }

  renderSourceHighlight(preserveSelection = false) {
    const { state, services } = this;
    const highlight = services.byId("material-source-highlight");
    const sourceEditor = services.byId("material-document-source");
    if (!highlight || !sourceEditor) return;

    const scrollTop = preserveSelection && Number.isFinite(sourceEditor.scrollTop)
      ? sourceEditor.scrollTop
      : highlight.scrollTop;
    const scrollLeft = preserveSelection && Number.isFinite(sourceEditor.scrollLeft)
      ? sourceEditor.scrollLeft
      : highlight.scrollLeft;
    const material = state.materialFiles.get(state.activeMaterialFilePath);
    const storedSource = material?.documentSource || "";
    const source = preserveSelection ? sourceEditor.value : storedSource;
    const selectionStart = preserveSelection && Number.isInteger(sourceEditor.selectionStart)
      ? sourceEditor.selectionStart
      : -1;
    const selectionEnd = preserveSelection && Number.isInteger(sourceEditor.selectionEnd)
      ? sourceEditor.selectionEnd
      : -1;
    const hasSelection = selectionStart >= 0 &&
      selectionEnd > selectionStart &&
      selectionEnd <= source.length;
    const { ownerDocument } = highlight;
    highlight.replaceChildren();
    let lineOffset = 0;
    for (const text of source.split(/\r?\n/)) {
      const line = ownerDocument.createElement("span");
      line.className = "material-source-line";
      const selectedOnLine = hasSelection &&
        selectionStart < lineOffset + text.length &&
        selectionEnd > lineOffset;
      if (selectedOnLine) {
        const boundaries = [0, text.length];
        for (const offset of [selectionStart, selectionEnd]) {
          if (offset > lineOffset && offset < lineOffset + text.length) {
            boundaries.push(offset - lineOffset);
          }
        }
        boundaries.sort((left, right) => left - right);
        const uniqueBoundaries = [...new Set(boundaries)];
        for (let index = 0; index < uniqueBoundaries.length - 1; index += 1) {
          const start = uniqueBoundaries[index];
          const end = uniqueBoundaries[index + 1];
          const segment = ownerDocument.createElement("span");
          if (hasSelection &&
              selectionStart < lineOffset + end &&
              selectionEnd > lineOffset + start) {
            segment.className = "material-source-text-selection";
          }
          segment.textContent = text.slice(start, end);
          line.append(segment);
        }
      } else {
        line.textContent = text;
      }
      highlight.append(line);
      const lineEnd = lineOffset + text.length;
      const separator = source.slice(lineEnd).match(/^\r\n|^\r|\n/)?.[0] || "";
      lineOffset = lineEnd + separator.length;
    }
    if (preserveSelection) {
      highlight.scrollTop = scrollTop;
      highlight.scrollLeft = scrollLeft;
    }
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
    const { header, body } = services.validation.splitMaterialDocument(source, filePath);
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
      services.byId("material-document-editor-heading").textContent =
        `${data.name} — ${filePath.split("/").pop()}`;
      services.byId("material-document-source").setAttribute(
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
    const status = this.services.byId("material-document-status");
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
