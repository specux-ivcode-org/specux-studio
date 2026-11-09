const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ANNOTATION_TOOLS = new Set(["pen", "circle", "rectangle", "arrow", "highlight", "note"]);
const DEFAULT_CANVAS_SIZE = { width: 1440, height: 900 };

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class ScreenAnnotationController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.screenId = null;
    this.context = null;
    this.activeFilePath = null;
    this.contextPreviewSizes = new Map();
    this.annotations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.tool = "pen";
    this.enabled = false;
    this.drawing = null;
    this.overlay = null;
    this.editorOverlays = new Map();
    this.editorTargets = new Map();
    this.editorResizeTargets = new Set();
    this.baseResizeTargets = new Set();
    this.renderWidth = DEFAULT_CANVAS_SIZE.width;
    this.renderHeight = DEFAULT_CANVAS_SIZE.height;
    this.loadVersion = 0;
    this.annotationRevision = 0;
    this.annotationUpdatedAt = null;
    this.saveQueue = Promise.resolve();
    this.sessionResetPromise = null;
  }

  bind() {
    const { services } = this;
    const preview = services.byId("screen-preview");
    const toolbar = services.byId("annotation-toolbar");
    services.byId("main").append(toolbar);
    preview.addEventListener("material-preview-resized", () => {
      if (this.context?.kind === "editor") this.render();
    });
    const ResizeObserverClass = services.window.ResizeObserver;
    if (ResizeObserverClass) {
      this.resizeObserver = new ResizeObserverClass(() => this.render());
      for (const target of [preview, services.byId("main")]) {
        this.baseResizeTargets.add(target);
        this.resizeObserver.observe(target);
      }
    }
    const MutationObserverClass = services.window.MutationObserver;
    if (MutationObserverClass) {
      this.previewMutationObserver = new MutationObserverClass(() => {
        if (this.context?.kind !== "editor") return;
        const targets = this.getEditorPreviewTargets();
        if (targets.some((target) =>
          this.editorOverlays.get(target.id)?.parentElement !== target.element
        )) {
          this.render();
        }
      });
      this.previewMutationObserver.observe(services.byId("main"), {
        childList: true,
        subtree: true
      });
    }
    services.document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.addEventListener("click", () => this.selectTool(button.dataset.annotationTool));
    });
    services.byId("annotation-mode-exit").addEventListener("click", () => this.setEnabled(false));
    services.byId("annotation-undo").addEventListener("click", () => this.undo());
    services.byId("annotation-redo").addEventListener("click", () => this.redo());
    services.byId("annotation-clear").addEventListener("click", () => this.clear());
    services.document.addEventListener("keydown", (event) => {
      if (!this.enabled) return;
      if (event.key === "Escape") {
        this.setEnabled(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      }
    });
    if (services.window.EventSource) {
      this.eventSource = new services.window.EventSource("/api/events");
      this.eventSource.addEventListener("annotations-updated", (event) => {
        let update;
        try {
          update = JSON.parse(event.data);
        } catch (error) {
          console.error("Could not read annotation update.", error);
          return;
        }
        if (!this.screenId || (update.screenId && update.screenId !== this.screenId)) return;
        this.refresh().catch((error) => this.reportError("Could not refresh annotations", error));
      });
    }
    this.updateControls();
  }

  getEditorAnnotationContext() {
    if (this.context?.kind !== "editor") return null;
    const previewSizes = this.contextPreviewSizes.get(this.context.key) || new Map();
    for (const target of this.getEditorPreviewTargets()) {
      previewSizes.set(target.id, {
        id: target.id,
        label: target.label,
        coordinateSpace: "preview content pixels",
        canvasSize: { width: target.width, height: target.height }
      });
    }
    this.contextPreviewSizes.set(this.context.key, previewSizes);
    const previews = [...previewSizes.values()];
    const canvasSize = previews.reduce((size, preview) => ({
      width: Math.max(size.width, preview.canvasSize.width),
      height: Math.max(size.height, preview.canvasSize.height)
    }), {
      width: Math.ceil(this.renderWidth),
      height: Math.ceil(this.renderHeight)
    });
    return {
      annotationContext: {
        key: this.context.key,
        view: this.context.view,
        type: this.context.type,
        file: this.context.file,
        mode: this.context.mode,
        coordinateSpace: "editor preview pixels",
        canvasSize,
        previews
      },
      annotations: this.annotations
    };
  }

  async fileLoaded(filePath) {
    const nextFilePath = filePath || null;
    if (nextFilePath === this.activeFilePath) return;
    this.activeFilePath = nextFilePath;
    this.context = null;
    this.screenId = null;
    this.contextPreviewSizes.clear();
    this.annotations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.drawing = null;
    this.enabled = false;
    this.annotationUpdatedAt = null;
    this.annotationRevision += 1;
    this.render();
    this.updateControls();
    this.sessionResetPromise = this.saveQueue.then(() =>
      this.clearPreviousSessionAnnotations()
    );
    await this.sessionResetPromise;
  }

  async setScreen(screen) {
    const nextScreenId = screen?.id || null;
    if (screen?.file) this.activeFilePath = screen.file;
    if (nextScreenId === this.screenId && this.context?.kind !== "editor") {
      this.context = nextScreenId
        ? { key: `screen:${nextScreenId}`, kind: "screen" }
        : null;
      this.render();
      this.updateControls();
      return;
    }
    this.contextPreviewSizes.delete(this.context?.key);
    this.screenId = nextScreenId;
    this.context = nextScreenId
      ? { key: `screen:${nextScreenId}`, kind: "screen" }
      : null;
    this.annotationRevision += 1;
    this.annotationUpdatedAt = null;
    this.enabled = false;
    this.drawing = null;
    this.annotations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.render();
    if (nextScreenId) {
      if (!this.sessionResetPromise) {
        this.sessionResetPromise = this.clearPreviousSessionAnnotations();
      }
      await this.sessionResetPromise;
      if (this.screenId === nextScreenId) await this.refresh();
    }
  }

  setEditorContext(context) {
    const key = context?.key || null;
    this.activeFilePath = context?.file || null;
    if (key === this.context?.key) {
      this.context = key ? { ...this.context, ...context, kind: "editor" } : null;
      this.render();
      this.updateControls();
      return;
    }
    this.contextPreviewSizes.delete(this.context?.key);
    this.screenId = null;
    this.context = key ? { ...context, kind: "editor" } : null;
    const main = key ? this.services.byId?.("main") : null;
    const rect = main?.getBoundingClientRect?.();
    this.annotations = [];
    this.renderWidth = Math.max(1, Math.ceil(rect?.width || DEFAULT_CANVAS_SIZE.width));
    this.renderHeight = Math.max(1, Math.ceil(rect?.height || DEFAULT_CANVAS_SIZE.height));
    this.undoStack = [];
    this.redoStack = [];
    this.enabled = false;
    this.drawing = null;
    this.render();
    this.updateControls();
  }

  async clearPreviousSessionAnnotations() {
    const response = await this.services.fetcher("/api/annotations", { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  }

  async refresh() {
    if (!this.screenId) return;
    const version = ++this.loadVersion;
    const response = await this.services.fetcher(
      `/api/annotations?screenId=${encodeURIComponent(this.screenId)}`
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (version !== this.loadVersion || result.screenId !== this.screenId) return;
    this.annotations = result.annotations;
    this.annotationUpdatedAt = result.updatedAt;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
    this.updateControls();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled && this.context);
    this.drawing = null;
    this.render();
    this.updateControls();
  }

  selectTool(tool) {
    if (!ANNOTATION_TOOLS.has(tool) || !this.context) return;
    this.tool = tool;
    if (this.context.kind === "screen") this.services.setSelectionTool?.("select");
    this.setEnabled(true);
  }

  undo() {
    const annotation = this.annotations.pop();
    if (!annotation) return;
    this.annotationRevision += 1;
    this.undoStack.push(annotation);
    this.render();
    this.updateControls();
    this.persist().catch((error) => this.reportError("Could not save annotation", error));
  }

  redo() {
    const annotation = this.undoStack.pop();
    if (!annotation) return;
    this.annotationRevision += 1;
    this.annotations.push(annotation);
    this.render();
    this.updateControls();
    this.persist().catch((error) => this.reportError("Could not save annotation", error));
  }

  clear() {
    if (this.annotations.length === 0) return;
    this.annotationRevision += 1;
    this.annotations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.drawing = null;
    this.render();
    this.updateControls();
    this.persist().catch((error) => this.reportError("Could not clear annotations", error));
  }

  persist() {
    if (this.context?.kind === "editor") {
      const operation = Promise.resolve(this.services.publishSelection?.());
      this.saveQueue = operation.catch(() => {});
      return operation;
    }
    if (!this.screenId) return Promise.resolve();
    const payload = {
      screenId: this.screenId,
      annotations: this.annotations,
      coordinateSpace: "screen canvas pixels",
      canvasSize: {
        width: Math.ceil(this.renderWidth),
        height: Math.ceil(this.renderHeight)
      },
      previewStateId: this.services.getActivePreviewStateId?.(this.screenId) || "default"
    };
    const operation = this.saveQueue.then(async () => {
      const response = await this.services.fetcher("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      this.annotationUpdatedAt = result.updatedAt;
    });
    this.saveQueue = operation.catch(() => {});
    return operation;
  }

  renderStaticAnnotations(annotationSet) {
    this.screenId = annotationSet.screenId;
    this.annotations = annotationSet.annotations;
    this.renderWidth = annotationSet.canvasSize.width;
    this.renderHeight = annotationSet.canvasSize.height;
    this.render();
  }

  reportError(message, error) {
    console.error(message, error);
  }

  updateControls() {
    const hasAnnotations = this.annotations.length > 0;
    const toolbar = this.services.byId("annotation-toolbar");
    if (toolbar) toolbar.hidden = !this.context;
    const exitButton = this.services.byId("annotation-mode-exit");
    exitButton.disabled = !this.enabled || !this.context;
    this.services.document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.disabled = !this.context;
      button.setAttribute(
        "aria-pressed",
        String(this.enabled && button.dataset.annotationTool === this.tool)
      );
    });
    this.services.byId("annotation-undo").disabled = !hasAnnotations;
    this.services.byId("annotation-redo").disabled = this.undoStack.length === 0;
    this.services.byId("annotation-clear").disabled = !hasAnnotations;
  }

  createOverlay(content, { previewId = null, className = "screen-annotation-overlay" } = {}) {
    const overlay = this.services.document.createElementNS(SVG_NAMESPACE, "svg");
    overlay.classList.add(className);
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("preserveAspectRatio", "none");
    if (previewId) overlay.setAttribute("data-annotation-preview-id", previewId);
    overlay.addEventListener("pointerdown", (event) => this.onPointerDown(event, overlay));
    overlay.addEventListener("pointermove", (event) => this.onPointerMove(event));
    overlay.addEventListener("pointerup", (event) => this.onPointerUp(event));
    overlay.addEventListener("pointercancel", () => {
      this.drawing = null;
      this.render();
    });
    content.append(overlay);
    this.overlay = overlay;
    return overlay;
  }

  render() {
    if (this.context?.kind === "editor") {
      const screenPreview = this.services.byId("screen-preview");
      const screenOverlay = screenPreview?.querySelector?.(
        ":scope > .form-content > .screen-annotation-overlay"
      );
      if (screenOverlay) {
        screenOverlay.hidden = true;
        screenOverlay.style.pointerEvents = "none";
      }
      screenPreview?.classList.remove("annotation-mode");
      this.renderEditorOverlay();
      return;
    }
    this.hideEditorOverlays();
    const editorOverlay = this.services.byId("main")
      ?.querySelector?.(":scope > .editor-annotation-overlay");
    if (editorOverlay) {
      editorOverlay.hidden = true;
      editorOverlay.style.pointerEvents = "none";
    }
    const preview = this.services.byId("screen-preview");
    if (!preview) return;
    const content = preview.querySelector(":scope > .form-content");
    if (!content) return;
    this.overlay = content.querySelector(":scope > .screen-annotation-overlay") ||
      this.createOverlay(content);
    this.overlay.hidden = false;
    const canvasSize = this.measureCanvasSize(content);
    this.renderWidth = canvasSize.width;
    this.renderHeight = canvasSize.height;
    this.overlay.setAttribute("viewBox", `0 0 ${this.renderWidth} ${this.renderHeight}`);
    this.overlay.setAttribute("width", String(this.renderWidth));
    this.overlay.setAttribute("height", String(this.renderHeight));
    this.overlay.style.width = `${this.renderWidth}px`;
    this.overlay.style.height = `${this.renderHeight}px`;
    const highestMaterialLayer = [...content.querySelectorAll(":scope > .material-frame")]
      .reduce((highest, frame) => Math.max(highest, Number(frame.style.zIndex) || 0), 20);
    this.overlay.style.zIndex = String(highestMaterialLayer + 1);
    this.overlay.style.pointerEvents = this.enabled ? "all" : "none";
    preview.classList.toggle("annotation-mode", this.enabled);
    this.overlay.replaceChildren();
    this.renderArrowhead(this.overlay, "annotation-arrowhead");
    for (const annotation of this.annotations) {
      this.renderAnnotation(annotation, this.overlay, "annotation-arrowhead");
    }
    if (this.drawing) {
      this.renderAnnotation(this.drawing.annotation, this.overlay, "annotation-arrowhead");
    }
  }

  renderEditorOverlay() {
    const previewSizes = this.contextPreviewSizes.get(this.context.key) || new Map();
    const targets = this.getEditorPreviewTargets();
    this.observeEditorPreviewTargets(targets);
    const activeIds = new Set(targets.map((target) => target.id));
    for (const [id, overlay] of this.editorOverlays) {
      if (activeIds.has(id)) continue;
      overlay.hidden = true;
      overlay.style.pointerEvents = "none";
      const target = this.editorTargets.get(id);
      target?.scrollElement?.classList?.remove(
        "editor-annotation-no-overflow-x",
        "editor-annotation-no-overflow-y"
      );
    }
    for (const [id, target] of this.editorTargets) {
      if (!activeIds.has(id)) target.scrollElement?.classList?.remove("annotation-mode");
    }
    this.editorTargets = new Map(targets.map((target) => [target.id, target]));
    const main = this.services.byId("main");
    main?.classList?.remove("annotation-mode");
    const legacyOverlay = main?.querySelector?.(":scope > .editor-annotation-overlay");
    if (legacyOverlay) {
      legacyOverlay.hidden = true;
      legacyOverlay.style.pointerEvents = "none";
    }
    for (const target of targets) {
      const { id, element, width, height } = target;
      let overlay = this.editorOverlays.get(id);
      if (!overlay || overlay.parentElement !== element) {
        overlay = this.createOverlay(element, {
          previewId: id,
          className: "editor-annotation-overlay"
        });
      }
      this.editorOverlays.set(id, overlay);
      previewSizes.set(id, {
        id,
        label: target.label,
        coordinateSpace: "preview content pixels",
        canvasSize: { width, height }
      });
      overlay.hidden = false;
      overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
      overlay.setAttribute("width", String(width));
      overlay.setAttribute("height", String(height));
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      const highestMaterialLayer = id === "screen"
        ? [...element.querySelectorAll(":scope > .material-frame")]
          .reduce((highest, frame) => Math.max(highest, Number(frame.style.zIndex) || 0), 20)
        : 29;
      overlay.style.zIndex = String(highestMaterialLayer + 1);
      overlay.style.pointerEvents = this.enabled ? "all" : "none";
      target.scrollElement?.classList?.toggle("annotation-mode", this.enabled);
      if (target.contentOverflowsX !== undefined) {
        target.scrollElement?.classList?.toggle(
          "editor-annotation-no-overflow-x",
          !target.contentOverflowsX
        );
        target.scrollElement?.classList?.toggle(
          "editor-annotation-no-overflow-y",
          !target.contentOverflowsY
        );
      }
      overlay.replaceChildren();
      const markerId = `annotation-arrowhead-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      this.renderArrowhead(overlay, markerId);
      for (const annotation of this.annotations) {
        if (annotation.previewId === id ||
            (!annotation.previewId && targets[0]?.id === id)) {
          this.renderAnnotation(annotation, overlay, markerId);
        }
      }
      if (this.drawing?.previewId === id) {
        this.renderAnnotation(this.drawing.annotation, overlay, markerId);
      }
    }
    this.contextPreviewSizes.set(this.context.key, previewSizes);
  }

  hideEditorOverlays() {
    this.observeEditorPreviewTargets([]);
    for (const overlay of this.editorOverlays.values()) {
      overlay.hidden = true;
      overlay.style.pointerEvents = "none";
    }
    for (const target of this.editorTargets.values()) {
      target.scrollElement?.classList?.remove("annotation-mode");
      target.scrollElement?.classList?.remove(
        "editor-annotation-no-overflow-x",
        "editor-annotation-no-overflow-y"
      );
    }
    this.editorTargets.clear();
    const main = this.services.byId("main");
    main?.classList?.remove("annotation-mode");
    const legacyOverlay = main?.querySelector?.(":scope > .editor-annotation-overlay");
    if (legacyOverlay) {
      legacyOverlay.hidden = true;
      legacyOverlay.style.pointerEvents = "none";
    }
  }

  getEditorPreviewTargets() {
    const document = this.services.document;
    if (!document?.querySelectorAll) return [];
    const targets = [];
    for (const element of document.querySelectorAll("[data-annotation-preview]")) {
      if (element.hidden || element.closest?.("[hidden]")) continue;
      const bounds = element.getBoundingClientRect?.();
      if (bounds && bounds.width <= 0 && bounds.height <= 0) continue;
      const id = element.dataset?.annotationPreview;
      if (!id) continue;
      const isScreenPreview = element.id === "screen-preview" &&
        ["screen", "workflow", "spec", "theme"].includes(this.context?.view) &&
        Boolean(element.querySelector?.(":scope > .form-content"));
      const formContent = isScreenPreview
        ? element.querySelector(":scope > .form-content")
        : null;
      const captureElement = formContent || element;
      const annotationElement = formContent ||
        element.querySelector?.(":scope > [data-annotation-canvas]") ||
        element;
      const scrollElement = isScreenPreview ? element : annotationElement;
      captureElement.dataset.annotationCapturePreview = id;
      const viewportElement = element.closest?.(".screen-preview") || element;
      const size = formContent
        ? this.measureCanvasSize(captureElement)
        : this.measureEditorPreviewSize(viewportElement, annotationElement);
      targets.push({
        id,
        label: element.getAttribute("aria-label") || id,
        element: annotationElement,
        scrollElement,
        captureElement,
        hostElement: element,
        viewportElement,
        width: size.width,
        height: size.height,
        contentOverflowsX: size.contentOverflowsX,
        contentOverflowsY: size.contentOverflowsY
      });
      scrollElement.dataset.annotationCaptureScroll = id;
    }
    return targets;
  }

  getPreviewCaptureTargets() {
    return this.getEditorPreviewTargets();
  }

  observeEditorPreviewTargets(targets) {
    if (!this.resizeObserver) return;
    const nextTargets = new Set(targets.map((target) => target.viewportElement));
    for (const target of this.editorResizeTargets) {
      if (!nextTargets.has(target) && !this.baseResizeTargets.has(target)) {
        this.resizeObserver.unobserve(target);
      }
    }
    for (const target of nextTargets) {
      if (!this.editorResizeTargets.has(target) && !this.baseResizeTargets.has(target)) {
        this.resizeObserver.observe(target);
      }
    }
    this.editorResizeTargets = nextTargets;
  }

  measureEditorPreviewSize(viewportElement, annotationElement) {
    const overlay = annotationElement.querySelector?.(
      ":scope > .editor-annotation-overlay"
    );
    const overlayDisplay = overlay?.style.display;
    if (overlay) overlay.style.display = "none";
    try {
      const viewportBounds = viewportElement.getBoundingClientRect?.();
      const viewportWidth = viewportElement.clientWidth || viewportBounds?.width || 0;
      const viewportHeight = viewportElement.clientHeight || viewportBounds?.height || 0;
      const contentWidth = annotationElement.scrollWidth || annotationElement.clientWidth || 0;
      const contentHeight = annotationElement.scrollHeight || annotationElement.clientHeight || 0;
      const width = Math.max(
        contentWidth,
        viewportWidth
      );
      const height = Math.max(
        contentHeight,
        viewportHeight
      );
      return {
        width: Math.max(1, width),
        height: Math.max(1, height),
        contentOverflowsX: contentWidth > viewportWidth,
        contentOverflowsY: contentHeight > viewportHeight
      };
    } finally {
      if (overlay) overlay.style.display = overlayDisplay;
    }
  }

  measureCanvasSize(content) {
    const contentRect = content.getBoundingClientRect();
    const scaleX = contentRect.width / (content.offsetWidth || contentRect.width || 1);
    const scaleY = contentRect.height / (content.offsetHeight || contentRect.height || 1);
    let width = DEFAULT_CANVAS_SIZE.width;
    let height = DEFAULT_CANVAS_SIZE.height;
    content.querySelectorAll(":scope > .material-frame").forEach((frame) => {
      const bounds = frame.getBoundingClientRect();
      width = Math.max(width, (bounds.right - contentRect.left) / (scaleX || 1));
      height = Math.max(height, (bounds.bottom - contentRect.top) / (scaleY || 1));
    });
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  renderArrowhead(overlay = this.overlay, markerId = "annotation-arrowhead") {
    const defs = this.services.document.createElementNS(SVG_NAMESPACE, "defs");
    const marker = this.svgElement("marker", {
      id: markerId,
      markerWidth: "10",
      markerHeight: "10",
      refX: "8",
      refY: "5",
      orient: "auto",
      markerUnits: "userSpaceOnUse"
    });
    marker.append(this.svgElement("path", {
      d: "M 0 0 L 10 5 L 0 10 z",
      fill: "#e11d48"
    }));
    defs.append(marker);
    overlay.append(defs);
  }

  renderAnnotation(annotation, overlay = this.overlay, markerId = "annotation-arrowhead") {
    const points = annotation.points;
    const group = this.svgElement("g", { "data-annotation-id": annotation.id });
    const title = this.svgElement("title");
    title.textContent = `${annotation.tool} annotation${annotation.text ? `: ${annotation.text}` : ""}`;
    group.append(title);
    if (annotation.tool === "circle") {
      const first = points[0];
      const second = points[points.length - 1];
      group.append(this.svgElement("ellipse", {
        cx: String((first.x + second.x) / 2),
        cy: String((first.y + second.y) / 2),
        rx: String(Math.abs(second.x - first.x) / 2),
        ry: String(Math.abs(second.y - first.y) / 2),
        class: "annotation-shape",
        fill: "rgba(225, 29, 72, 0.1)",
        stroke: "#e11d48",
        "stroke-width": "3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke"
      }));
    } else if (annotation.tool === "rectangle") {
      const first = points[0];
      const second = points[points.length - 1];
      group.append(this.svgElement("rect", {
        x: String(Math.min(first.x, second.x)),
        y: String(Math.min(first.y, second.y)),
        width: String(Math.abs(second.x - first.x)),
        height: String(Math.abs(second.y - first.y)),
        class: "annotation-shape",
        fill: "rgba(225, 29, 72, 0.1)",
        stroke: "#e11d48",
        "stroke-width": "3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke"
      }));
    } else if (annotation.tool === "arrow") {
      const first = points[0];
      const second = points[points.length - 1];
      group.append(this.svgElement("line", {
        x1: String(first.x),
        y1: String(first.y),
        x2: String(second.x),
        y2: String(second.y),
        class: "annotation-shape annotation-arrow",
        fill: "none",
        stroke: "#e11d48",
        "stroke-width": "3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "marker-end": `url(#${markerId})`,
        "vector-effect": "non-scaling-stroke"
      }));
    } else if (annotation.tool === "note") {
      this.renderNote(group, points[0], annotation.text || "");
    } else {
      const pathData = points.map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
      ).join(" ");
      const isHighlight = annotation.tool === "highlight";
      group.append(this.svgElement("path", {
        d: pathData,
        class: isHighlight ? "annotation-highlight" : "annotation-pen",
        fill: "none",
        stroke: isHighlight ? "#facc15" : "#e11d48",
        "stroke-width": isHighlight ? "22" : "3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: isHighlight ? "0.38" : "1",
        "vector-effect": "non-scaling-stroke"
      }));
    }
    overlay.append(group);
  }

  renderNote(group, point, text) {
    const lines = text.match(/.{1,36}(\s|$)/g)?.map((line) => line.trim()) || [text];
    const visibleLines = lines.slice(0, 4);
    const width = Math.min(280, Math.max(120, ...visibleLines.map((line) => line.length * 7 + 20)));
    const height = visibleLines.length * 19 + 16;
    const rootStyle = this.services.window.getComputedStyle(this.services.document.documentElement);
    group.append(this.svgElement("rect", {
      x: String(point.x),
      y: String(point.y),
      width: String(width),
      height: String(height),
      rx: "6",
      class: "annotation-note-bg",
      fill: rootStyle.getPropertyValue("--panel").trim() || "#1e293b",
      stroke: "#e11d48",
      "stroke-width": "2",
      "vector-effect": "non-scaling-stroke"
    }));
    visibleLines.forEach((line, index) => {
      const textNode = this.svgElement("text", {
        x: String(point.x + 10),
        y: String(point.y + 20 + index * 19),
        class: "annotation-note-text",
        fill: rootStyle.getPropertyValue("--ui-text-strong").trim() || "#fff",
        "font-family": 'Inter, "Segoe UI", Arial, sans-serif',
        "font-size": "12px"
      });
      textNode.textContent = line;
      group.append(textNode);
    });
  }

  svgElement(name, attributes = {}) {
    const element = this.services.document.createElementNS(SVG_NAMESPACE, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  pointFromEvent(event, previewId = null) {
    if (this.context?.kind === "editor") {
      const target = previewId ? this.editorTargets.get(previewId) : null;
      if (target) {
        const rect = target.element.getBoundingClientRect();
        const scaleX = rect.width / (target.element.offsetWidth || rect.width || 1);
        const scaleY = rect.height / (target.element.offsetHeight || rect.height || 1);
        const scrollLeft = target.element === target.scrollElement
          ? target.scrollElement.scrollLeft
          : 0;
        const scrollTop = target.element === target.scrollElement
          ? target.scrollElement.scrollTop
          : 0;
        return {
          x: clamp((event.clientX - rect.left) / (scaleX || 1) + scrollLeft, 0, target.width),
          y: clamp((event.clientY - rect.top) / (scaleY || 1) + scrollTop, 0, target.height)
        };
      }
      const rect = this.services.byId("main").getBoundingClientRect();
      return {
        x: clamp((event.clientX - rect.left) * this.renderWidth / (rect.width || 1), 0, this.renderWidth),
        y: clamp((event.clientY - rect.top) * this.renderHeight / (rect.height || 1), 0, this.renderHeight)
      };
    }
    const content = this.services.byId("screen-preview").querySelector(":scope > .form-content");
    const rect = content.getBoundingClientRect();
    const scaleX = rect.width / (content.offsetWidth || rect.width || 1);
    const scaleY = rect.height / (content.offsetHeight || rect.height || 1);
    return {
      x: clamp(
        (event.clientX - rect.left) / (scaleX || 1),
        0,
        this.renderWidth
      ),
      y: clamp(
        (event.clientY - rect.top) / (scaleY || 1),
        0,
        this.renderHeight
      )
    };
  }

  targetAtPoint(point) {
    if (this.context?.kind === "editor") return null;
    const preview = this.services.byId("screen-preview");
    const content = preview.querySelector(":scope > .form-content");
    const rect = content.getBoundingClientRect();
    const scaleX = rect.width / (content.offsetWidth || rect.width || 1);
    const scaleY = rect.height / (content.offsetHeight || rect.height || 1);
    const clientX = rect.left + point.x * (scaleX || 1);
    const clientY = rect.top + point.y * (scaleY || 1);
    this.overlay.style.pointerEvents = "none";
    let node;
    try {
      node = this.services.document.elementFromPoint(clientX, clientY);
      while (node?.shadowRoot?.elementFromPoint) {
        const innerNode = node.shadowRoot.elementFromPoint(clientX, clientY);
        if (!innerNode || innerNode === node) break;
        node = innerNode;
      }
    } finally {
      this.overlay.style.pointerEvents = this.enabled ? "all" : "none";
    }
    const hitNode = node;
    while (node) {
      if (node.classList?.contains("material-instance")) {
        let instancePath;
        try {
          instancePath = JSON.parse(node.dataset.specuxInstancePath || node.dataset.instancePath || "[]");
        } catch {
          return null;
        }
        let contextText;
        let contextNode = hitNode;
        while (contextNode && contextNode !== node) {
          const text = (contextNode.innerText || contextNode.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (text.length >= 3 && text.length <= 500) {
            contextText = text;
            break;
          }
          contextNode = contextNode.parentElement || contextNode.getRootNode?.().host || null;
        }
        return {
          instancePath,
          ...(node.dataset.materialId ? { materialId: node.dataset.materialId } : {}),
          ...(node.dataset.materialSrc ? { materialSrc: node.dataset.materialSrc } : {}),
          ...(node.dataset.specuxElementId ? { elementId: node.dataset.specuxElementId } : {}),
          ...(node.dataset.specuxInstanceName ? { name: node.dataset.specuxInstanceName } : {}),
          ...(contextText ? { text: contextText } : {})
        };
      }
      node = node.parentElement || node.getRootNode?.().host || null;
    }
    return null;
  }

  targetPoint(annotation) {
    if (annotation.tool === "circle" || annotation.tool === "rectangle" || annotation.tool === "arrow") {
      const first = annotation.points[0];
      const last = annotation.points[annotation.points.length - 1];
      return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    }
    return annotation.points[Math.floor(annotation.points.length / 2)];
  }

  createId() {
    return this.services.window.crypto?.randomUUID?.() ||
      `annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  onPointerDown(event, overlay = event.currentTarget || this.overlay) {
    if (!this.enabled || !this.context || event.button !== 0) return;
    event.preventDefault();
    const previewId = this.context.kind === "editor"
      ? overlay?.getAttribute?.("data-annotation-preview-id")
      : null;
    const point = this.pointFromEvent(event, previewId);
    if (this.tool === "note") {
      const text = this.services.prompt("Annotation note for the AI:", "");
      if (!text?.trim()) return;
      const target = this.targetAtPoint(point);
      this.annotations.push({
        id: this.createId(),
        tool: this.tool,
        points: [point],
        ...(previewId ? { previewId } : {}),
        text: text.trim(),
        ...(target ? { target } : {})
      });
      this.annotationRevision += 1;
      this.redoStack = [];
      this.render();
      this.updateControls();
      this.persist().catch((error) => this.reportError("Could not publish annotation", error));
      return;
    }
    const annotation = {
      id: this.createId(),
      tool: this.tool,
      points: [point],
      ...(previewId ? { previewId } : {})
    };
    this.drawing = { pointerId: event.pointerId, annotation, previewId };
    overlay?.setPointerCapture?.(event.pointerId);
    this.render();
  }

  onPointerMove(event) {
    if (!this.drawing || event.pointerId !== this.drawing.pointerId) return;
    const points = this.drawing.annotation.points;
    const point = this.pointFromEvent(event, this.drawing.previewId);
    const last = points[points.length - 1];
    if (this.drawing.annotation.tool === "pen" || this.drawing.annotation.tool === "highlight") {
      const distance = Math.hypot(point.x - last.x, point.y - last.y);
      if (distance >= 0.002) points.push(point);
    } else if (points.length === 1) {
      points.push(point);
    } else {
      points[1] = point;
    }
    this.render();
  }

  onPointerUp(event) {
    if (!this.drawing || event.pointerId !== this.drawing.pointerId) return;
    const points = this.drawing.annotation.points;
    const end = this.pointFromEvent(event, this.drawing.previewId);
    if (points.length === 1) points.push(end);
    else if (this.drawing.annotation.tool !== "pen" && this.drawing.annotation.tool !== "highlight") {
      points[1] = end;
    }
    const target = this.targetAtPoint(this.targetPoint(this.drawing.annotation));
    if (target) this.drawing.annotation.target = target;
    this.annotations.push(this.drawing.annotation);
    this.drawing = null;
    this.annotationRevision += 1;
    this.redoStack = [];
    this.render();
    this.updateControls();
    this.persist().catch((error) => this.reportError("Could not publish annotation", error));
  }
}
