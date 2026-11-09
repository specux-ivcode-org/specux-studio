import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";

const MIN_PREVIEW_SIZE = 24;
const PREVIEW_RESIZE_DIRECTIONS = ["e", "s", "se"];

export class MaterialFileEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.selectedPreviewFilePath = null;
    this.previewResizeGesture = null;
    const preview = services.byId("screen-preview");
    preview?.addEventListener("pointerdown", (event) => this.onPreviewPointerDown(event));
    preview?.addEventListener("pointermove", (event) => this.onPreviewPointerMove(event));
    preview?.addEventListener("pointerup", (event) => this.endPreviewResize(event));
    preview?.addEventListener("pointercancel", (event) => this.endPreviewResize(event));
    preview?.addEventListener("keydown", (event) => this.onPreviewKeyDown(event));
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
    this.selectedPreviewFilePath = null;
    this.previewResizeGesture = null;
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
    let sample;
    try {
      sample = services.element("div", "form-content material-file-preview-sample");
      sample.id = `material-file-preview-${material.id}`;
      sample.tabIndex = 0;
      sample.setAttribute("role", "group");
      sample.setAttribute("aria-label", `${material.data.name} Material preview; select to resize`);
      const dimensions = material.data["preview-size"] ||
        getMaterialDefaultSize(material.data.type);
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
    if (sample && this.selectedPreviewFilePath === material.file) {
      this.renderPreviewSelection(sample);
    }
  }

  onPreviewPointerDown(event) {
    if (!this.state.viewingMaterialFile || event.button !== 0) return;
    const resizeHandle = event.target?.closest?.(".material-file-preview-resize-control");
    if (resizeHandle) {
      this.beginPreviewResize(event, resizeHandle);
      return;
    }
    const sample = event.target?.closest?.(".material-file-preview-sample");
    if (sample) {
      this.selectedPreviewFilePath = this.state.activeMaterialFilePath;
      this.renderPreviewSelection(sample);
      return;
    }
    this.selectedPreviewFilePath = null;
    this.removePreviewSelection();
  }

  onPreviewKeyDown(event) {
    if (!this.state.viewingMaterialFile) return;
    if (event.key === "Escape" && this.selectedPreviewFilePath) {
      this.selectedPreviewFilePath = null;
      this.removePreviewSelection();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const sample = event.target?.closest?.(".material-file-preview-sample");
    if (!sample) return;
    event.preventDefault();
    this.selectedPreviewFilePath = this.state.activeMaterialFilePath;
    this.renderPreviewSelection(sample);
  }

  renderPreviewSelection(sample) {
    if (sample.querySelector(":scope > .material-file-preview-selection")) return;
    const selection = this.services.document.createElement("div");
    selection.className = "material-file-preview-selection";
    const outline = this.services.document.createElement("div");
    outline.className = "material-file-preview-selection-outline";
    selection.append(outline);
    const anchors = {
      e: { left: "100%", top: "50%" },
      s: { left: "50%", top: "100%" },
      se: { left: "100%", top: "100%" }
    };
    for (const direction of PREVIEW_RESIZE_DIRECTIONS) {
      const handle = this.services.document.createElement("button");
      handle.type = "button";
      handle.className =
        "material-control material-resize-control material-file-preview-resize-control";
      handle.dataset.resizeDirection = direction;
      handle.setAttribute("aria-label", `Resize Material preview from ${direction}`);
      handle.style.left = anchors[direction].left;
      handle.style.top = anchors[direction].top;
      handle.style.transform = "translate(-50%, -50%)";
      selection.append(handle);
    }
    sample.append(selection);
  }

  removePreviewSelection() {
    const preview = this.services.byId("screen-preview");
    preview?.querySelector?.(".material-file-preview-selection")?.remove();
  }

  beginPreviewResize(event, handle) {
    const filePath = this.state.activeMaterialFilePath;
    const material = this.state.materialFiles.get(filePath);
    if (!material || this.state.invalidYamlFiles?.has(filePath)) return;
    const sample = handle.closest(".material-file-preview-sample");
    if (!sample) return;
    const size = material.data["preview-size"] || getMaterialDefaultSize(material.data.type);
    if (!size) return;
    const bounds = sample.getBoundingClientRect();
    const scaleX = bounds.width / (sample.offsetWidth || bounds.width || 1);
    const scaleY = bounds.height / (sample.offsetHeight || bounds.height || 1);
    this.previewResizeGesture = {
      pointerId: event.pointerId,
      handle,
      sample,
      material,
      direction: handle.dataset.resizeDirection,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: size.width,
      startHeight: size.height,
      width: size.width,
      height: size.height,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      changed: false
    };
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture?.(event.pointerId);
  }

  onPreviewPointerMove(event) {
    const gesture = this.previewResizeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - gesture.startX) / gesture.scaleX;
    const deltaY = (event.clientY - gesture.startY) / gesture.scaleY;
    const width = Math.max(
      MIN_PREVIEW_SIZE,
      Math.round(gesture.startWidth + (gesture.direction.includes("e") ? deltaX : 0))
    );
    const height = Math.max(
      MIN_PREVIEW_SIZE,
      Math.round(gesture.startHeight + (gesture.direction.includes("s") ? deltaY : 0))
    );
    if (width === gesture.width && height === gesture.height) return;
    gesture.width = width;
    gesture.height = height;
    gesture.changed = true;
    gesture.sample.style.width = `${width}px`;
    gesture.sample.style.height = `${height}px`;
    event.preventDefault();
    this.dispatchPreviewResizeEvent();
  }

  endPreviewResize(event) {
    const gesture = this.previewResizeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.previewResizeGesture = null;
    if (gesture.handle.hasPointerCapture?.(event.pointerId)) {
      gesture.handle.releasePointerCapture(event.pointerId);
    }
    if (!gesture.changed) return;
    const sourceEditor = this.services.byId("material-document-source");
    const source = sourceEditor?.value ?? gesture.material.documentSource;
    const updatedSource = this.updatePreviewSizeSource(source, gesture.material.file, {
      width: gesture.width,
      height: gesture.height
    });
    if (sourceEditor) sourceEditor.value = updatedSource;
    this.renderSourceHighlight(true);
    this.handleSourceInput(gesture.material, updatedSource);
    this.dispatchPreviewResizeEvent();
  }

  updatePreviewSizeSource(source, filePath, size) {
    const { validation } = this.services;
    const { header, body } = validation.splitMaterialDocument(source, filePath);
    const lines = header.split(/\r?\n/);
    const propertyIndex = lines.findIndex((line) => /^\s*preview-size\s*:/.test(line));
    if (propertyIndex < 0) {
      lines.push(
        "preview-size:",
        `  width: ${size.width}`,
        `  height: ${size.height}`
      );
    } else {
      const line = lines[propertyIndex];
      const inline = line.match(/^(\s*preview-size\s*:\s*)\{[^}]*\}(\s*(?:#.*)?)$/);
      if (inline) {
        lines[propertyIndex] =
          `${inline[1]}{ width: ${size.width}, height: ${size.height} }${inline[2]}`;
      } else {
        let end = propertyIndex + 1;
        while (end < lines.length &&
            (!lines[end].trim() || /^\s/.test(lines[end]) || /^\s*#/.test(lines[end]))) {
          end += 1;
        }
        let widthFound = false;
        let heightFound = false;
        let childIndent = "  ";
        for (let index = propertyIndex + 1; index < end; index += 1) {
          const child = lines[index].match(/^(\s+)(width|height)(\s*:\s*)([^#]*?)(\s+#.*)?$/);
          if (!child) continue;
          childIndent = child[1];
          if (child[2] === "width") {
            lines[index] = `${child[1]}${child[2]}${child[3]}${size.width}${child[5] || ""}`;
            widthFound = true;
          } else {
            lines[index] = `${child[1]}${child[2]}${child[3]}${size.height}${child[5] || ""}`;
            heightFound = true;
          }
        }
        const missing = [];
        if (!widthFound) missing.push(`${childIndent}width: ${size.width}`);
        if (!heightFound) missing.push(`${childIndent}height: ${size.height}`);
        lines.splice(end, 0, ...missing);
      }
    }
    return validation.formatMaterialDocument(lines.join("\n"), body);
  }

  dispatchPreviewResizeEvent() {
    const EventClass = this.services.window?.Event || globalThis.Event;
    const preview = this.services.byId("screen-preview");
    if (EventClass && preview) {
      preview.dispatchEvent(new EventClass("material-preview-resized"));
    }
  }
}
