const RULER_TARGET_SPACING = 80;
const TICKS_PER_MAJOR = 10;

/** Returns a readable ruler interval for the supplied canvas zoom. */
export function getRulerTickInterval(scale) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const targetInterval = RULER_TARGET_SPACING / safeScale;
  const magnitude = 10 ** Math.floor(Math.log10(targetInterval));
  for (const multiplier of [1, 2, 5, 10]) {
    const interval = multiplier * magnitude;
    if (interval >= targetInterval) return interval;
  }
  return 10 * magnitude;
}

/** Builds major and minor ruler ticks for the requested canvas range. */
export function getRulerTicks(start, end, scale) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const majorInterval = getRulerTickInterval(scale);
  const minorInterval = majorInterval / TICKS_PER_MAJOR;
  const firstIndex = Math.ceil(start / minorInterval - 1e-9);
  const lastIndex = Math.floor(end / minorInterval + 1e-9);
  const ticks = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const value = index * minorInterval;
    ticks.push({
      value: Math.abs(value) < 1e-9 ? 0 : value,
      major: index % TICKS_PER_MAJOR === 0,
      medium: index % TICKS_PER_MAJOR === TICKS_PER_MAJOR / 2
    });
  }
  return ticks;
}

/** Calculates and renders canvas rulers at the active zoom level. */
export class ScreenRulerController {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ documentObject, windowObject }) {
    this.document = documentObject;
    this.window = windowObject;
    this.frame = documentObject.getElementById("screen-canvas-viewport");
    this.preview = documentObject.getElementById("screen-preview");
    this.horizontalRuler = documentObject.getElementById("screen-ruler-x");
    this.verticalRuler = documentObject.getElementById("screen-ruler-y");
    this.renderQueued = false;
    this.resizeObserver = null;
    this.mutationObserver = null;
    this.scheduleRender = this.scheduleRender.bind(this);
  }

  /** Attaches the configured event listeners to the editor controls. */
  bind() {
    if (!this.frame || !this.preview || !this.horizontalRuler || !this.verticalRuler) return;
    this.preview.addEventListener("scroll", this.scheduleRender, { passive: true });
    this.window.addEventListener("resize", this.scheduleRender);

    const ResizeObserverClass = this.window.ResizeObserver;
    if (ResizeObserverClass) {
      this.resizeObserver = new ResizeObserverClass(this.scheduleRender);
      this.resizeObserver.observe(this.frame);
      this.resizeObserver.observe(this.preview);
    }

    const MutationObserverClass = this.window.MutationObserver;
    if (MutationObserverClass) {
      this.mutationObserver = new MutationObserverClass(this.scheduleRender);
      this.mutationObserver.observe(this.preview, { childList: true });
    }
    this.render();
  }

  /** Updates the render for the current editor state. */
  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    const requestFrame = this.window.requestAnimationFrame ||
      ((callback) => this.window.setTimeout(callback, 0));
    requestFrame.call(this.window, () => {
      this.renderQueued = false;
      this.render();
    });
  }

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  render() {
    const geometry = this.getRulerGeometry();
    if (!geometry) return;
    const { originX, originY, scaleX, scaleY, viewportWidth, viewportHeight } = geometry;
    this.drawAxis(this.horizontalRuler, "x", originX, scaleX, viewportWidth);
    this.drawAxis(this.verticalRuler, "y", originY, scaleY, viewportHeight);
  }

  /** Returns the ruler geometry. */
  getRulerGeometry() {
    if (!this.isRulerPreviewVisible()) return;
    const content = this.preview.querySelector(":scope > .form-content");
    if (!content) return;

    const previewRect = this.preview.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const contentWidth = content.offsetWidth || contentRect.width;
    const contentHeight = content.offsetHeight || contentRect.height;
    const scale = this.getContentScale(contentRect, contentWidth, contentHeight);
    if (!scale) return;

    return {
      originX: contentRect.left - previewRect.left - this.preview.clientLeft,
      originY: contentRect.top - previewRect.top - this.preview.clientTop,
      ...scale,
      viewportWidth: this.preview.clientWidth,
      viewportHeight: this.preview.clientHeight
    };
  }

  /** Checks whether the Screen canvas and preview are visible for ruler rendering. */
  isRulerPreviewVisible() {
    return this.frame && this.preview && !this.frame.hidden && !this.preview.hidden;
  }

  /** Returns the content scale. */
  getContentScale(contentRect, contentWidth, contentHeight) {
    const scaleX = contentRect.width / (contentWidth || 1);
    const scaleY = contentRect.height / (contentHeight || 1);
    return scaleX > 0 && scaleY > 0 ? { scaleX, scaleY } : null;
  }

  /** Updates the axis for the current editor state. */
  drawAxis(canvas, axis, origin, scale, viewportSize) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0 || viewportSize <= 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const pixelRatio = Math.max(1, this.window.devicePixelRatio || 1);
    const bitmapWidth = Math.round(width * pixelRatio);
    const bitmapHeight = Math.round(height * pixelRatio);
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const start = -origin / scale;
    const end = (viewportSize - origin) / scale;
    const ticks = getRulerTicks(start, end, scale);
    const style = this.window.getComputedStyle(canvas);
    const lineColor = style.getPropertyValue("--line").trim() || style.color;
    context.strokeStyle = lineColor;
    context.fillStyle = style.color;
    context.lineWidth = 1;
    context.font = "9px Inter, 'Segoe UI', Arial, sans-serif";

    if (axis === "x") {
      this.drawHorizontalAxis(context, ticks, origin, scale, width, height);
      return;
    }

    this.drawVerticalAxis(context, ticks, origin, scale, width, height);
  }

  /** Updates the horizontal axis for the current editor state. */
  drawHorizontalAxis(context, ticks, origin, scale, width, height) {
    context.textAlign = "left";
    context.textBaseline = "top";
    context.beginPath();
    context.moveTo(0, height - 0.5);
    context.lineTo(width, height - 0.5);
    context.stroke();
    for (const tick of ticks) {
      const position = origin + tick.value * scale;
      const tickLength = this.getTickLength(tick);
      context.beginPath();
      context.moveTo(position + 0.5, height);
      context.lineTo(position + 0.5, height - tickLength);
      context.stroke();
      if (tick.major) context.fillText(String(tick.value), position + 3, 3);
    }
  }

  /** Updates the vertical axis for the current editor state. */
  drawVerticalAxis(context, ticks, origin, scale, width, height) {
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.beginPath();
    context.moveTo(width - 0.5, 0);
    context.lineTo(width - 0.5, height);
    context.stroke();
    for (const tick of ticks) {
      const position = origin + tick.value * scale;
      const tickLength = this.getTickLength(tick);
      context.beginPath();
      context.moveTo(width, position + 0.5);
      context.lineTo(width - tickLength, position + 0.5);
      context.stroke();
      if (tick.major) {
        const labelPosition = Math.max(5, Math.min(height - 5, position));
        context.fillText(String(tick.value), width - 4, labelPosition);
      }
    }
  }

  /** Returns the tick length. */
  getTickLength(tick) {
    return tick.major ? 10 : tick.medium ? 7 : 4;
  }
}
