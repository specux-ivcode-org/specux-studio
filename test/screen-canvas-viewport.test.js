const assert = require("node:assert/strict");
const test = require("node:test");

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.classes = new Set();
    this.attributes = new Map();
    this.styleValues = new Map();
    this.classList = {
      add: (value) => this.classes.add(value),
      remove: (value) => this.classes.delete(value),
      contains: (value) => this.classes.has(value),
      toggle: (value) => {
        if (this.classes.has(value)) {
          this.classes.delete(value);
          return false;
        }
        this.classes.add(value);
        return true;
      }
    };
    this.style = {
      setProperty: (name, value) => this.styleValues.set(name, value)
    };
    this.clientLeft = 1;
    this.clientTop = 1;
    this.clientWidth = 400;
    this.clientHeight = 300;
    this.textContent = "";
    this.disabled = false;
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  dispatch(name, event = {}) {
    const dispatchedEvent = {
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...event
    };
    this.listeners.get(name)?.(dispatchedEvent);
    return dispatchedEvent;
  }

  getBoundingClientRect() {
    return { left: 100, top: 200 };
  }

  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
}

function createViewportHarness() {
  const preview = new FakeElement();
  const main = new FakeElement();
  main.classList.add("screen-editing");
  const elements = new Map([
    ["screen-preview", preview],
    ["main", main],
    ["screen-canvas-zoom-out", new FakeElement()],
    ["screen-canvas-zoom-reset", new FakeElement()],
    ["screen-canvas-zoom-in", new FakeElement()],
    ["screen-canvas-grid-toggle", new FakeElement()],
    ["workflow-canvas-zoom-out", new FakeElement()],
    ["workflow-canvas-zoom-reset", new FakeElement()],
    ["workflow-canvas-zoom-in", new FakeElement()],
    ["spec-canvas-zoom-out", new FakeElement()],
    ["spec-canvas-zoom-reset", new FakeElement()],
    ["spec-canvas-zoom-in", new FakeElement()],
    ["spec-canvas-grid-toggle", new FakeElement()]
  ]);
  const documentObject = {
    listeners: new Map(),
    getElementById: (id) => elements.get(id),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }
  };
  let nextTimerId = 0;
  let nextFrameId = 0;
  const timers = new Map();
  const frames = new Map();
  const windowObject = {
    listeners: new Map(),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
    setTimeout(callback) {
      const id = ++nextTimerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    runAnimationFrame() {
      const pendingFrames = [...frames.values()];
      frames.clear();
      pendingFrames.forEach((callback) => callback());
    },
    pendingAnimationFrameCount: () => frames.size,
    runTimers() {
      for (const callback of timers.values()) callback();
      timers.clear();
    }
  };
  let rulerRenderCount = 0;
  return {
    elements,
    preview,
    main,
    documentObject,
    windowObject,
    runTimers: () => windowObject.runTimers(),
    runAnimationFrame: () => windowObject.runAnimationFrame(),
    pendingAnimationFrameCount: () => windowObject.pendingAnimationFrameCount(),
    getRulerRenderCount: () => rulerRenderCount,
    renderRulers: () => { rulerRenderCount += 1; }
  };
}

/** Middle-button dragging pans the Screen without changing its placement data. */
test("pans the canvas by the pointer delta and ends cleanly on pointer release", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();

  harness.preview.dispatch("pointerdown", {
    button: 1,
    pointerId: 7,
    clientX: 20,
    clientY: 30
  });
  assert.equal(harness.preview.classList.contains("is-panning"), true);

  harness.preview.dispatch("pointermove", {
    pointerId: 7,
    clientX: 65,
    clientY: 5
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "45px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "-25px");

  harness.preview.dispatch("pointerup", { pointerId: 7 });
  assert.equal(harness.preview.classList.contains("is-panning"), false);
  assert.ok(harness.getRulerRenderCount() >= 2);
});

/** The Screen grid is visible by default and can be toggled without changing camera state. */
test("toggles the visual Screen grid", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  const gridToggle = harness.elements.get("screen-canvas-grid-toggle");
  controller.bind();

  assert.equal(harness.main.classList.contains("screen-grid-visible"), true);
  assert.equal(gridToggle.attributes.get("aria-pressed"), "true");
  assert.equal(gridToggle.title, "Hide Screen grid");

  gridToggle.dispatch("click");
  assert.equal(harness.main.classList.contains("screen-grid-visible"), false);
  assert.equal(gridToggle.attributes.get("aria-pressed"), "false");
  assert.equal(gridToggle.title, "Show Screen grid");
});

