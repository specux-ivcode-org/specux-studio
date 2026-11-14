import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";
import {
  getMaterialPreviewFrame,
  getMaterialPreviewSize
} from "./MaterialPreviewFrame.mjs";

const MIN_PREVIEW_SIZE = 24;
const PREVIEW_RESIZE_DIRECTIONS = ["e", "s", "se"];
const SELECTOR_FRAME_DIRECTIONS = [
  "n", "ne", "e", "se", "s", "sw", "w", "nw"
];

/** Manages Material source editing, preview framing, and source highlighting. */
export class MaterialFileEditor {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.selectedPreviewFilePath = null;
    this.previewResizeGesture = null;
    this.selectorFrameEditing = false;
    this.selectorFrameGesture = null;
    services.byId("material-selector-frame-toggle")?.addEventListener(
      "click",
      () => this.toggleSelectorFrameEditing()
    );
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

      /** Publishes the text selection for the current editor state. */
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

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  async render(filePath) {
    const { state, services } = this;
    const material = state.materialFiles.get(filePath);
    if (!material) throw new Error(`Material file "${filePath}" is not available.`);
    this.selectedPreviewFilePath = null;
    this.previewResizeGesture = null;
    this.selectorFrameGesture = null;
    this.selectorFrameEditing = false;
    this.updateSelectorFrameToggle();
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
    services.centerMaterialCanvas();
    services.renderInspector();
  }

  /** Renders the source highlight from the current editor data. */
  renderSourceHighlight(preserveSelection = false) {
    const { state, services } = this;
    const highlight = services.byId("material-source-highlight");
    const sourceEditor = services.byId("material-document-source");
    if (!highlight || !sourceEditor) return;
    const renderState = this.getHighlightRenderState(highlight, sourceEditor, preserveSelection);
    highlight.replaceChildren();
    this.renderHighlightedLines(highlight, renderState);
    this.restoreHighlightScroll(highlight, renderState);
  }

  /** Returns the highlight render state. */
  getHighlightRenderState(highlight, sourceEditor, preserveSelection) {
    const material = this.state.materialFiles.get(this.state.activeMaterialFilePath);
    const source = preserveSelection
      ? sourceEditor.value
      : material?.documentSource || "";
    return {
      source,
      preserveSelection,
      scrollTop: preserveSelection && Number.isFinite(sourceEditor.scrollTop)
        ? sourceEditor.scrollTop
        : highlight.scrollTop,
      scrollLeft: preserveSelection && Number.isFinite(sourceEditor.scrollLeft)
        ? sourceEditor.scrollLeft
        : highlight.scrollLeft,
      selectionStart: this.getSelectionOffset(sourceEditor, "selectionStart", preserveSelection),
      selectionEnd: this.getSelectionOffset(sourceEditor, "selectionEnd", preserveSelection)
    };
  }

  /** Returns the selection offset. */
  getSelectionOffset(sourceEditor, property, preserveSelection) {
    return preserveSelection && Number.isInteger(sourceEditor[property])
      ? sourceEditor[property]
      : -1;
  }

  /** Renders the highlighted lines from the current editor data. */
  renderHighlightedLines(highlight, renderState) {
    const { source, selectionStart, selectionEnd } = renderState;
    const hasSelection = selectionStart >= 0 && selectionEnd > selectionStart &&
      selectionEnd <= source.length;
    let lineOffset = 0;
    for (const text of source.split(/\r?\n/)) {
      const line = highlight.ownerDocument.createElement("span");
      line.className = "material-source-line";
      if (this.isSelectionOnLine(hasSelection, selectionStart, selectionEnd, lineOffset, text)) {
        this.renderSelectedLine(line, text, selectionStart, selectionEnd, lineOffset);
      } else {
        line.textContent = text;
      }
      highlight.append(line);
      lineOffset = this.getNextLineOffset(source, lineOffset, text.length);
    }
  }

