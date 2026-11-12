const MINIMUM_ZOOM = 0.25;
const MAXIMUM_ZOOM = 2;
const ZOOM_STEP = 0.1;
const ZOOM_CONTROL_IDS = [
  "material-canvas-zoom-out",
  "material-canvas-zoom-reset",
  "material-canvas-zoom-in"
];

/** Provides zoom, panning, and grid controls for the Material preview canvas. */
export class MaterialCanvasViewportController {
  /** Stores browser collaborators and initializes the camera at 100%. */
  constructor({ documentObject, renderRulers }) {
    this.document = documentObject;
    this.renderRulers = renderRulers;
    this.main = documentObject.getElementById("main");
    this.preview = documentObject.getElementById("screen-preview");
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.spacePressed = false;
    this.activePointer = null;
  }

  /** Binds Material canvas pan, zoom, and grid controls. */
  bind() {
    if (!this.main || !this.preview) return;
    this.preview.addEventListener("pointerdown", (event) => this.startPan(event), true);
    this.preview.addEventListener("pointermove", (event) => this.movePan(event));
    this.preview.addEventListener("pointerup", (event) => this.endPan(event));
    this.preview.addEventListener("pointercancel", (event) => this.endPan(event));
    this.preview.addEventListener("lostpointercapture", (event) => this.endPan(event));
    this.preview.addEventListener("wheel", (event) => this.handleWheel(event), {
      passive: false
    });
    this.document.addEventListener?.("keydown", (event) => this.handleKeyDown(event));
    this.document.addEventListener?.("keyup", (event) => this.handleKeyUp(event));
    this.document.defaultView?.addEventListener("blur", () => this.clearPanModifier());
    this.bindZoomControls();
    this.bindGridToggle();
    this.applyCamera();
  }

  /** Registers zoom buttons and synchronizes their displayed value. */
  bindZoomControls() {
    const [zoomOutId, zoomResetId, zoomInId] = ZOOM_CONTROL_IDS;
    this.document.getElementById(zoomOutId)?.addEventListener("click", () =>
      this.setZoom(this.zoom - ZOOM_STEP)
    );
    this.document.getElementById(zoomInId)?.addEventListener("click", () =>
      this.setZoom(this.zoom + ZOOM_STEP)
    );
    this.document.getElementById(zoomResetId)?.addEventListener("click", () =>
      this.setZoom(1)
    );
    this.updateZoomControl();
  }

  /** Binds the Material-only grid toggle and enables the grid by default. */
  bindGridToggle() {
    const gridToggle = this.document.getElementById("material-canvas-grid-toggle");
    this.main.classList.add("material-grid-visible");
    gridToggle?.addEventListener("click", () => {
      const visible = this.main.classList.toggle("material-grid-visible");
      this.updateGridToggle(visible);
    });
    this.updateGridToggle(this.main.classList.contains("material-grid-visible"));
  }

