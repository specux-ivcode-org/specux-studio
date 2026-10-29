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
    this.annotations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.tool = "pen";
    this.enabled = false;
    this.drawing = null;
    this.overlay = null;
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
    const ResizeObserverClass = services.window.ResizeObserver;
    if (ResizeObserverClass) {
      this.resizeObserver = new ResizeObserverClass(() => this.render());
      this.resizeObserver.observe(preview);
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

  async setScreen(screen) {
    const nextScreenId = screen?.id || null;
    if (nextScreenId === this.screenId) {
      this.render();
      return;
    }
    this.screenId = nextScreenId;
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
    this.enabled = Boolean(enabled && this.screenId);
    this.drawing = null;
    this.render();
    this.updateControls();
  }

  selectTool(tool) {
    if (!ANNOTATION_TOOLS.has(tool) || !this.screenId) return;
    this.tool = tool;
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
    const exitButton = this.services.byId("annotation-mode-exit");
    exitButton.disabled = !this.enabled || !this.screenId;
    this.services.document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
      button.disabled = !this.screenId;
      button.setAttribute(
        "aria-pressed",
        String(this.enabled && button.dataset.annotationTool === this.tool)
      );
    });
    this.services.byId("annotation-undo").disabled = !hasAnnotations;
    this.services.byId("annotation-redo").disabled = this.undoStack.length === 0;
    this.services.byId("annotation-clear").disabled = !hasAnnotations;
  }

  createOverlay(content) {
    const overlay = this.services.document.createElementNS(SVG_NAMESPACE, "svg");
    overlay.classList.add("screen-annotation-overlay");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("preserveAspectRatio", "none");
    overlay.addEventListener("pointerdown", (event) => this.onPointerDown(event));
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
    const preview = this.services.byId("screen-preview");
    if (!preview) return;
    const content = preview.querySelector(":scope > .form-content");
    if (!content) return;
    this.overlay = content.querySelector(":scope > .screen-annotation-overlay") ||
      this.createOverlay(content);
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
    this.renderArrowhead();
    for (const annotation of this.annotations) this.renderAnnotation(annotation);
    if (this.drawing) this.renderAnnotation(this.drawing.annotation);
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

  renderArrowhead() {
    const defs = this.services.document.createElementNS(SVG_NAMESPACE, "defs");
    const marker = this.svgElement("marker", {
      id: "annotation-arrowhead",
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
    this.overlay.append(defs);
  }

  renderAnnotation(annotation) {
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
        "marker-end": "url(#annotation-arrowhead)",
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
    this.overlay.append(group);
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

  pointFromEvent(event) {
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
      if (node.classList?.contains("material-instance") || node.classList?.contains("asset-instance")) {
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
          ...(node.dataset.specuxAssetId ? { assetId: node.dataset.specuxAssetId } : {}),
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

  onPointerDown(event) {
    if (!this.enabled || !this.screenId || event.button !== 0) return;
    event.preventDefault();
    const point = this.pointFromEvent(event);
    if (this.tool === "note") {
      const text = this.services.prompt("Annotation note for the AI:", "");
      if (!text?.trim()) return;
      const target = this.targetAtPoint(point);
      this.annotations.push({
        id: this.createId(),
        tool: this.tool,
        points: [point],
        text: text.trim(),
        ...(target ? { target } : {})
      });
      this.annotationRevision += 1;
      this.redoStack = [];
      this.render();
      this.updateControls();
      this.persist().catch((error) => this.reportError("Could not save annotation", error));
      return;
    }
    const annotation = {
      id: this.createId(),
      tool: this.tool,
      points: [point]
    };
    this.drawing = { pointerId: event.pointerId, annotation };
    this.overlay.setPointerCapture?.(event.pointerId);
    this.render();
  }

  onPointerMove(event) {
    if (!this.drawing || event.pointerId !== this.drawing.pointerId) return;
    const points = this.drawing.annotation.points;
    const point = this.pointFromEvent(event);
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
    const end = this.pointFromEvent(event);
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
    this.persist().catch((error) => this.reportError("Could not save annotation", error));
  }
}
