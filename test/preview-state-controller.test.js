const assert = require("node:assert/strict");
const test = require("node:test");
const validation = require("../shared/validation");

/** Creates the controller using the supplied test selection and window. */
function createController(screen) {
  const state = {
    screens: [{ id: "home", data: screen }],
    activeScreenIndex: 0,
    activePreviewStateIds: new Map([["home", "dialog"]])
  };
  return import("../frontend/browser/PreviewStateController.mjs").then(
    ({ PreviewStateController }) => new PreviewStateController({
      state,
      services: { getScreenPreviewStates: validation.getPreviewStates }
    })
  );
}

/** Named states inherit unchanged Default values and serialize only differing placement and layer overrides. */
test("named states inherit placement and layer values and persist sparse edits", async () => {
  const screen = {
    layers: [{ id: "base", name: "Base" }],
    materials: [{
      id: "notice",
      attributes: { text: "Default", tone: "neutral" },
      position: { x: 10, y: 20 },
      size: { width: 120, height: 40 },
      rotation: 0
    }],
    "preview-states": [
      { id: "default", name: "Default" },
      {
        id: "dialog",
        name: "Dialog",
        description: "Show the dialog.",
        placements: {
          notice: {
            attributes: { tone: null },
            position: { x: 30, y: 20 }
          }
        }
      }
    ]
  };
  const controller = await createController(screen);
  const basePlacement = screen.materials[0];
  const resolved = controller.resolvePlacement(basePlacement, "dialog", screen);

  assert.deepEqual(resolved.position, { x: 30, y: 20 });
  assert.deepEqual(resolved.size, { width: 120, height: 40 });
  assert.deepEqual(resolved.attributes, { text: "Default" });
  assert.deepEqual(basePlacement.position, { x: 10, y: 20 });
  assert.equal(controller.isLayerVisible(screen.layers[0], "dialog", screen), true);

  resolved.position.x = 40;
  resolved.size.width = 160;
  resolved.attributes.text = "Dialog";
  controller.savePlacement({ data: screen }, resolved, "dialog");

  assert.deepEqual(screen["preview-states"][1].placements.notice, {
    attributes: { tone: null, text: "Dialog" },
    position: { x: 40, y: 20 },
    size: { width: 160, height: 40 }
  });
  assert.deepEqual(basePlacement.attributes, { text: "Default", tone: "neutral" });

  const addedPlacement = { id: "later", position: { x: 0, y: 0 }, size: { width: 24, height: 24 } };
  assert.deepEqual(controller.resolvePlacement(addedPlacement, "dialog", screen), addedPlacement);
});

/** Visibility inherits until overridden, and choosing Default removes the sparse override entry. */
test("state visibility overrides inherit and are removed when reset to Default", async () => {
  const screen = {
    layers: [{ id: "base", name: "Base", visible: false }],
    materials: [{ id: "notice", visible: false }],
    "preview-states": [
      { id: "default", name: "Default" },
      { id: "dialog", name: "Dialog", description: "Show the dialog." }
    ]
  };
  const controller = await createController(screen);
  const placement = screen.materials[0];
  const layer = screen.layers[0];

  assert.equal(controller.isInstanceVisible(placement, "dialog", screen), false);
  assert.equal(controller.isLayerVisible(layer, "dialog", screen), false);

  controller.setInstanceVisible({ data: screen }, placement, true, "dialog");
  controller.setLayerVisible({ data: screen }, layer, true, "dialog");
  assert.equal(controller.isInstanceVisible(placement, "dialog", screen), true);
  assert.equal(controller.isLayerVisible(layer, "dialog", screen), true);

  controller.setInstanceVisible({ data: screen }, placement, false, "dialog");
  controller.setLayerVisible({ data: screen }, layer, false, "dialog");
  assert.equal(screen["preview-states"][1].placements, undefined);
  assert.equal(screen["preview-states"][1].layers, undefined);
});

/** Checks that the editor exposes the expected entries and override values. */
test("lists individual placement, attribute, and layer state overrides", async () => {
  const screen = {
    layers: [{ id: "overlay", name: "Overlay" }],
    materials: [
      {
        id: "notice",
        attributes: { tone: "neutral", label: "Hello" },
        position: { x: 10, y: 20 },
        visibility: { dialog: false }
      },
      { id: "legacy", visibility: { dialog: true } }
    ],
    "preview-states": [
      { id: "default", name: "Default" },
      {
        id: "dialog",
        name: "Dialog",
        description: "Show the dialog.",
        placements: {
          notice: {
            visible: true,
            position: { x: 30, y: 40 },
            attributes: { tone: "danger", label: null }
          }
        },
        layers: { overlay: { visible: false } }
      }
    ]
  };
  const controller = await createController(screen);

  assert.deepEqual(
    controller.listStateOverrides(screen, "dialog").map((override) => [
      override.key,
      override.kind,
      override.property,
      override.attributeName,
      override.value,
      override.legacy
    ]),
    [
      ["placement:notice:visible", "placement", "visible", undefined, true, undefined],
      ["placement:notice:position", "placement", "position", undefined, { x: 30, y: 40 }, undefined],
      ["placement:notice:attributes:tone", "placement", "attributes", "tone", "danger", undefined],
      ["placement:notice:attributes:label", "placement", "attributes", "label", null, undefined],
      ["placement:legacy:visible", "placement", "visible", undefined, true, true],
      ["layer:overlay:visible", "layer", "visible", undefined, false, undefined]
    ]
  );
});

/** Resetting one property preserves sibling changes and removes state containers left empty. */
test("resetting a selected state override removes only that change and prunes empty entries", async () => {
  const screen = {
    layers: [{ id: "overlay", name: "Overlay" }],
    materials: [
      { id: "notice", attributes: { tone: "neutral" } },
      { id: "legacy", visibility: { dialog: false } }
    ],
    "preview-states": [
      { id: "default", name: "Default" },
      {
        id: "dialog",
        name: "Dialog",
        description: "Show the dialog.",
        placements: {
          notice: { visible: false, attributes: { tone: "danger" } }
        },
        layers: { overlay: { visible: false } }
      }
    ]
  };
  const controller = await createController(screen);
  const record = { data: screen };
  const overrides = controller.listStateOverrides(screen, "dialog");

  /** Returns the matching state override from the list. */
  const findOverride = (key) => overrides.find((override) => override.key === key);

  controller.resetStateOverride(record, "dialog", findOverride("placement:notice:attributes:tone"));
  assert.deepEqual(screen["preview-states"][1].placements.notice, { visible: false });

  controller.resetStateOverride(record, "dialog", findOverride("placement:notice:visible"));
  assert.equal(screen["preview-states"][1].placements, undefined);

  controller.resetStateOverride(record, "dialog", findOverride("layer:overlay:visible"));
  assert.equal(screen["preview-states"][1].layers, undefined);

  controller.resetStateOverride(record, "dialog", findOverride("placement:legacy:visible"));
  assert.equal(screen.materials[1].visibility, undefined);
});
