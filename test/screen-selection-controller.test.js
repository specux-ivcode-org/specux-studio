const assert = require("node:assert/strict");
const test = require("node:test");

function frame(path, bounds) {
  return {
    dataset: { instancePath: JSON.stringify(path) },
    getBoundingClientRect: () => bounds
  };
}

test("marquee selection includes fully enclosed placements but excludes partial intersections and placements under its start point", async () => {
  const { getMarqueeSelectedPaths } =
    await import("../frontend/browser/ScreenSelectionController.mjs");
  const candidates = [
    { path: [0], bounds: { left: 0, top: 0, right: 1000, bottom: 800 } },
    { path: [1], bounds: { left: 90, top: 90, right: 180, bottom: 160 } },
    { path: [2], bounds: { left: 150, top: 100, right: 230, bottom: 180 } },
    { path: [3], bounds: { left: 400, top: 400, right: 500, bottom: 500 } },
    { path: [4], bounds: { left: 10, top: 150, right: 200, bottom: 200 } },
    { path: [5], bounds: { left: 5, top: 100, right: 50, bottom: 150 } }
  ];

  assert.deepEqual(
    getMarqueeSelectedPaths(
      candidates,
      { left: 10, top: 10, right: 200, bottom: 200 },
      { x: 20, y: 20 }
    ),
    [[1], [4]]
  );
});

test("drag-select collects visible root placements and replaces the current selection", async () => {
  const { ScreenSelectionController } =
    await import("../frontend/browser/ScreenSelectionController.mjs");
  const rootFrame = frame([0], { left: 0, top: 0, right: 800, bottom: 600 });
  const firstFrame = frame([1], { left: 100, top: 100, right: 160, bottom: 150 });
  const secondFrame = frame([2], { left: 150, top: 120, right: 230, bottom: 190 });
  const content = {
    offsetWidth: 800,
    offsetHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    querySelectorAll: () => [rootFrame, firstFrame, secondFrame]
  };
  const selected = [];
  const controller = new ScreenSelectionController({
    state: {},
    services: {
      byId: () => ({ querySelector: () => content }),
      selectInstances: (paths) => selected.push(paths)
    }
  });
  controller.screenId = "home";
  controller.tool = "marquee";
  controller.overlay = {
    parentElement: content,
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  controller.rectangle = { style: {}, hidden: true };

  controller.onPointerDown({
    button: 0,
    pointerId: 7,
    clientX: 20,
    clientY: 20,
    preventDefault() {},
    stopPropagation() {}
  });
  controller.onPointerMove({
    pointerId: 7,
    clientX: 200,
    clientY: 180
  });
  controller.onPointerUp({ pointerId: 7 });

  assert.deepEqual(selected, [[[1]]]);
});

test("clicking in Drag to select clears the selection", async () => {
  const { ScreenSelectionController } =
    await import("../frontend/browser/ScreenSelectionController.mjs");
  const selected = [];
  const controller = new ScreenSelectionController({
    state: {},
    services: {
      selectInstances: (paths) => selected.push(paths)
    }
  });
  controller.screenId = "home";
  controller.tool = "marquee";
  controller.overlay = {
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  controller.rectangle = { style: {}, hidden: true };
  controller.updateRectangle = () => {};

  controller.onPointerDown({
    button: 0,
    pointerId: 2,
    clientX: 120,
    clientY: 140,
    preventDefault() {},
    stopPropagation() {}
  });
  controller.onPointerUp({ pointerId: 2 });

  assert.deepEqual(selected, [[]]);
});

test("scale mode is temporary and updates the active toolbar control", async () => {
  const { ScreenSelectionController } =
    await import("../frontend/browser/ScreenSelectionController.mjs");
  const buttons = ["xy", "transform"].map((scaleType) => ({
    dataset: { scaleType },
    setAttribute(name, value) { this[name] = value; }
  }));
  const controller = new ScreenSelectionController({
    state: {},
    services: {
      document: {
        querySelectorAll(selector) {
          return selector === "[data-scale-type]" ? buttons : [];
        }
      }
    }
  });
  controller.screenId = "home";
  controller.selectScaleType("transform");

  assert.equal(controller.scaleType, "transform");
  assert.equal(buttons[0]["aria-pressed"], "false");
  assert.equal(buttons[1]["aria-pressed"], "true");
  assert.equal(controller.state.scaleType, undefined);
});

test("context-menu handling works through the marquee overlay and normal canvas", async () => {
  const { ScreenSelectionController } =
    await import("../frontend/browser/ScreenSelectionController.mjs");
  const hitFrame = {
    classList: { contains: (name) => name === "material-frame" },
    dataset: { instancePath: "[3]" }
  };
  const calls = [];
  const controller = new ScreenSelectionController({
    state: {},
    services: {
      document: { elementsFromPoint: () => [hitFrame] },
      openPlacementContextMenu: (_event, path) => calls.push(path)
    }
  });
  const event = {
    clientX: 100,
    clientY: 100,
    composedPath: () => [{ classList: { contains: () => false } }],
    preventDefault() {},
    stopPropagation() {}
  };

  controller.onContextMenu(event);

  assert.deepEqual(calls, [[3]]);
  calls.length = 0;
  controller.services.document.elementsFromPoint = () => [];
  controller.onContextMenu({
    ...event,
    composedPath: () => [hitFrame]
  });
  assert.deepEqual(calls, [[3]]);
});