/** A plain left drag pans empty canvas but leaves placement interactions untouched. */
test("pans from empty canvas with left-drag without intercepting placements", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();

  const placementEvent = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 8,
    clientX: 20,
    clientY: 30,
    target: { closest: () => ({}) },
    composedPath: () => []
  });
  assert.equal(placementEvent.defaultPrevented, undefined);
  assert.equal(harness.preview.classList.contains("is-panning"), false);

  const emptyCanvasEvent = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 9,
    clientX: 20,
    clientY: 30,
    composedPath: () => []
  });
  assert.equal(emptyCanvasEvent.defaultPrevented, true);
  assert.equal(harness.preview.classList.contains("is-panning"), true);

  harness.preview.dispatch("pointermove", {
    pointerId: 9,
    clientX: 35,
    clientY: 10
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "15px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "-20px");
});

/** Workflow mode pans on left-drag even when the gesture starts over a placement. */
test("pans from placements with left-drag while editing a workflow", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  harness.main.classList.add("workflow-editing");
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();

  const pointerDown = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 10,
    clientX: 40,
    clientY: 50,
    target: { closest: () => ({}) },
    composedPath: () => []
  });
  assert.equal(pointerDown.defaultPrevented, true);
  assert.equal(harness.preview.classList.contains("is-panning"), true);

  harness.preview.dispatch("pointermove", {
    pointerId: 10,
    clientX: 25,
    clientY: 70
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "-15px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "20px");
});

/** Spec previews use left-drag for panning even when the gesture starts over a placement. */
test("pans from placements with left-drag while viewing a behavior spec", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  harness.main.classList.remove("screen-editing");
  harness.main.classList.add("spec-editing");
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();

  const pointerDown = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 12,
    clientX: 40,
    clientY: 50,
    target: { closest: () => ({}) },
    composedPath: () => []
  });
  assert.equal(pointerDown.defaultPrevented, true);
  assert.equal(harness.preview.classList.contains("is-panning"), true);

  harness.preview.dispatch("pointermove", {
    pointerId: 12,
    clientX: 25,
    clientY: 70
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "-15px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "20px");
});

/** Spec toolbar zoom and grid controls use the same camera as the Screen editor. */
test("controls spec preview zoom and synchronizes its grid toggle", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  const specZoomIn = harness.elements.get("spec-canvas-zoom-in");
  const specZoomReset = harness.elements.get("spec-canvas-zoom-reset");
  const screenGridToggle = harness.elements.get("screen-canvas-grid-toggle");
  const specGridToggle = harness.elements.get("spec-canvas-grid-toggle");
  controller.bind();

  specZoomIn.dispatch("click");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-zoom"), "1.1");
  assert.equal(specZoomReset.textContent, "110%");
  assert.equal(harness.elements.get("screen-canvas-zoom-reset").textContent, "110%");

  specGridToggle.dispatch("click");
  assert.equal(harness.main.classList.contains("screen-grid-visible"), false);
  assert.equal(specGridToggle.attributes.get("aria-pressed"), "false");
  assert.equal(screenGridToggle.attributes.get("aria-pressed"), "false");
});

/** Workflow selections are centered when they fit and top-aligned when oversized. */
test("centers workflow targets or aligns oversized targets at the top", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });

  controller.centerOnTarget({
    getBoundingClientRect: () => ({ left: 120, top: 220, width: 100, height: 80 })
  });
  assert.equal(harness.preview.classList.contains("is-camera-animating"), true);
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "131px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "91px");
  assert.equal(harness.pendingAnimationFrameCount(), 1);
  const rendersBeforeFrame = harness.getRulerRenderCount();
  harness.runAnimationFrame();
  assert.equal(harness.getRulerRenderCount(), rendersBeforeFrame + 1);
  assert.equal(harness.pendingAnimationFrameCount(), 1);
  harness.runTimers();
  assert.equal(harness.preview.classList.contains("is-camera-animating"), false);
  assert.equal(harness.pendingAnimationFrameCount(), 0);

  controller.resetCamera();
  controller.centerOnTarget({
    getBoundingClientRect: () => ({ left: 80, top: 100, width: 500, height: 400 })
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "-29px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "101px");
});

