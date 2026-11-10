const CANVAS_ZOOM_CONTROL_SETS = [
  ["screen-canvas-zoom-out", "screen-canvas-zoom-reset", "screen-canvas-zoom-in"],
  ["workflow-canvas-zoom-out", "workflow-canvas-zoom-reset", "workflow-canvas-zoom-in"],
  ["spec-canvas-zoom-out", "spec-canvas-zoom-reset", "spec-canvas-zoom-in"]
];
const CANVAS_GRID_TOGGLE_IDS = ["screen-canvas-grid-toggle", "spec-canvas-grid-toggle"];

const MINIMUM_ZOOM = 0.25;
const MAXIMUM_ZOOM = 2;
const ZOOM_STEP = 0.1;

/** Returns the pan offset that keeps a viewport point fixed while zooming. */
export function getZoomAnchoredPan(pan, oldZoom, newZoom, anchor) {
  const ratio = newZoom / oldZoom;
  return {
    x: anchor.x - (anchor.x - pan.x) * ratio,
    y: anchor.y - (anchor.y - pan.y) * ratio
  };
}

/** Provides CAD-style pan and zoom controls for the Screen canvas viewport. */
export class ScreenCanvasViewportController {
  /** Stores browser collaborators and initializes the camera at the origin. */
  constructor({ documentObject, windowObject, renderRulers, isRenderOnly = false }) {
    this.document = documentObject;
    this.window = windowObject;
    this.renderRulers = renderRulers;
    this.isRenderOnly = isRenderOnly;
    this.preview = documentObject.getElementById("screen-preview");
    this.main = documentObject.getElementById("main");
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.spacePressed = false;
    this.activePointer = null;
    this.centerAnimationTimer = null;
    this.centerAnimationFrame = null;
  }

