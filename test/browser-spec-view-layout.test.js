const assert = require("node:assert/strict");
const test = require("node:test");

function createElement() {
  return {
    attributes: {},
    listeners: new Map(),
    capturedPointer: null,
    hidden: false,
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    setPointerCapture(pointerId) {
      this.capturedPointer = pointerId;
    },
    hasPointerCapture(pointerId) {
      return this.capturedPointer === pointerId;
    },
    releasePointerCapture() {
      this.capturedPointer = null;
    },
    focus() {}
  };
}

function createHarness({ viewIdPrefix, resizerId, modes, headingId }) {
  const elements = new Map([
    ["main", createElement()],
    [resizerId, createElement()],
    [headingId, createElement()],
    ...modes.map((mode) => [`${viewIdPrefix}-${mode}`, createElement()])
  ]);
  const properties = new Map();
  const bodyClasses = new Set();
  const windowObject = {
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    getComputedStyle() {
      return { gridTemplateRows: "48px 300px 8px 452px 20px" };
    }
  };
  const documentObject = {
    body: { classList: {
      add: (name) => bodyClasses.add(name),
      remove: (name) => bodyClasses.delete(name)
    } },
    getElementById: (id) => elements.get(id),
  };
  elements.get("main").style = {
    setProperty(name, value) {
      properties.set(name, value);
    }
  };
  return { windowObject, documentObject, elements, properties, bodyClasses };
}

const SPEC_LAYOUT = {
  modes: ["split", "preview", "markdown"],
  viewIdPrefix: "spec-view",
  viewAttribute: "data-spec-view",
  headingId: "spec-view-heading",
  headingLabels: { split: "Preview", preview: "Preview", markdown: "Markdown" },
  resizerId: "spec-split-resizer",
  previewTrackProperty: "--spec-preview-track",
  editorTrackProperty: "--spec-markdown-track"
};

const ASSET_LAYOUT = {
  modes: ["split", "preview", "source"],
  viewIdPrefix: "asset-view",
  viewAttribute: "data-asset-view",
  headingId: "asset-view-heading",
  headingLabels: { split: "Preview", preview: "Preview", source: "Source" },
  resizerId: "asset-split-resizer",
  previewTrackProperty: "--asset-preview-track",
  editorTrackProperty: "--asset-source-track"
};

test("switches between split, preview, and Markdown layouts", async () => {
  const { SplitViewLayout } = await import("../browser/SplitViewLayout.mjs");
  const harness = createHarness(SPEC_LAYOUT);
  const controller = new SplitViewLayout({ ...harness, ...SPEC_LAYOUT });
  controller.bind();

  assert.equal(harness.elements.get("main").attributes["data-spec-view"], "split");
  assert.equal(harness.elements.get("spec-view-heading").textContent, "Preview");
  assert.equal(harness.elements.get("spec-view-split").attributes["aria-pressed"], "true");
  assert.equal(harness.elements.get(SPEC_LAYOUT.resizerId).hidden, false);

  harness.elements.get("spec-view-markdown").listeners.get("click")();
  assert.equal(harness.elements.get("main").attributes["data-spec-view"], "markdown");
  assert.equal(harness.elements.get("spec-view-heading").textContent, "Markdown");
  assert.equal(harness.elements.get("spec-view-markdown").attributes["aria-pressed"], "true");
  assert.equal(harness.elements.get(SPEC_LAYOUT.resizerId).hidden, true);

  harness.elements.get("spec-view-preview").listeners.get("click")();
  assert.equal(harness.elements.get("main").attributes["data-spec-view"], "preview");
  assert.equal(harness.elements.get("spec-view-preview").attributes["aria-pressed"], "true");
});

test("switches between split, preview, and asset source layouts", async () => {
  const { SplitViewLayout } = await import("../browser/SplitViewLayout.mjs");
  const harness = createHarness(ASSET_LAYOUT);
  const controller = new SplitViewLayout({ ...harness, ...ASSET_LAYOUT });
  controller.bind();

  assert.equal(harness.elements.get("main").attributes["data-asset-view"], "split");
  assert.equal(harness.elements.get("asset-view-heading").textContent, "Preview");
  assert.equal(harness.elements.get("asset-view-split").attributes["aria-pressed"], "true");
  assert.equal(harness.elements.get("asset-split-resizer").hidden, false);

  harness.elements.get("asset-view-source").listeners.get("click")();
  assert.equal(harness.elements.get("main").attributes["data-asset-view"], "source");
  assert.equal(harness.elements.get("asset-view-heading").textContent, "Source");
  assert.equal(harness.elements.get("asset-view-source").attributes["aria-pressed"], "true");
  assert.equal(harness.elements.get("asset-split-resizer").hidden, true);

  harness.elements.get("asset-view-preview").listeners.get("click")();
  assert.equal(harness.elements.get("main").attributes["data-asset-view"], "preview");
  assert.equal(harness.elements.get("asset-view-preview").attributes["aria-pressed"], "true");
});

test("supports bounded pointer and keyboard resizing", async () => {
  const { SplitViewLayout } = await import("../browser/SplitViewLayout.mjs");
  const harness = createHarness(SPEC_LAYOUT);
  const controller = new SplitViewLayout({ ...harness, ...SPEC_LAYOUT });
  controller.bind();
  const resizer = harness.elements.get(SPEC_LAYOUT.resizerId);
  let prevented = false;

  resizer.listeners.get("pointerdown")({
    button: 0,
    pointerId: 2,
    clientY: 100,
    preventDefault() {}
  });
  assert.equal(harness.bodyClasses.has("split-layout-resizing"), true);
  harness.windowObject.listeners.get("pointermove")({ pointerId: 2, clientY: 200 });
  assert.equal(
    Number.parseFloat(harness.properties.get(SPEC_LAYOUT.previewTrackProperty)),
    (400 / 752) * 100
  );
  assert.equal(resizer.attributes["aria-valuenow"], String(Math.round(400 / 752 * 100)));
  harness.windowObject.listeners.get("pointerup")({ pointerId: 2 });
  assert.equal(harness.bodyClasses.has("split-layout-resizing"), false);

  resizer.listeners.get("keydown")({
    key: "ArrowUp",
    shiftKey: true,
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(resizer.attributes["aria-valuenow"], String(Math.round(400 / 752 * 100) + 5));

  resizer.listeners.get("keydown")({
    key: "End",
    shiftKey: false,
    preventDefault() {}
  });
  assert.equal(resizer.attributes["aria-valuenow"], "71");
});