  /** Handles wheel zoom while keeping the Material origin fixed in the viewport. */
  handleWheel(event) {
    if (!this.main.classList.contains("material-editing") || event.deltaY === 0) return;
    event.preventDefault();
    this.setZoom(this.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  /** Centers the Material sample in the visible canvas without changing its size or zoom. */
  centerMaterial() {
    const sample = this.preview.querySelector(
      ":scope > .material-file-preview-sample"
    );
    if (!sample) return false;
    this.pan.x = (this.preview.clientWidth - sample.offsetWidth * this.zoom) / 2;
    this.pan.y = (this.preview.clientHeight - sample.offsetHeight * this.zoom) / 2;
    this.applyCamera();
    this.renderRulers();
    return true;
  }

  /** Starts panning with the middle button, Space+left-drag, or a blank-canvas drag. */
  startPan(event) {
    if (
      !this.main.classList.contains("material-editing") ||
      this.preview.classList.contains("annotation-mode")
    ) return;
    const usesMiddleButton = event.button === 1;
    const usesLeftButton = event.button === 0 &&
      (this.spacePressed || !this.isMaterialSampleTarget(event));
    if (!usesMiddleButton && !usesLeftButton) return;

    event.preventDefault();
    event.stopPropagation();
    this.activePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    this.preview.classList.add("is-panning");
    this.preview.setPointerCapture?.(event.pointerId);
  }

  /** Checks whether a pointer event started over the resizable Material sample. */
  isMaterialSampleTarget(event) {
    const path = event.composedPath?.() || [];
    if (path.some((node) =>
      node?.classList?.contains("material-file-preview-sample")
    )) return true;
    return Boolean(event.target?.closest?.(".material-file-preview-sample"));
  }

  /** Moves the canvas origin by the pointer delta without changing Material dimensions. */
  movePan(event) {
    if (!this.activePointer || this.activePointer.id !== event.pointerId) return;
    this.pan.x += event.clientX - this.activePointer.x;
    this.pan.y += event.clientY - this.activePointer.y;
    this.activePointer.x = event.clientX;
    this.activePointer.y = event.clientY;
    this.applyCamera();
    this.renderRulers();
  }

  /** Ends the active pan gesture and releases pointer capture. */
  endPan(event) {
    if (!this.activePointer || this.activePointer.id !== event.pointerId) return;
    this.activePointer = null;
    this.preview.classList.remove("is-panning");
    if (this.preview.hasPointerCapture?.(event.pointerId)) {
      this.preview.releasePointerCapture(event.pointerId);
    }
  }

  /** Enables Space+drag panning without stealing Space from interactive controls. */
  handleKeyDown(event) {
    if (event.code !== "Space" || this.isInteractiveTarget(event.target)) return;
    event.preventDefault();
    this.spacePressed = true;
    this.preview.classList.add("pan-ready");
  }

  /** Releases the Space pan modifier after the key is released. */
  handleKeyUp(event) {
    if (event.code !== "Space") return;
    if (this.spacePressed) event.preventDefault();
    this.clearPanModifier();
  }

  /** Clears a stuck Space pan modifier after focus leaves the browser window. */
  clearPanModifier() {
    this.spacePressed = false;
    this.preview?.classList.remove("pan-ready");
  }

  /** Reports whether a focused control owns the Space key for editing or activation. */
  isInteractiveTarget(target) {
    return target?.isContentEditable ||
      ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName) ||
      target?.getAttribute?.("role") === "button";
  }

  /** Changes zoom without moving the Material's top-left origin. */
  setZoom(value) {
    this.zoom = Math.max(
      MINIMUM_ZOOM,
      Math.min(MAXIMUM_ZOOM, Math.round(value * 100) / 100)
    );
    this.applyCamera();
    this.updateZoomControl();
    this.renderRulers();
  }

  /** Applies scale and pan from the Material's top-left canvas origin. */
  applyCamera() {
    this.preview.style.setProperty("--material-canvas-zoom", String(this.zoom));
    this.preview.style.setProperty("--material-canvas-pan-x", `${this.pan.x}px`);
    this.preview.style.setProperty("--material-canvas-pan-y", `${this.pan.y}px`);
  }

  /** Updates the reset button and its accessible title. */
  updateZoomControl() {
    const resetButton = this.document.getElementById("material-canvas-zoom-reset");
    if (!resetButton) return;
    const percentage = `${Math.round(this.zoom * 100)}%`;
    resetButton.textContent = percentage;
    resetButton.title = `Reset canvas zoom to ${percentage}`;
    resetButton.setAttribute("aria-label", `Reset canvas zoom to ${percentage}`);
  }

  /** Updates the grid toggle's accessibility state and action hint. */
  updateGridToggle(visible) {
    const gridToggle = this.document.getElementById("material-canvas-grid-toggle");
    if (!gridToggle) return;
    gridToggle.setAttribute("aria-pressed", String(visible));
    gridToggle.title = `${visible ? "Hide" : "Show"} Material canvas grid`;
  }
}