  /** Checks whether the text selection overlaps the requested source line. */
  isSelectionOnLine(hasSelection, selectionStart, selectionEnd, lineOffset, text) {
    return hasSelection &&
      selectionStart < lineOffset + text.length &&
      selectionEnd > lineOffset;
  }

  /** Renders the selected line from the current editor data. */
  renderSelectedLine(line, text, selectionStart, selectionEnd, lineOffset) {
    const boundaries = [0, text.length];
    for (const offset of [selectionStart, selectionEnd]) {
      if (offset > lineOffset && offset < lineOffset + text.length) {
        boundaries.push(offset - lineOffset);
      }
    }
    boundaries.sort((left, right) => left - right);
    const uniqueBoundaries = [...new Set(boundaries)];
    for (let index = 0; index < uniqueBoundaries.length - 1; index += 1) {
      this.appendSourceSegment(
        line, text, uniqueBoundaries[index], uniqueBoundaries[index + 1],
        selectionStart, selectionEnd, lineOffset
      );
    }
  }

  /** Adds the source segment for the current editor state. */
  appendSourceSegment(line, text, start, end, selectionStart, selectionEnd, lineOffset) {
    const segment = line.ownerDocument.createElement("span");
    if (selectionStart < lineOffset + end && selectionEnd > lineOffset + start) {
      segment.className = "material-source-text-selection";
    }
    segment.textContent = text.slice(start, end);
    line.append(segment);
  }

  /** Returns the next line offset. */
  getNextLineOffset(source, lineOffset, textLength) {
    const lineEnd = lineOffset + textLength;
    const separator = source.slice(lineEnd).match(/^\r\n|^\r|\n/)?.[0] || "";
    return lineEnd + separator.length;
  }

  /** Restores the highlight scroll for the current editor state. */
  restoreHighlightScroll(highlight, renderState) {
    if (!renderState.preserveSelection) return;
    highlight.scrollTop = renderState.scrollTop;
    highlight.scrollLeft = renderState.scrollLeft;
  }

  /** Handles source input events and applies the corresponding editor action. */
  handleSourceInput(material, source) {
    const { state, services } = this;
    material.documentSource = source;
    const filePath = material.file;
    const version = (material.parseVersion || 0) + 1;
    material.parseVersion = version;
    state.invalidYamlFiles.set(filePath, "Validating Material document...");
    this.setDocumentStatus(material, "Validating Material document...");
    services.markEdited(filePath, { coalesce: true });
    clearTimeout(material.parseTimer);
    material.parseTimer = setTimeout(() => {
      this.parseDocument(material, source, version).catch((error) => {
        if (version !== material.parseVersion) return;
        state.invalidYamlFiles.set(filePath, error.message || String(error));
        services.saveRecoveryDraft?.(
          filePath,
          source,
          error.message || String(error),
          "material"
        );
        this.setDocumentStatus(
          material,
          `Invalid Material document: ${error.message || String(error)}`,
          true
        );
        services.updateSaveControls();
      });
    }, 250);
  }

  /** Parses the document into structured editor data. */
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

