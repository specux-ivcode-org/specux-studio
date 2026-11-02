const RULER_TARGET_SPACING = 80;
const TICKS_PER_MAJOR = 10;

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

export class ScreenRulerController {
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

  render() {
    if (!this.frame || !this.preview || this.frame.hidden || this.preview.hidden) return;
    const content = this.preview.querySelector(":scope > .form-content");
    if (!content) return;

    const previewRect = this.preview.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const contentWidth = content.offsetWidth || contentRect.width;
    const contentHeight = content.offsetHeight || contentRect.height;
    const scaleX = contentRect.width / (contentWidth || 1);
    const scaleY = contentRect.height / (contentHeight || 1);
    if (!(scaleX > 0) || !(scaleY > 0)) return;

    const originX = contentRect.left - previewRect.left - this.preview.clientLeft;
    const originY = contentRect.top - previewRect.top - this.preview.clientTop;
    this.drawAxis(
      this.horizontalRuler,
      "x",
      originX,
      scaleX,
      this.preview.clientWidth
    );
    this.drawAxis(
      this.verticalRuler,
      "y",
      originY,
      scaleY,
      this.preview.clientHeight
    );
  }

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
    const start = Math.max(0, -origin / scale);
    const end = (viewportSize - origin) / scale;
    const ticks = getRulerTicks(start, end, scale);
    const style = this.window.getComputedStyle(canvas);
    const lineColor = style.getPropertyValue("--line").trim() || style.color;
    context.strokeStyle = lineColor;
    context.fillStyle = style.color;
    context.lineWidth = 1;
    context.font = "9px Inter, 'Segoe UI', Arial, sans-serif";

    if (axis === "x") {
      context.textAlign = "left";
      context.textBaseline = "top";
      context.beginPath();
      context.moveTo(0, height - 0.5);
      context.lineTo(width, height - 0.5);
      context.stroke();
      for (const tick of ticks) {
        const position = origin + tick.value * scale;
        const tickLength = tick.major ? 10 : tick.medium ? 7 : 4;
        context.beginPath();
        context.moveTo(position + 0.5, height);
        context.lineTo(position + 0.5, height - tickLength);
        context.stroke();
        if (tick.major) context.fillText(String(tick.value), position + 3, 3);
      }
      return;
    }

    context.textAlign = "right";
    context.textBaseline = "middle";
    context.beginPath();
    context.moveTo(width - 0.5, 0);
    context.lineTo(width - 0.5, height);
    context.stroke();
    for (const tick of ticks) {
      const position = origin + tick.value * scale;
      const tickLength = tick.major ? 10 : tick.medium ? 7 : 4;
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
}
