const assert = require("node:assert/strict");
const test = require("node:test");

/** Ruler spacing adapts to zoom using readable intervals for labels and tick marks. */
test("chooses ruler intervals that remain readable at canvas zoom levels", async () => {
  const { getRulerTickInterval } = await import("../frontend/browser/ScreenRulerController.mjs");

  assert.equal(getRulerTickInterval(0.25), 500);
  assert.equal(getRulerTickInterval(1), 100);
  assert.equal(getRulerTickInterval(2), 50);
});

/** Checks that the created editor data has the expected structure and defaults. */
test("creates major and minor ticks in canvas pixel coordinates", async () => {
  const { getRulerTicks } = await import("../frontend/browser/ScreenRulerController.mjs");

  assert.deepEqual(getRulerTicks(75, 150, 1), [
    { value: 80, major: false, medium: false },
    { value: 90, major: false, medium: false },
    { value: 100, major: true, medium: false },
    { value: 110, major: false, medium: false },
    { value: 120, major: false, medium: false },
    { value: 130, major: false, medium: false },
    { value: 140, major: false, medium: false },
    { value: 150, major: false, medium: true }
  ]);
  assert.deepEqual(getRulerTicks(0, 50, 1), [
    { value: 0, major: true, medium: false },
    { value: 10, major: false, medium: false },
    { value: 20, major: false, medium: false },
    { value: 30, major: false, medium: false },
    { value: 40, major: false, medium: false },
    { value: 50, major: false, medium: true }
  ]);
  assert.deepEqual(getRulerTicks(-25, 25, 1), [
    { value: -20, major: false, medium: false },
    { value: -10, major: false, medium: false },
    { value: 0, major: true, medium: false },
    { value: 10, major: false, medium: false },
    { value: 20, major: false, medium: false }
  ]);
});

/** Zoom anchoring keeps the canvas point under the pointer stationary. */
test("anchors viewport zoom around the pointer position", async () => {
  const { getZoomAnchoredPan } = await import(
    "../frontend/browser/ScreenCanvasViewportController.mjs"
  );

  assert.deepEqual(
    getZoomAnchoredPan({ x: 10, y: -20 }, 1, 2, { x: 50, y: 30 }),
    { x: -30, y: -70 }
  );
});
