const PREVIEW_MIN_HEIGHT = 180;
const EDITOR_MIN_HEIGHT = 220;

export class SplitViewLayout {
  constructor({
    windowObject,
    documentObject,
    modes,
    viewIdPrefix,
    viewAttribute,
    headingId,
    headingLabels,
    resizerId,
    previewTrackProperty,
    editorTrackProperty
  }) {
    this.window = windowObject;
    this.document = documentObject;
    this.main = documentObject.getElementById("main");
    this.modes = modes;
    this.viewIdPrefix = viewIdPrefix;
    this.viewAttribute = viewAttribute;
    this.headingId = headingId;
    this.headingLabels = headingLabels;
    this.resizer = documentObject.getElementById(resizerId);
    this.previewTrackProperty = previewTrackProperty;
    this.editorTrackProperty = editorTrackProperty;
    this.ratio = 40;
    this.activeDrag = null;
  }

  bind() {
    for (const mode of this.modes) {
      this.document.getElementById(`${this.viewIdPrefix}-${mode}`).addEventListener("click", () =>
        this.setViewMode(mode)
      );
    }
    this.resizer.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.window.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.window.addEventListener("pointerup", (event) => this.endDrag(event));
    this.window.addEventListener("pointercancel", (event) => this.endDrag(event));
    this.resizer.addEventListener("lostpointercapture", (event) => this.endDrag(event));
    this.resizer.addEventListener("keydown", (event) => this.resizeFromKeyboard(event));
    this.window.addEventListener("resize", () => this.updateAriaValue());
    this.setViewMode("split");
  }

  setViewMode(mode) {
    if (!this.modes.includes(mode)) return;
    this.main.setAttribute(this.viewAttribute, mode);
    this.document.getElementById(this.headingId).textContent = this.headingLabels[mode];
    this.resizer.hidden = mode !== "split";
    for (const view of this.modes) {
      this.document.getElementById(`${this.viewIdPrefix}-${view}`)
        .setAttribute("aria-pressed", String(mode === view));
    }
    this.applyRatio();
    this.updateAriaValue();
  }

  readFlexibleTracks() {
    const rows = this.window.getComputedStyle(this.main).gridTemplateRows
      .split(/\s+/)
      .map((row) => Number.parseFloat(row));
    return {
      preview: rows[1] || PREVIEW_MIN_HEIGHT,
      editor: rows[3] || EDITOR_MIN_HEIGHT
    };
  }

  getRatioLimits(total) {
    if (total < PREVIEW_MIN_HEIGHT + EDITOR_MIN_HEIGHT) return { min: 50, max: 50 };
    return {
      min: (PREVIEW_MIN_HEIGHT / total) * 100,
      max: (1 - EDITOR_MIN_HEIGHT / total) * 100
    };
  }

  applyRatio() {
    this.main.style.setProperty(this.previewTrackProperty, `${this.ratio}fr`);
    this.main.style.setProperty(this.editorTrackProperty, `${100 - this.ratio}fr`);
  }

  updateAriaValue() {
    const { preview, editor } = this.readFlexibleTracks();
    const total = preview + editor;
    const limits = this.getRatioLimits(total);
    const nextRatio = Math.max(limits.min, Math.min(limits.max, this.ratio));
    if (Math.abs(nextRatio - this.ratio) > 0.01) {
      this.ratio = nextRatio;
      this.applyRatio();
    }
    this.resizer.setAttribute("aria-valuemin", String(Math.round(limits.min)));
    this.resizer.setAttribute("aria-valuemax", String(Math.round(limits.max)));
    this.resizer.setAttribute("aria-valuenow", String(Math.round(this.ratio)));
  }

  startDrag(event) {
    if (event.button !== 0 || this.activeDrag) return;
    event.preventDefault();
    this.resizer.focus();
    this.resizer.setPointerCapture(event.pointerId);
    const tracks = this.readFlexibleTracks();
    this.activeDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPreviewHeight: tracks.preview,
      total: tracks.preview + tracks.editor
    };
    this.document.body.classList.add("split-layout-resizing");
  }

  moveDrag(event) {
    const drag = this.activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const nextPreviewHeight = drag.startPreviewHeight + event.clientY - drag.startY;
    const limits = this.getRatioLimits(drag.total);
    this.ratio = Math.max(
      limits.min,
      Math.min(limits.max, (nextPreviewHeight / drag.total) * 100)
    );
    this.applyRatio();
    this.updateAriaValue();
  }

  endDrag(event) {
    if (!this.activeDrag || event.pointerId !== this.activeDrag.pointerId) return;
    this.activeDrag = null;
    this.document.body.classList.remove("split-layout-resizing");
    if (this.resizer.hasPointerCapture(event.pointerId)) {
      this.resizer.releasePointerCapture(event.pointerId);
    }
  }

  resizeFromKeyboard(event) {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tracks = this.readFlexibleTracks();
    const limits = this.getRatioLimits(tracks.preview + tracks.editor);
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "Home") this.ratio = limits.min;
    else if (event.key === "End") this.ratio = limits.max;
    else this.ratio += (event.key === "ArrowUp" ? step : -step);
    this.ratio = Math.max(limits.min, Math.min(limits.max, this.ratio));
    this.applyRatio();
    this.updateAriaValue();
  }
}
