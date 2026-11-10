const SELECTION_TOOLS = new Set(["select", "marquee"]);
const SCALE_TYPES = new Set(["xy", "transform"]);

/** Returns the marquee selected paths. */
export function getMarqueeSelectedPaths(candidates, selection, startPoint) {
  return candidates
    .filter(({ bounds }) => {
      const containsStart = startPoint.x >= bounds.left &&
        startPoint.x <= bounds.right &&
        startPoint.y >= bounds.top &&
        startPoint.y <= bounds.bottom;
      if (containsStart) return false;
      return bounds.left >= selection.left &&
        bounds.right <= selection.right &&
        bounds.top >= selection.top &&
        bounds.bottom <= selection.bottom;
    })
    .map(({ path }) => path);
}

/** Manages Screen selection and the associated editor navigation state. */
export class ScreenSelectionController {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.screenId = null;
    this.tool = "select";
    this.scaleType = "xy";
    this.overlay = null;
    this.rectangle = null;
    this.drawing = null;
  }

  /** Attaches the configured event listeners to the editor controls. */
  bind() {
    this.services.document.querySelectorAll("[data-selection-tool]").forEach((button) => {
      button.addEventListener("click", () => this.selectTool(button.dataset.selectionTool));
    });
    this.services.document.querySelectorAll("[data-scale-type]").forEach((button) => {
      button.addEventListener("click", () => this.selectScaleType(button.dataset.scaleType));
    });
    this.services.byId("screen-preview")
      ?.addEventListener("contextmenu", (event) => this.onContextMenu(event), true);
    this.updateControls();
  }

  /** Sets the screen from the supplied data. */
  setScreen(screen) {
    this.screenId = screen?.id || null;
    this.drawing = null;
    this.render();
    this.updateControls();
  }

  /** Selects the tool and updates the related editor state. */
  selectTool(tool) {
    if (!SELECTION_TOOLS.has(tool) || !this.screenId || this.isInteractionDisabled()) return;
    this.tool = tool;
    this.services.disableAnnotationMode?.();
    this.drawing = null;
    this.render();
    this.updateControls();
  }

  /** Updates the controls to reflect the latest editor state. */
  updateControls() {
    this.services.document.querySelectorAll("[data-selection-tool]").forEach((button) => {
      button.disabled = !this.screenId || this.isInteractionDisabled();
      button.setAttribute("aria-pressed", String(button.dataset.selectionTool === this.tool));
    });
    this.services.document.querySelectorAll("[data-scale-type]").forEach((button) => {
      button.disabled = !this.screenId || this.isInteractionDisabled();
      button.setAttribute("aria-pressed", String(button.dataset.scaleType === this.scaleType));
    });
  }

  /** Selects the scale type and updates the related editor state. */
  selectScaleType(scaleType) {
    if (!SCALE_TYPES.has(scaleType) || !this.screenId || this.isInteractionDisabled()) return;
    this.scaleType = scaleType;
    this.updateControls();
  }

  /** Checks whether the active view disables Screen selection interactions. */
  isInteractionDisabled() {
    return this.state.isRenderOnly ||
      this.state.viewingWorkflow ||
      this.state.viewingTheme ||
      this.state.viewingSpec;
  }

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  render() {
    const preview = this.services.byId("screen-preview");
    const content = preview?.querySelector(":scope > .form-content");
    if (!content) return;
    this.overlay = content.querySelector(":scope > .screen-selection-overlay");
    if (!this.overlay) this.overlay = this.createOverlay(content);
    this.rectangle = this.overlay.querySelector(".screen-selection-rectangle");
    const highestPlacementLayer = [...content.querySelectorAll(":scope > .material-frame")]
      .reduce((highest, frame) => Math.max(highest, Number(frame.style.zIndex) || 0), 0);
    this.overlay.style.zIndex = String(highestPlacementLayer + 1);
    const enabled = this.tool === "marquee" &&
      Boolean(this.screenId) &&
      !this.isInteractionDisabled();
    this.overlay.style.pointerEvents = enabled ? "auto" : "none";
    preview.classList.toggle("marquee-selection-mode", enabled);
    this.clearRectangle();
  }

  /** Creates and attaches the annotation overlay for the selected preview. */
  createOverlay(content) {
    const overlay = this.services.document.createElement("div");
    overlay.className = "screen-selection-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const rectangle = this.services.document.createElement("div");
    rectangle.className = "screen-selection-rectangle";
    overlay.append(rectangle);
    overlay.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    overlay.addEventListener("pointermove", (event) => this.onPointerMove(event));
    overlay.addEventListener("pointerup", (event) => this.onPointerUp(event));
    overlay.addEventListener("pointercancel", () => {
      this.drawing = null;
      this.clearRectangle();
    });
    content.append(overlay);
    return overlay;
  }

  /** Handles pointer down events for the related editor control. */
  onPointerDown(event) {
    if (this.isInteractionDisabled() ||
        !this.overlay ||
        this.tool !== "marquee" ||
        event.button !== 0 ||
        !Number.isFinite(event.clientX) ||
        !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    this.drawing = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      moved: false
    };
    this.overlay.setPointerCapture?.(event.pointerId);
    this.updateRectangle();
  }

  /** Handles pointer move events for the related editor control. */
  onPointerMove(event) {
    if (this.isInteractionDisabled()) {
      this.drawing = null;
      this.clearRectangle();
      return;
    }
    const drawing = this.drawing;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    drawing.current = { x: event.clientX, y: event.clientY };
    drawing.moved ||= Math.abs(drawing.current.x - drawing.start.x) >= 3 ||
      Math.abs(drawing.current.y - drawing.start.y) >= 3;
    this.updateRectangle();
  }

  /** Handles pointer up events for the related editor control. */
  onPointerUp(event) {
    if (this.isInteractionDisabled()) {
      this.drawing = null;
      this.clearRectangle();
      return;
    }
    const drawing = this.drawing;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    this.drawing = null;
    this.overlay.releasePointerCapture?.(event.pointerId);
    this.clearRectangle();
    if (!drawing.moved) {
      this.services.selectInstances([]);
      return;
    }
    const selection = this.clientRect(drawing.start, drawing.current);
    const content = this.services.byId("screen-preview")
      ?.querySelector(":scope > .form-content");
    const candidates = [...(content?.querySelectorAll(":scope > .material-frame") || [])]
      .map((frame) => ({
        path: this.readPath(frame.dataset.instancePath),
        bounds: frame.getBoundingClientRect()
      }))
      .filter(({ path }) => path);
    this.services.selectInstances(
      getMarqueeSelectedPaths(candidates, selection, drawing.start)
    );
  }

  /** Handles context menu events for the related editor control. */
  onContextMenu(event) {
    if (this.isInteractionDisabled()) return;
    const directFrame = event.composedPath?.().find((node) =>
      node?.classList?.contains("material-frame")
    );
    const hitFrame = directFrame || this.services.document
      .elementsFromPoint?.(event.clientX, event.clientY)
      .find((node) => node?.classList?.contains("material-frame"));
    const path = this.readPath(hitFrame?.dataset?.instancePath);
    if (!path) {
      this.services.closePlacementContextMenu?.();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.services.openPlacementContextMenu?.(event, path);
  }

  /** Updates the rectangle to reflect the latest editor state. */
  updateRectangle() {
    if (!this.drawing || !this.rectangle || !this.overlay) return;
    const content = this.overlay.parentElement;
    const bounds = content.getBoundingClientRect();
    const scaleX = bounds.width / (content.offsetWidth || bounds.width || 1);
    const scaleY = bounds.height / (content.offsetHeight || bounds.height || 1);
    const selection = this.clientRect(this.drawing.start, this.drawing.current);
    this.rectangle.style.left = `${(selection.left - bounds.left) / scaleX}px`;
    this.rectangle.style.top = `${(selection.top - bounds.top) / scaleY}px`;
    this.rectangle.style.width = `${(selection.right - selection.left) / scaleX}px`;
    this.rectangle.style.height = `${(selection.bottom - selection.top) / scaleY}px`;
    this.rectangle.hidden = !this.drawing.moved;
  }

  /** Clears the rectangle and resets its associated state. */
  clearRectangle() {
    if (!this.rectangle) return;
    this.rectangle.hidden = true;
    this.rectangle.style.width = "0";
    this.rectangle.style.height = "0";
  }

  /** Updates the rect for the current editor state. */
  clientRect(start, end) {
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y)
    };
  }

  /** Parses the dataset path used to identify a nested placement. */
  readPath(value) {
    try {
      const path = JSON.parse(value || "null");
      return Array.isArray(path) && path.every(Number.isInteger) ? path : null;
    } catch {
      return null;
    }
  }
}