  /** Binds pointer, keyboard, wheel, and toolbar interactions for the canvas camera. */
  bind() {
    if (this.isRenderOnly || !this.preview) return;

    // Let users pan with the middle button, Space+left-drag, or left-drag on empty canvas.
    this.preview.addEventListener("pointerdown", (event) => this.startPan(event), true);
    this.preview.addEventListener("pointermove", (event) => this.movePan(event));
    this.preview.addEventListener("pointerup", (event) => this.endPan(event));
    this.preview.addEventListener("pointercancel", (event) => this.endPan(event));
    this.preview.addEventListener("lostpointercapture", (event) => this.endPan(event));

    // Zoom around the pointer so the location under the cursor stays fixed.
    this.preview.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });

    // Track Space as a pan modifier without taking keyboard focus from editor controls.
    this.document.addEventListener("keydown", (event) => this.handleKeyDown(event));
    this.document.addEventListener("keyup", (event) => this.handleKeyUp(event));
    this.window.addEventListener("blur", () => this.clearPanModifier());

    // Keep toolbar zoom controls synchronized with camera changes.
    this.bindZoomControls();
    this.applyCamera();
  }

  /** Registers zoom buttons and restores the default camera when reset is selected. */
  bindZoomControls() {
    for (const [zoomOutId, zoomResetId, zoomInId] of CANVAS_ZOOM_CONTROL_SETS) {
      this.document.getElementById(zoomOutId)?.addEventListener("click", () =>
        this.setZoom(this.zoom - ZOOM_STEP)
      );
      this.document.getElementById(zoomInId)?.addEventListener("click", () =>
        this.setZoom(this.zoom + ZOOM_STEP)
      );
      this.document.getElementById(zoomResetId)?.addEventListener("click", () =>
        this.resetCamera()
      );
    }
    this.bindGridToggle();
    this.updateZoomControls();
  }

  /** Toggles the visual Screen grid without changing placement behavior. */
  bindGridToggle() {
    if (!this.preview || !this.main) return;
    this.main.classList.add("screen-grid-visible");
    const gridToggles = CANVAS_GRID_TOGGLE_IDS
      .map((id) => this.document.getElementById(id))
      .filter(Boolean);
    for (const gridToggle of gridToggles) {
      gridToggle.addEventListener("click", () => this.toggleGrid());
    }
    this.updateGridToggleControls(gridToggles);
  }

  /** Toggles the Screen grid and synchronizes every available grid control. */
  toggleGrid() {
    const isVisible = this.main.classList.toggle("screen-grid-visible");
    const gridToggles = CANVAS_GRID_TOGGLE_IDS
      .map((id) => this.document.getElementById(id))
      .filter(Boolean);
    this.updateGridToggleControls(gridToggles, isVisible);
  }

  /** Updates grid toggle accessibility state and action hints. */
  updateGridToggleControls(gridToggles, isVisible = this.main.classList.contains("screen-grid-visible")) {
    for (const gridToggle of gridToggles) {
      gridToggle.setAttribute("aria-pressed", String(isVisible));
      gridToggle.title = `${isVisible ? "Hide" : "Show"} Screen grid`;
    }
  }

  /** Starts a pan gesture for supported buttons without intercepting placement interactions. */
  startPan(event) {
    if (!this.isViewportActive() || this.isSelectionModeActive()) return;
    const usesMiddleButton = event.button === 1;
    if (!usesMiddleButton && !this.usesLeftButtonPan(event)) return;

    this.cancelCenterAnimation();
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

  /** Allows left-button panning in read-only views or on empty Screen canvas. */
  usesLeftButtonPan(event) {
    if (event.button !== 0) return false;
    if (this.spacePressed ||
        this.main?.classList.contains("workflow-editing") ||
        this.main?.classList.contains("spec-editing")) return true;
    return !this.isPlacementTarget(event);
  }

  /** Checks whether the pointer started inside a Screen placement. */
  isPlacementTarget(event) {
    const path = event.composedPath?.() || [];
    if (path.some((node) => node?.classList?.contains("material-frame"))) return true;
    return Boolean(event.target?.closest?.(".material-frame"));
  }

  /** Moves the viewport by the pointer delta without changing Screen coordinates. */
  movePan(event) {
    if (!this.activePointer || this.activePointer.id !== event.pointerId) return;
    this.pan.x += event.clientX - this.activePointer.x;
    this.pan.y += event.clientY - this.activePointer.y;
    this.activePointer.x = event.clientX;
    this.activePointer.y = event.clientY;
    this.applyCamera();
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

  /** Checks whether the editor is showing a Screen or spec canvas viewport. */
  isViewportActive() {
    return !this.isRenderOnly &&
      (this.main?.classList.contains("screen-editing") ||
        this.main?.classList.contains("spec-editing"));
  }

  /** Leaves annotation and marquee tools in control of their pointer interactions. */
  isSelectionModeActive() {
    return this.preview.classList.contains("annotation-mode") ||
      this.preview.classList.contains("marquee-selection-mode");
  }

  /** Centers a target, placing oversized targets at the top center. */
  centerOnTarget(target) {
    if (!target) return;
    this.cancelCenterAnimation();
    this.centerOnBounds(target.getBoundingClientRect());
  }

  /** Centers the combined bounds of several Screen placements. */
  centerOnTargets(targets, { preferLargestTarget = false } = {}) {
    this.cancelCenterAnimation();
    const targetBounds = targets.map((target) => target.getBoundingClientRect());
    const primaryTargets = preferLargestTarget
      ? targetBounds.filter((rect) => rect.width <= this.preview.clientWidth)
      : [];
    const bounds = primaryTargets.length
      ? primaryTargets.reduce((largest, rect) =>
        rect.width * rect.height > largest.width * largest.height ? rect : largest
      )
      : this.getCombinedBounds(targetBounds);
    if (!bounds) return;
    this.centerOnBounds(bounds);
  }

  /** Combines viewport rectangles into one rectangle. */
  getCombinedBounds(rectangles) {
    const bounds = rectangles.reduce((combined, rect) => {
      if (!combined) {
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      }
      combined.left = Math.min(combined.left, rect.left);
      combined.top = Math.min(combined.top, rect.top);
      combined.right = Math.max(combined.right, rect.right);
      combined.bottom = Math.max(combined.bottom, rect.bottom);
      return combined;
    }, null);
    if (!bounds) return null;
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top
    };
  }

  /** Centers visible bounds and aligns oversized content to the top center. */
  centerOnBounds(bounds) {
    if (!this.preview?.clientWidth || !this.preview?.clientHeight) return;
    const viewport = this.preview.getBoundingClientRect();
    const left = viewport.left + this.preview.clientLeft;
    const top = viewport.top + this.preview.clientTop;
    const width = this.preview.clientWidth;
    const height = this.preview.clientHeight;
    const isOversized = bounds.width > width || bounds.height > height;
    const panDeltaX = left + width / 2 - (bounds.left + bounds.width / 2);
    const panDeltaY = isOversized
      ? top - bounds.top
      : top + height / 2 - (bounds.top + bounds.height / 2);
    this.preview.classList.add("is-camera-animating");
    this.pan.x += panDeltaX;
    this.pan.y += panDeltaY;
    this.applyCamera();
    this.scheduleRulerAnimationFrame();
    this.centerAnimationTimer = this.window.setTimeout(
      () => this.cancelCenterAnimation(),
      500
    );
  }

  /** Stops a camera transition before a new direct manipulation or recentering. */
  cancelCenterAnimation() {
    const wasAnimating = this.centerAnimationTimer !== null ||
      this.preview?.classList.contains("is-camera-animating");
    if (this.centerAnimationTimer !== null) {
      this.window.clearTimeout(this.centerAnimationTimer);
      this.centerAnimationTimer = null;
    }
    if (this.centerAnimationFrame !== null) {
      if (this.window.cancelAnimationFrame) {
        this.window.cancelAnimationFrame(this.centerAnimationFrame);
      } else {
        this.window.clearTimeout(this.centerAnimationFrame);
      }
      this.centerAnimationFrame = null;
    }
    this.preview?.classList.remove("is-camera-animating");
    if (wasAnimating) this.renderRulers();
  }

  /** Redraws the rulers against the live camera position until centering ends. */
  scheduleRulerAnimationFrame() {
    if (this.centerAnimationFrame !== null) return;
    const requestFrame = this.window.requestAnimationFrame ||
      ((callback) => this.window.setTimeout(callback, 16));
    this.centerAnimationFrame = requestFrame.call(this.window, () => {
      this.centerAnimationFrame = null;
      if (!this.preview?.classList.contains("is-camera-animating")) return;
      this.renderRulers();
      this.scheduleRulerAnimationFrame();
    });
  }

  /** Zooms toward the pointer position while preserving normal toolbar zoom limits. */
  handleWheel(event) {
    if (!this.isViewportActive() || this.isSelectionModeActive() || event.deltaY === 0) return;
    this.cancelCenterAnimation();
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = this.clampZoom(this.zoom * (1 + direction * ZOOM_STEP));
    const bounds = this.preview.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left - this.preview.clientLeft,
      y: event.clientY - bounds.top - this.preview.clientTop
    };
    this.setZoom(nextZoom, anchor);
  }

  /** Tracks the Space pan modifier and updates the viewport cursor. */
  handleKeyDown(event) {
    if (event.code !== "Space" || this.isInteractiveTarget(event.target) ||
        !this.isViewportActive() || this.isSelectionModeActive()) return;
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

  /** Clamps and applies a zoom value, optionally anchored at a viewport point. */
  setZoom(value, anchor = null) {
    this.cancelCenterAnimation();
    const nextZoom = this.clampZoom(value);
    if (anchor) {
      this.pan = getZoomAnchoredPan(this.pan, this.zoom, nextZoom, anchor);
    }
    this.zoom = nextZoom;
    this.applyCamera();
    this.updateZoomControls();
  }

  /** Constrains zoom to the supported minimum and maximum. */
  clampZoom(value) {
    return Math.max(MINIMUM_ZOOM, Math.min(MAXIMUM_ZOOM, Math.round(value * 100) / 100));
  }

  /** Resets both zoom and pan to the Screen's default origin. */
  resetCamera() {
    this.cancelCenterAnimation();
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.applyCamera();
    this.updateZoomControls();
  }

  /** Applies camera variables and redraws rulers to match the transformed Screen. */
  applyCamera() {
    if (!this.preview) return;
    this.preview.style.setProperty("--screen-canvas-zoom", String(this.zoom));
    this.preview.style.setProperty("--screen-canvas-pan-x", `${Number(this.pan.x.toFixed(2))}px`);
    this.preview.style.setProperty("--screen-canvas-pan-y", `${Number(this.pan.y.toFixed(2))}px`);
    this.preview.style.setProperty("--screen-canvas-grid-minor-size", `${20 * this.zoom}px`);
    this.preview.style.setProperty("--screen-canvas-grid-major-size", `${100 * this.zoom}px`);
    this.renderRulers();
  }

  /** Updates toolbar percentages and disables zoom buttons at their limits. */
  updateZoomControls() {
    for (const [zoomOutId, zoomResetId, zoomInId] of CANVAS_ZOOM_CONTROL_SETS) {
      const zoomOut = this.document.getElementById(zoomOutId);
      const zoomReset = this.document.getElementById(zoomResetId);
      const zoomIn = this.document.getElementById(zoomInId);
      if (zoomReset) zoomReset.textContent = `${Math.round(this.zoom * 100)}%`;
      if (zoomOut) zoomOut.disabled = this.zoom <= MINIMUM_ZOOM;
      if (zoomIn) zoomIn.disabled = this.zoom >= MAXIMUM_ZOOM;
    }
  }
}