/** Recenter offsets are viewport pixels at zoom levels other than 100%. */
test("centers targets correctly at non-default zoom levels", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });

  controller.setZoom(0.5);
  controller.centerOnTarget({
    getBoundingClientRect: () => ({ left: 120, top: 220, width: 100, height: 80 })
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "131px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "91px");

  controller.resetCamera();
  controller.setZoom(1.5);
  controller.centerOnTarget({
    getBoundingClientRect: () => ({ left: 80, top: 100, width: 500, height: 400 })
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "-29px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "101px");
});

/** Direct pan input cancels recenter animation so dragging remains immediate. */
test("cancels camera animation when direct panning starts", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();
  controller.centerOnTarget({
    getBoundingClientRect: () => ({ left: 120, top: 220, width: 100, height: 80 })
  });
  harness.preview.dispatch("pointerdown", {
    button: 1,
    pointerId: 11,
    clientX: 20,
    clientY: 30
  });
  assert.equal(harness.preview.classList.contains("is-camera-animating"), false);
  assert.equal(harness.preview.classList.contains("is-panning"), true);
  harness.runTimers();
  assert.equal(harness.preview.classList.contains("is-camera-animating"), false);
});

/** Centers the combined visual bounds of the placements on a selected Screen. */
test("centers multiple Screen placements as one target", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });

  controller.centerOnTargets([
    { getBoundingClientRect: () => ({ left: 110, top: 210, right: 210, bottom: 260 }) },
    { getBoundingClientRect: () => ({ left: 250, top: 310, right: 350, bottom: 360 }) }
  ]);
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "71px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "66px");
});

/** A full-canvas scrim does not prevent centering smaller state-specific content. */
test("prefers the largest target over a full-canvas state overlay", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });

  controller.centerOnTargets([
    { getBoundingClientRect: () => ({ left: -100, top: -50, right: 1260, bottom: 850, width: 1360, height: 900 }) },
    { getBoundingClientRect: () => ({ left: 250, top: 300, right: 350, bottom: 380, width: 100, height: 80 }) }
  ], { preferLargestTarget: true });

  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "1px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "11px");
});

/** A state dialog taller than the viewport aligns to the top instead of its children. */
test("top-aligns an oversized primary state target", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });

  controller.centerOnTargets([
    { getBoundingClientRect: () => ({ left: -100, top: -50, right: 1260, bottom: 850, width: 1360, height: 900 }) },
    { getBoundingClientRect: () => ({ left: 150, top: 450, right: 500, bottom: 850, width: 350, height: 400 }) },
    { getBoundingClientRect: () => ({ left: 160, top: 470, right: 360, bottom: 516, width: 200, height: 46 }) }
  ], { preferLargestTarget: true });

  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "-24px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "-249px");
});

/** Wheel zoom keeps the pointer's canvas coordinate fixed and reset recenters the view. */
test("zooms around the pointer and resets pan and zoom from the toolbar", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();

  const wheelEvent = harness.preview.dispatch("wheel", {
    deltaY: -1,
    clientX: 151,
    clientY: 261
  });
  assert.equal(wheelEvent.defaultPrevented, true);
  assert.equal(harness.preview.styleValues.get("--screen-canvas-zoom"), "1.1");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "-5px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "-6px");
  assert.equal(harness.elements.get("screen-canvas-zoom-reset").textContent, "110%");

  harness.elements.get("screen-canvas-zoom-reset").dispatch("click");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-zoom"), "1");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "0px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "0px");
});

/** Space enables panning on the canvas without stealing button keyboard behavior. */
test("uses Space as a pan modifier except when a control owns the key", async () => {
  const { ScreenCanvasViewportController } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );
  const harness = createViewportHarness();
  const controller = new ScreenCanvasViewportController({
    documentObject: harness.documentObject,
    windowObject: harness.windowObject,
    renderRulers: harness.renderRulers
  });
  controller.bind();

  const buttonEvent = {
    code: "Space",
    target: { tagName: "BUTTON" },
    preventDefault() { this.defaultPrevented = true; }
  };
  controller.handleKeyDown(buttonEvent);
  assert.equal(buttonEvent.defaultPrevented, undefined);
  assert.equal(harness.preview.classList.contains("pan-ready"), false);

  const canvasEvent = {
    code: "Space",
    target: { tagName: "BODY" },
    preventDefault() { this.defaultPrevented = true; }
  };
  controller.handleKeyDown(canvasEvent);
  assert.equal(canvasEvent.defaultPrevented, true);
  assert.equal(harness.preview.classList.contains("pan-ready"), true);

  const pointerDown = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 9,
    clientX: 10,
    clientY: 15
  });
  assert.equal(pointerDown.propagationStopped, true);
  harness.preview.dispatch("pointermove", {
    pointerId: 9,
    clientX: 20,
    clientY: 5
  });
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-x"), "10px");
  assert.equal(harness.preview.styleValues.get("--screen-canvas-pan-y"), "-10px");
});
