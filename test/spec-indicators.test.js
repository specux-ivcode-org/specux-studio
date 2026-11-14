const assert = require("node:assert/strict");
const test = require("node:test");

test("placement indicators match the owning Screen and complete instance path", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const renderer = Object.create(InspectorRenderer.prototype);
  renderer.state = {
    screens: [
      { file: "screens/home/screen.yml" },
      { file: "screens/settings/screen.yml" }
    ],
    activeScreenIndex: 0,
    elementSpecOwners: new Map([
      ["screens/home/specs/element-save.md", {
        screenFile: "screens/home/screen.yml",
        instancePath: [0, 1]
      }]
    ]),
    createdSpecDrafts: new Map()
  };
  renderer.services = {
    sameInstancePath: (left, right) =>
      left.length === right.length && left.every((part, index) => part === right[index])
  };

  assert.equal(renderer.hasPlacementSpec([0, 1]), true);
  assert.equal(renderer.hasPlacementSpec([0]), false);
  renderer.state.activeScreenIndex = 1;
  assert.equal(renderer.hasPlacementSpec([0, 1]), false);

  renderer.state.activeScreenIndex = 0;
  renderer.state.elementSpecOwners.clear();
  renderer.state.createdSpecDrafts.set("screens/home/specs/element-save.md", {
    owner: "instance",
    screenFile: "screens/home/screen.yml",
    instancePath: [0, 1]
  });
  assert.equal(renderer.hasPlacementSpec([0, 1]), true);
});

test("Layers spec markers are hidden until the toolbar toggle is enabled", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const renderer = Object.create(InspectorRenderer.prototype);
  renderer.state = { specIndicatorsEnabled: false };
  renderer.services = {
    element: (tag, className, textContent) => ({
      tag,
      className,
      textContent,
      setAttribute() {}
    })
  };
  const row = { children: [], append(child) { this.children.push(child); } };

  renderer.appendSpecIndicator(row, true);
  assert.equal(row.children.length, 0);
  renderer.state.specIndicatorsEnabled = true;
  renderer.appendSpecIndicator(row, true);
  assert.equal(row.children.length, 1);
  assert.equal(row.children[0].className, "spec-indicator");
});

test("the persistent toolbar indicator control toggles workspace state", async () => {
  const { EditorEventController } = await import("../frontend/browser/EditorEventController.mjs");
  let handler;
  const enabled = [];
  const controller = Object.create(EditorEventController.prototype);
  controller.state = { specIndicatorsEnabled: false };
  controller.services = {
    byId: () => ({ addEventListener: (_name, callback) => { handler = callback; } }),
    setSpecIndicatorsEnabled: (value) => enabled.push(value)
  };

  controller.bindSpecIndicators();
  handler();

  assert.deepEqual(enabled, [true]);
});