  /** Sets the document status from the supplied data. */
  setDocumentStatus(material, message, isError = false) {
    material.documentStatus = { message, isError };
    if (!this.state.viewingMaterialFile ||
        this.state.activeMaterialFilePath !== material.file) return;
    const status = this.services.byId("material-document-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  /** Renders the preview from the current editor data. */
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
    if (sample && this.selectorFrameEditing) this.renderSelectorFrame(sample, material);
  }

  /** Handles preview pointer down events for the related editor control. */
  onPreviewPointerDown(event) {
    if (!this.state.viewingMaterialFile || event.button !== 0) return;
    if (this.selectorFrameEditing) {
      const frame = event.target?.closest?.(".material-selector-frame");
      if (frame) this.beginSelectorFrameGesture(event, frame);
      return;
    }
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

  /** Handles preview key down events for the related editor control. */
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

  /** Renders the preview selection from the current editor data. */
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

  /** Removes the preview selection for the current editor state. */
  removePreviewSelection() {
    const preview = this.services.byId("screen-preview");
    preview?.querySelector?.(".material-file-preview-selection")?.remove();
  }

  /** Updates the preview resize for the current editor state. */
  beginPreviewResize(event, handle) {
    const gesture = this.getPreviewResizeGesture(event, handle);
    if (!gesture) return;
    this.previewResizeGesture = gesture;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture?.(event.pointerId);
  }

  /** Returns the preview resize gesture. */
  getPreviewResizeGesture(event, handle) {
    const filePath = this.state.activeMaterialFilePath;
    const target = this.getPreviewResizeTarget(filePath, handle);
    if (!target) return;
    const { material, sample, size } = target;
    const bounds = sample.getBoundingClientRect();
    const scaleX = bounds.width / (sample.offsetWidth || bounds.width || 1);
    const scaleY = bounds.height / (sample.offsetHeight || bounds.height || 1);
    return {
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
  }

  /** Returns the preview resize target. */
  getPreviewResizeTarget(filePath, handle) {
    const material = this.state.materialFiles.get(filePath);
    if (!material || this.state.invalidYamlFiles?.has(filePath)) return null;
    const sample = handle.closest(".material-file-preview-sample");
    if (!sample) return null;
    const size = material.data["preview-size"] || getMaterialDefaultSize(material.data.type);
    return size ? { material, sample, size } : null;
  }

  /** Handles preview pointer move events for the related editor control. */
  onPreviewPointerMove(event) {
    const frameGesture = this.selectorFrameGesture;
    if (frameGesture && frameGesture.pointerId === event.pointerId) {
      this.updateSelectorFrameGesture(event, frameGesture);
      return;
    }
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

  /** Ends the preview resize for the current editor state. */
  endPreviewResize(event) {
    const frameGesture = this.selectorFrameGesture;
    if (frameGesture && frameGesture.pointerId === event.pointerId) {
      this.finishSelectorFrameGesture(event, frameGesture);
      return;
    }
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

  /** Toggles the distinct selector-frame editing mode. */
  toggleSelectorFrameEditing() {
    if (!this.state.viewingMaterialFile) return;
    this.selectorFrameEditing = !this.selectorFrameEditing;
    this.selectedPreviewFilePath = null;
    this.updateSelectorFrameToggle();
    const material = this.state.materialFiles.get(this.state.activeMaterialFilePath);
    if (material) this.renderPreview(material);
  }

  /** Updates the selector-frame editing control. */
  updateSelectorFrameToggle() {
    const toggle = this.services.byId("material-selector-frame-toggle");
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(this.selectorFrameEditing));
    toggle.textContent = this.selectorFrameEditing
      ? "Done framing"
      : "Edit selector frame";
  }

  /** Renders the project-level Material selector frame and its controls. */
  renderSelectorFrame(sample, material) {
    const selection = this.services.element(
      "div",
      "material-selector-frame-selection"
    );
    const frame = this.services.element("div", "material-selector-frame");
    const bounds = getMaterialPreviewFrame(this.state.project, material);
    this.setSelectorFrameElementBounds(frame, bounds);
    for (const direction of SELECTOR_FRAME_DIRECTIONS) {
      const handle = this.services.element("button", "material-selector-frame-handle");
      handle.type = "button";
      handle.dataset.direction = direction;
      handle.setAttribute("aria-label", `Resize selector frame from ${direction}`);
      const anchors = {
        n: ["50%", "0%"],
        ne: ["100%", "0%"],
        e: ["100%", "50%"],
        se: ["100%", "100%"],
        s: ["50%", "100%"],
        sw: ["0%", "100%"],
        w: ["0%", "50%"],
        nw: ["0%", "0%"]
      };
      handle.style.left = anchors[direction][0];
      handle.style.top = anchors[direction][1];
      frame.append(handle);
    }
    selection.append(frame);
    sample.append(selection);
  }

  /** Begins moving or resizing the selector frame. */
  beginSelectorFrameGesture(event, frameElement) {
    const target = this.getSelectorFrameGestureTarget(frameElement);
    if (!target) return;
    const { material, sample, size } = target;
    const handle = event.target?.closest?.(".material-selector-frame-handle");
    const { scaleX, scaleY } = this.getPreviewCanvasScale(sample);
    this.selectorFrameGesture = {
      pointerId: event.pointerId,
      target: handle || frameElement,
      frameElement,
      material,
      size,
      frame: getMaterialPreviewFrame(this.state.project, material),
      direction: handle?.dataset.direction || "move",
      startX: event.clientX,
      startY: event.clientY,
      scaleX: scaleX || 1,
      scaleY: scaleY || 1,
      changed: false
    };
    event.preventDefault();
    event.stopPropagation();
    this.selectorFrameGesture.target.setPointerCapture?.(event.pointerId);
  }

  /** Returns the Material, preview, and dimensions for a selector-frame gesture. */
  getSelectorFrameGestureTarget(frameElement) {
    const material = this.state.materialFiles.get(this.state.activeMaterialFilePath);
    const sample = frameElement.closest(".material-file-preview-sample");
    const size = material && getMaterialPreviewSize(material);
    return material && sample && size ? { material, sample, size } : null;
  }

  /** Returns the current canvas zoom scales for the supplied preview. */
  getPreviewCanvasScale(sample) {
    const bounds = sample.getBoundingClientRect();
    return {
      scaleX: bounds.width / (sample.offsetWidth || bounds.width || 1) || 1,
      scaleY: bounds.height / (sample.offsetHeight || bounds.height || 1) || 1
    };
  }

  /** Applies a pointer update to the active selector-frame gesture. */
  updateSelectorFrameGesture(event, gesture) {
    const deltaX = (event.clientX - gesture.startX) / gesture.scaleX;
    const deltaY = (event.clientY - gesture.startY) / gesture.scaleY;
    const next = this.getUpdatedSelectorFrame(gesture, deltaX, deltaY);
    if (this.sameSelectorFrame(next, gesture.frame)) return;
    gesture.currentFrame = next;
    gesture.changed = true;
    this.setSelectorFrameElementBounds(gesture.frameElement, next);
    event.preventDefault();
  }

  /** Returns selector-frame bounds after the current move or resize gesture. */
  getUpdatedSelectorFrame(gesture, deltaX, deltaY) {
    const { frame, size, direction } = gesture;
    if (direction === "move") {
      return {
        ...frame,
        x: this.clamp(Math.round(frame.x + deltaX), 0, size.width - frame.width),
        y: this.clamp(Math.round(frame.y + deltaY), 0, size.height - frame.height)
      };
    }
    let left = frame.x;
    let top = frame.y;
    let right = frame.x + frame.width;
    let bottom = frame.y + frame.height;
    if (direction.includes("w")) {
      left = this.clamp(Math.round(frame.x + deltaX), 0, right - MIN_PREVIEW_SIZE);
    }
    if (direction.includes("e")) {
      right = this.clamp(
        Math.round(frame.x + frame.width + deltaX),
        left + MIN_PREVIEW_SIZE,
        size.width
      );
    }
    if (direction.includes("n")) {
      top = this.clamp(Math.round(frame.y + deltaY), 0, bottom - MIN_PREVIEW_SIZE);
    }
    if (direction.includes("s")) {
      bottom = this.clamp(
        Math.round(frame.y + frame.height + deltaY),
        top + MIN_PREVIEW_SIZE,
        size.height
      );
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /** Finishes and persists a changed selector-frame gesture. */
  finishSelectorFrameGesture(event, gesture) {
    this.selectorFrameGesture = null;
    if (gesture.target.hasPointerCapture?.(event.pointerId)) {
      gesture.target.releasePointerCapture(event.pointerId);
    }
    if (!gesture.changed) return;
    const project = this.state.project;
    project["material-previews"] ||= {};
    project["material-previews"][gesture.material.id] = gesture.currentFrame;
    this.services.markEdited("project.yml");
    this.services.renderNavigation();
  }

  /** Sets the visible selector-frame bounds. */
  setSelectorFrameElementBounds(element, frame) {
    element.style.left = `${frame.x}px`;
    element.style.top = `${frame.y}px`;
    element.style.width = `${frame.width}px`;
    element.style.height = `${frame.height}px`;
  }

  /** Checks whether two selector frames have identical bounds. */
  sameSelectorFrame(left, right) {
    return ["x", "y", "width", "height"].every(
      (property) => left[property] === right[property]
    );
  }

  /** Restricts a value to the supplied inclusive bounds. */
  clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  /** Rewrites Material preview-size values while retaining other source text. */
  updatePreviewSizeSource(source, filePath, size) {
    const { validation } = this.services;
    const { header, body } = validation.splitMaterialDocument(source, filePath);
    const lines = header.split(/\r?\n/);
    const propertyIndex = lines.findIndex((line) => /^\s*preview-size\s*:/.test(line));
    this.writePreviewSize(lines, propertyIndex, size);
    return validation.formatMaterialDocument(lines.join("\n"), body);
  }

  /** Updates or inserts the preview-size declaration in the Material source. */
  writePreviewSize(lines, propertyIndex, size) {
    if (propertyIndex < 0) {
      lines.push(
        "preview-size:",
        `  width: ${size.width}`,
        `  height: ${size.height}`
      );
      return;
    }
    const line = lines[propertyIndex];
    const inline = line.match(/^(\s*preview-size\s*:\s*)\{[^}]*\}(\s*(?:#.*)?)$/);
    if (inline) {
      lines[propertyIndex] =
        `${inline[1]}{ width: ${size.width}, height: ${size.height} }${inline[2]}`;
      return;
    }
    this.writePreviewSizeBlock(lines, propertyIndex, size);
  }

  /** Writes dimensions into an existing or newly created preview-size block. */
  writePreviewSizeBlock(lines, propertyIndex, size) {
    const end = this.findPreviewSizeBlockEnd(lines, propertyIndex);
    const found = this.updatePreviewSizeDimensions(lines, propertyIndex, end, size);
    const missing = [];
    if (!found.width) missing.push(`${found.indent}width: ${size.width}`);
    if (!found.height) missing.push(`${found.indent}height: ${size.height}`);
    lines.splice(end, 0, ...missing);
  }

  /** Finds the end of the preview-size mapping without consuming the next top-level key. */
  findPreviewSizeBlockEnd(lines, propertyIndex) {
    let end = propertyIndex + 1;
    while (end < lines.length &&
        (!lines[end].trim() || /^\s/.test(lines[end]) || /^\s*#/.test(lines[end]))) {
      end += 1;
    }
    return end;
  }

  /** Updates the preview size dimensions to reflect the latest editor state. */
  updatePreviewSizeDimensions(lines, propertyIndex, end, size) {
    const found = { width: false, height: false, indent: "  " };
    for (let index = propertyIndex + 1; index < end; index += 1) {
      const child = lines[index].match(/^(\s+)(width|height)(\s*:\s*)([^#]*?)(\s+#.*)?$/);
      if (child) this.updatePreviewSizeDimension(lines, index, child, size, found);
    }
    return found;
  }

  /** Updates the preview size dimension to reflect the latest editor state. */
  updatePreviewSizeDimension(lines, index, match, size, found) {
    const [, indent, property, separator, , comment = ""] = match;
    found.indent = indent;
    lines[index] = `${indent}${property}${separator}${size[property]}${comment}`;
    found[property] = true;
  }

  /** Dispatches the preview resize event for the current editor state. */
  dispatchPreviewResizeEvent() {
    const EventClass = this.services.window?.Event || globalThis.Event;
    const preview = this.services.byId("screen-preview");
    if (EventClass && preview) {
      preview.dispatchEvent(new EventClass("material-preview-resized"));
    }
  }
}
