const assert = require("node:assert/strict");
const test = require("node:test");

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.classes = new Set();
    this.attributes = new Map();
    this.styleValues = new Map();
    this.textContent = "";
    this.capturedPointer = null;
    this.clientWidth = 0;
    this.clientHeight = 0;
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
  }

  querySelector() {
    return this.sample || null;
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

  setPointerCapture(pointerId) {
    this.capturedPointer = pointerId;
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointer === pointerId;
  }

  releasePointerCapture() {
    this.capturedPointer = null;
  }
}

function createHarness() {
  const main = new FakeElement();
  const preview = new FakeElement();
  const documentObject = {
    listeners: new Map(),
    getElementById: (id) => elements.get(id),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
    dispatch(name, event) {
      this.listeners.get(name)?.(event);
    }
  };
  const elements = new Map([
    ["main", main],
    ["screen-preview", preview],
    ["material-canvas-zoom-out", new FakeElement()],
    ["material-canvas-zoom-reset", new FakeElement()],
    ["material-canvas-zoom-in", new FakeElement()],
    ["material-canvas-grid-toggle", new FakeElement()]
  ]);
  return {
    main,
    preview,
    elements,
    documentObject
  };
}

/** Material zoom remains anchored at the top-left instead of following the wheel pointer. */
test("zooms the Material preview from its fixed top-left origin", async () => {
  const { MaterialCanvasViewportController } = await import(
    "../frontend/browser/MaterialCanvasViewportController.mjs"
  );
  const harness = createHarness();
  const renderedRulerScales = [];
  const controller = new MaterialCanvasViewportController({
    documentObject: harness.documentObject,
    renderRulers: () => renderedRulerScales.push(controller.zoom)
  });
  controller.bind();
  harness.main.classList.add("material-editing");

  const wheelEvent = harness.preview.dispatch("wheel", {
    deltaY: -1,
    clientX: 240,
    clientY: 180
  });
  assert.equal(wheelEvent.defaultPrevented, true);
  assert.equal(harness.preview.styleValues.get("--material-canvas-zoom"), "1.1");
  assert.equal(renderedRulerScales.at(-1), 1.1);

  harness.elements.get("material-canvas-zoom-in").dispatch("click");
  assert.equal(harness.preview.styleValues.get("--material-canvas-zoom"), "1.2");
  assert.equal(harness.elements.get("material-canvas-zoom-reset").textContent, "120%");

  harness.elements.get("material-canvas-zoom-reset").dispatch("click");
  assert.equal(harness.preview.styleValues.get("--material-canvas-zoom"), "1");
  assert.equal(harness.elements.get("material-canvas-zoom-reset").textContent, "100%");
});

/** Centers the sample at the active zoom without changing its preview dimensions. */
test("centers the Material sample in the canvas", async () => {
  const { MaterialCanvasViewportController } = await import(
    "../frontend/browser/MaterialCanvasViewportController.mjs"
  );
  const harness = createHarness();
  harness.preview.clientWidth = 500;
  harness.preview.clientHeight = 400;
  harness.preview.sample = { offsetWidth: 200, offsetHeight: 100 };
  const controller = new MaterialCanvasViewportController({
    documentObject: harness.documentObject,
    renderRulers() {}
  });
  controller.bind();
  controller.setZoom(1.2);

  assert.equal(controller.centerMaterial(), true);
  assert.equal(controller.pan.x, 130);
  assert.equal(controller.pan.y, 140);
  assert.equal(harness.preview.styleValues.get("--material-canvas-pan-x"), "130px");
  assert.equal(harness.preview.styleValues.get("--material-canvas-pan-y"), "140px");
});

/** Panning translates the canvas but zoom keeps its current origin point fixed. */
test("pans the Material canvas and preserves its origin while zooming", async () => {
  const { MaterialCanvasViewportController } = await import(
    "../frontend/browser/MaterialCanvasViewportController.mjs"
  );
  const harness = createHarness();
  const controller = new MaterialCanvasViewportController({
    documentObject: harness.documentObject,
    renderRulers() {}
  });
  controller.bind();
  harness.main.classList.add("material-editing");
  harness.preview.classList.add("annotation-mode");

  const annotationPointerDown = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 6,
    clientX: 2,
    clientY: 3,
    target: { closest: () => null },
    composedPath: () => []
  });
  assert.equal(annotationPointerDown.defaultPrevented, undefined);
  assert.equal(controller.activePointer, null);
  harness.preview.classList.remove("annotation-mode");

  const pointerDown = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 7,
    clientX: 20,
    clientY: 30,
    target: { closest: () => null },
    composedPath: () => []
  });
  assert.equal(pointerDown.defaultPrevented, true);
  assert.equal(pointerDown.propagationStopped, true);

  harness.preview.dispatch("pointermove", {
    pointerId: 7,
    clientX: 55,
    clientY: 5
  });
  assert.equal(harness.preview.styleValues.get("--material-canvas-pan-x"), "35px");
  assert.equal(harness.preview.styleValues.get("--material-canvas-pan-y"), "-25px");

  harness.preview.dispatch("wheel", { deltaY: -1, clientX: 200, clientY: 180 });
  assert.equal(harness.preview.styleValues.get("--material-canvas-zoom"), "1.1");
  assert.equal(harness.preview.styleValues.get("--material-canvas-pan-x"), "35px");
  assert.equal(harness.preview.styleValues.get("--material-canvas-pan-y"), "-25px");

  harness.preview.dispatch("pointerup", { pointerId: 7 });
  assert.equal(harness.preview.classList.contains("is-panning"), false);
  assert.equal(harness.preview.capturedPointer, null);
});

/** Space+left-drag pans across the Material sample without triggering its resize selection. */
test("uses Space to pan over the Material sample", async () => {
  const { MaterialCanvasViewportController } = await import(
    "../frontend/browser/MaterialCanvasViewportController.mjs"
  );
  const harness = createHarness();
  const controller = new MaterialCanvasViewportController({
    documentObject: harness.documentObject,
    renderRulers() {}
  });
  controller.bind();
  harness.main.classList.add("material-editing");

  const spaceDown = {
    code: "Space",
    target: { tagName: "BODY" },
    preventDefault() { this.defaultPrevented = true; }
  };
  harness.documentObject.dispatch("keydown", spaceDown);
  assert.equal(spaceDown.defaultPrevented, true);

  const pointerDown = harness.preview.dispatch("pointerdown", {
    button: 0,
    pointerId: 8,
    clientX: 10,
    clientY: 15,
    target: { closest: () => ({}) },
    composedPath: () => []
  });
  assert.equal(pointerDown.defaultPrevented, true);
  assert.equal(harness.preview.classList.contains("is-panning"), true);
});

/** The Material grid toggle only changes its own canvas presentation. */
test("toggles the Material canvas grid", async () => {
  const { MaterialCanvasViewportController } = await import(
    "../frontend/browser/MaterialCanvasViewportController.mjs"
  );
  const harness = createHarness();
  const controller = new MaterialCanvasViewportController({
    documentObject: harness.documentObject,
    renderRulers() {}
  });
  const gridToggle = harness.elements.get("material-canvas-grid-toggle");
  controller.bind();

  assert.equal(harness.main.classList.contains("material-grid-visible"), true);
  assert.equal(gridToggle.attributes.get("aria-pressed"), "true");
  gridToggle.dispatch("click");
  assert.equal(harness.main.classList.contains("material-grid-visible"), false);
  assert.equal(gridToggle.attributes.get("aria-pressed"), "false");
  assert.equal(gridToggle.title, "Show Material canvas grid");
});
