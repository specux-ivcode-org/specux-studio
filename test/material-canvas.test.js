const assert = require("node:assert/strict");
const test = require("node:test");

function createElement(tagName) {
  const listeners = new Map();
  const attributes = new Map();
  const children = [];
  return {
    tagName,
    children,
    dataset: {},
    style: {},
    className: "",
    classList: {
      toggle() {},
      add() {}
    },
    listeners,
    attributes,
    offsetWidth: 0,
    offsetHeight: 0,
    append(child) {
      children.push(child);
      child.parentElement = this;
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    toggleAttribute() {},
    setPointerCapture(pointerId) {
      this.capturedPointer = pointerId;
    },
    hasPointerCapture(pointerId) {
      return this.capturedPointer === pointerId;
    },
    releasePointerCapture() {
      this.capturedPointer = null;
    },
    querySelectorAll(selector) {
      if (selector === ".material-resize-control") {
        return children.filter((child) => child.className === "material-control material-resize-control");
      }
      return [];
    },
    querySelector(selector) {
      if (selector === ".material-rotate-control") {
        return children.find((child) => child.className === "material-control material-rotate-control");
      }
      return null;
    },
    getBoundingClientRect() {
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      const width = Number.parseFloat(this.style.width) || this.offsetWidth;
      const height = Number.parseFloat(this.style.height) || this.offsetHeight;
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
  };
}

function createPointerEvent({ pointerId = 1, clientX, clientY, target, path } = {}) {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
    target,
    preventDefault() {},
    stopPropagation() {},
    composedPath() { return path || [target]; }
  };
}

async function createHarness() {
  const content = createElement("div");
  content.offsetWidth = 1000;
  content.offsetHeight = 800;
  content.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 });
  const host = createElement("div");
  host.offsetWidth = 100;
  host.offsetHeight = 60;
  const instance = {
    id: "card",
    type: "text",
    content: "Text",
    position: { x: 10, y: 20 },
    size: { width: 100, height: 60 },
    rotation: 0
  };
  const calls = { edited: 0, selected: 0, inspector: 0 };
  const { MaterialCanvas } = await import("../frontend/browser/MaterialCanvas.mjs");
  const canvas = new MaterialCanvas({
    state: { isRenderOnly: false },
    services: {
      document: { createElement },
      markEdited() { calls.edited += 1; },
      renderInspector() { calls.inspector += 1; },
      selectInstance() { calls.selected += 1; }
    }
  });
  const screen = { file: "screens/home/screen.yml" };
  const frame = canvas.createFrame(host, instance, 0, content, screen);
  return { canvas, content, frame, host, instance, calls, screen };
}

test("moves a selected material in canvas coordinates and persists its position", async () => {
  const { frame, host, instance, calls } = await createHarness();
  host.listeners.get("pointerdown")(createPointerEvent({
    clientX: 100,
    clientY: 100,
    target: host
  }));
  frame.listeners.get("pointermove")(createPointerEvent({
    clientX: 140,
    clientY: 125,
    target: frame
  }));
  frame.listeners.get("pointerup")(createPointerEvent({
    clientX: 140,
    clientY: 125,
    target: frame
  }));

  assert.deepEqual(instance.position, { x: 50, y: 45 });
  assert.equal(frame.style.left, "50px");
  assert.equal(frame.style.top, "45px");
  assert.equal(calls.selected, 1);
  assert.equal(calls.edited, 1);
  assert.equal(calls.inspector, 1);
});

test("resizes and rotates materials with pointer handles", async () => {
  const { frame, instance, calls } = await createHarness();
  const southeast = frame.querySelectorAll(".material-resize-control")
    .find((handle) => handle.dataset.resizeDirection === "se");
  southeast.listeners.get("pointerdown")(createPointerEvent({
    clientX: 110,
    clientY: 80,
    target: southeast
  }));
  frame.listeners.get("pointermove")(createPointerEvent({
    clientX: 140,
    clientY: 100,
    target: frame
  }));
  frame.listeners.get("pointerup")(createPointerEvent({
    clientX: 140,
    clientY: 100,
    target: frame
  }));
  assert.deepEqual(instance.size, { width: 130, height: 80 });

  const rotate = frame.querySelector(".material-rotate-control");
  const bounds = frame.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  rotate.listeners.get("pointerdown")(createPointerEvent({
    clientX: centerX + 15,
    clientY: centerY,
    target: rotate
  }));
  frame.listeners.get("pointermove")(createPointerEvent({
    clientX: centerX,
    clientY: centerY + 15,
    target: frame
  }));
  frame.listeners.get("pointerup")(createPointerEvent({
    clientX: centerX,
    clientY: centerY + 15,
    target: frame
  }));
  assert.equal(instance.rotation, 90);
  assert.equal(frame.style.transform, "rotate(90deg)");
  assert.equal(calls.edited, 2);

  const transform = {
    position: { x: 10, y: 20 },
    size: { width: 100, height: 60 },
    rotation: 90,
    isGroup: false
  };
  const gesture = {
    direction: "e",
    startPosition: { x: 10, y: 20 },
    startSize: { width: 100, height: 60 },
    startRotation: 90,
    isGroup: false
  };
  const { MaterialCanvas } = await import("../frontend/browser/MaterialCanvas.mjs");
  new MaterialCanvas({ state: {}, services: {} }).resizeTransform(transform, gesture, 0, 10);
  assert.deepEqual(transform.size, { width: 110, height: 60 });
  assert.deepEqual(transform.position, { x: 10, y: 20 });
});

test("keeps grouped Material placements from being transformed independently", async () => {
  const { MaterialCanvas } = await import("../frontend/browser/MaterialCanvas.mjs");
  const canvas = new MaterialCanvas({
    state: { isRenderOnly: false },
    services: {
      document: { createElement },
      markEdited() {},
      renderInspector() {},
      selectInstance() {}
    }
  });
  const content = createElement("div");
  content.offsetWidth = 1000;
  content.offsetHeight = 800;
  content.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 });
  const group = {
    id: "group",
    type: "group",
    position: { x: 10, y: 20 },
    size: { width: 200, height: 120 },
    children: []
  };
  const child = {
    id: "child",
    src: "materials/card.stml",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 60 },
    rotation: 0
  };
  const nestedGroup = {
    id: "nested-group",
    type: "group",
    position: { x: 10, y: 10 },
    size: { width: 80, height: 40 },
    children: []
  };
  group.children.push(child);
  group.children.push(nestedGroup);
  const screen = { file: "screens/home/screen.yml", data: { materials: [group] } };
  const groupFrame = canvas.createFrame(
    createElement("div"),
    group,
    0,
    content,
    screen,
    [0]
  );
  const childHost = createElement("div");
  const childFrame = canvas.createFrame(
    childHost,
    child,
    0,
    content,
    screen,
    [0, 0],
    { scale: 1, rotation: 0 }
  );
  const nestedGroupFrame = canvas.createFrame(
    createElement("div"),
    nestedGroup,
    1,
    content,
    screen,
    [0, 1],
    { scale: 1, rotation: 0 }
  );

  assert.equal(groupFrame.querySelectorAll(".material-resize-control").length, 8);
  assert.equal(groupFrame.querySelector(".material-rotate-control") !== null, true);
  assert.equal(childFrame.querySelectorAll(".material-resize-control").length, 0);
  assert.equal(Boolean(childFrame.querySelector(".material-rotate-control")), false);
  assert.equal(childHost.listeners.has("pointerdown"), false);
  assert.equal(nestedGroupFrame.querySelectorAll(".material-resize-control").length, 0);
  assert.equal(Boolean(nestedGroupFrame.querySelector(".material-rotate-control")), false);
});

test("keeps legacy slot compositions full-width on the canvas", async () => {
  const { MaterialCanvas } = await import("../frontend/browser/MaterialCanvas.mjs");
  const host = createElement("div");
  const instance = {
    id: "layout",
    slots: { content: [{ id: "child" }] }
  };
  const content = createElement("div");
  content.offsetWidth = 1000;
  content.offsetHeight = 800;
  content.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 });
  const canvas = new MaterialCanvas({
    state: { isRenderOnly: true },
    services: { document: { createElement } }
  });

  const frame = canvas.createFrame(host, instance, 0, content, { file: "screen.yml" });

  assert.equal(frame.style.left, "0px");
  assert.equal(frame.style.top, "0px");
  assert.equal(frame.style.width, "100%");
  assert.equal(host.style.width, "100%");
});

test("stacks placements by layer order while preserving material order within each layer", async () => {
  const { MaterialCanvas } = await import("../frontend/browser/MaterialCanvas.mjs");
  const canvas = new MaterialCanvas({
    state: { isRenderOnly: true },
    services: { document: { createElement } }
  });
  const content = createElement("div");
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [
        { id: "front", name: "Front" },
        { id: "back", name: "Back" },
        { id: "base", name: "Base" }
      ],
      materials: [{ layer: "front" }, { layer: "back" }, { layer: "base" }]
    }
  };
  const frontFrame = canvas.createFrame(
    createElement("div"),
    { id: "front-item", layer: "front", position: { x: 0, y: 0 } },
    0,
    content,
    screen
  );
  const backFrame = canvas.createFrame(
    createElement("div"),
    { id: "back-item", layer: "back", position: { x: 0, y: 0 } },
    1,
    content,
    screen
  );
  const baseFrame = canvas.createFrame(
    createElement("div"),
    { id: "base-item", layer: "base", position: { x: 0, y: 0 } },
    2,
    content,
    screen
  );

  assert.ok(Number(frontFrame.style.zIndex) > Number(backFrame.style.zIndex));
  assert.ok(Number(backFrame.style.zIndex) > Number(baseFrame.style.zIndex));
});

test("normalizes legacy layer lists without inventing placement assignments", async () => {
  const { BASE_LAYER_ID, normalizeScreenLayers } =
    await import("../shared/ScreenLayers.mjs");
  const legacyScreen = { materials: [{ id: "background" }] };
  assert.equal(normalizeScreenLayers(legacyScreen), true);
  assert.deepEqual(legacyScreen.layers, [
    { id: BASE_LAYER_ID, name: "Base" }
  ]);
  assert.equal(legacyScreen.materials[0].layer, undefined);

  const screen = {
    layers: [{ id: "foreground", name: "Foreground" }],
    materials: [{ id: "title" }]
  };
  assert.equal(normalizeScreenLayers(screen), false);
  assert.deepEqual(screen.layers, [{ id: "foreground", name: "Foreground" }]);
  assert.equal(screen.materials[0].layer, undefined);

  const emptyScreen = { layers: [], materials: [] };
  assert.equal(normalizeScreenLayers(emptyScreen), true);
  assert.deepEqual(emptyScreen.layers, [{ id: BASE_LAYER_ID, name: "Base" }]);
  assert.equal(normalizeScreenLayers(screen), false);
});

test("adds Label instances from one reusable template with independent variables and transforms", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = {
    id: "home",
    file: "screens/home/screen.yml",
    data: {
      layers: [{ id: "foreground", name: "Foreground" }],
      materials: []
    }
  };
  const calls = { edited: [], renders: 0, selected: [] };
  const materialFiles = new Map();
  const createdMaterialFiles = new Set();
  const projectFilePaths = [];
  const controller = new ScreenMaterialController({
    state: {
      screens: [screen],
      activeScreenIndex: 0,
      materialFiles,
      createdMaterialFiles,
      projectFilePaths,
      appRoot: new URL("http://localhost/specux/")
    },
    services: {
      markEdited(filePath) { calls.edited.push(filePath); },
      renderNavigation() {},
      async renderScreen() { calls.renders += 1; },
      selectInstance(path) { calls.selected.push(path); }
    }
  });

  await controller.add("label", { x: 152, y: 87 });
  await controller.add("label");

  assert.equal(screen.data.materials[0].id, "label");
  assert.equal(screen.data.materials[0].src, "materials/label.stml");
  assert.deepEqual(screen.data.materials[0].attributes, { text: "Label" });
  assert.deepEqual(screen.data.materials[0].position, { x: 152, y: 87 });
  assert.deepEqual(screen.data.materials[0].size, { width: 240, height: 56 });
  assert.equal(screen.data.materials[0].rotation, 0);
  assert.equal(screen.data.materials[1].id, "label-2");
  assert.equal(screen.data.materials[1].src, "materials/label.stml");
  assert.deepEqual(screen.data.materials[1].attributes, { text: "Label" });
  assert.deepEqual(screen.data.materials[1].position, { x: 36, y: 167 });
  assert.equal(materialFiles.get("materials/label.stml").data.type, "label");
  assert.match(materialFiles.get("materials/label.stml").documentSource, /\$\{attributes\.text\}/);
  assert.deepEqual([...createdMaterialFiles], ["materials/label.stml"]);
  screen.data.materials[0].attributes.text = "Greeting";
  screen.data.materials[1].attributes.text = "Different label";
  assert.equal(screen.data.materials[0].attributes.text, "Greeting");
  assert.equal(screen.data.materials[1].attributes.text, "Different label");
  assert.deepEqual(screen.data.materials[0], {
    id: "label",
    src: "materials/label.stml",
    attributes: { text: "Greeting" },
    position: { x: 152, y: 87 },
    size: { width: 240, height: 56 },
    rotation: 0,
    layer: "foreground"
  });
  assert.deepEqual(calls.edited, [
    "materials/label.stml",
    screen.file,
    screen.file
  ]);
  assert.equal(calls.renders, 2);
  assert.deepEqual(calls.selected, [[0], [1]]);
  const { ProjectPersistence } = await import("../frontend/browser/ProjectPersistence.mjs");
  const persistence = new ProjectPersistence({
    state: {
      assets: new Map(),
      materialFiles,
      createdMaterialFiles
    },
    services: {}
  });
  assert.deepEqual(
    persistence.getProjectFileSaveEntry("materials/label.stml"),
    {
      path: "materials/label.stml",
      create: true,
      content: materialFiles.get("materials/label.stml").documentSource
    }
  );
});

test("treats Base as an ordinary layer and deletes layers with placements", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [{ id: "base", name: "Base" }],
      materials: [
        { id: "welcome", layer: "base" },
        { id: "background", layer: "base" }
      ]
    }
  };
  const calls = { edited: 0, rendered: 0 };
  const controller = new ScreenMaterialController({
    state: { screens: [screen], activeScreenIndex: 0 },
    services: {
      markEdited() { calls.edited += 1; },
      async renderScreen() { calls.rendered += 1; }
    }
  });

  await controller.createLayer();
  await controller.createLayer();
  assert.deepEqual(screen.data.layers, [
    { id: "layer-2", name: "Layer 2" },
    { id: "layer-1", name: "Layer 1" },
    { id: "base", name: "Base" }
  ]);
  assert.equal(screen.data.materials[0].layer, "base");
  await controller.moveLayer("layer-1", -1);
  await controller.renameLayer("layer-1", "Foreground");
  await controller.setLayerVisibility("layer-1", false);
  await controller.assignMaterialLayer(0, "layer-1");

  assert.equal(screen.data.layers[0].name, "Foreground");
  assert.equal(screen.data.layers[0].visible, false);
  assert.equal(screen.data.materials[0].layer, "layer-1");

  await controller.deleteLayer("layer-1");
  assert.deepEqual(screen.data.materials.map(({ id }) => id), ["background"]);
  assert.deepEqual(screen.data.layers, [
    { id: "layer-2", name: "Layer 2" },
    { id: "base", name: "Base" }
  ]);
  await controller.moveLayer("layer-2", 1);
  await controller.renameLayer("base", "Foundation");
  assert.deepEqual(screen.data.layers, [
    { id: "base", name: "Foundation" },
    { id: "layer-2", name: "Layer 2" }
  ]);
  await controller.assignMaterialLayer(0, "base");
  await controller.deleteLayer("base");
  assert.deepEqual(screen.data.materials, []);
  assert.deepEqual(screen.data.layers, [{ id: "layer-2", name: "Layer 2" }]);

  await assert.rejects(
    controller.deleteLayer("layer-2"),
    /At least one layer must remain/
  );
  assert.deepEqual(screen.data.layers, [{ id: "layer-2", name: "Layer 2" }]);
  assert.equal(calls.edited, 11);
  assert.equal(calls.rendered, 11);
});

test("deleting a layer removes its placements and keeps surviving selection valid", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [
        { id: "base", name: "Base" },
        { id: "overlay", name: "Overlay" },
        { id: "backup", name: "Backup" }
      ],
      materials: [
        { id: "removed", layer: "base" },
        { id: "overlay-item", layer: "overlay" },
        { id: "selected", layer: "base" },
        { id: "backup-item", layer: "backup" }
      ]
    }
  };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [1]
  };
  const selections = [];
  const controller = new ScreenMaterialController({
    state,
    services: {
      markEdited() {},
      selectInstance(path, src) {
        state.activeInstancePath = path;
        selections.push([path, src]);
      },
      async renderScreen() {}
    }
  });

  await controller.deleteLayer("base");

  assert.deepEqual(screen.data.materials.map(({ id }) => id), [
    "overlay-item", "backup-item"
  ]);
  assert.deepEqual(screen.data.layers.map(({ id }) => id), ["overlay", "backup"]);
  assert.deepEqual(state.activeInstancePath, [0]);
  assert.deepEqual(selections, [[[0], null]]);

  state.activeInstancePath = [0];
  await controller.deleteLayer("overlay");
  assert.deepEqual(screen.data.materials.map(({ id }) => id), ["backup-item"]);
  assert.deepEqual(screen.data.layers.map(({ id }) => id), ["backup"]);
  assert.deepEqual(state.activeInstancePath, []);
  assert.deepEqual(selections, [[[0], null], [[], null]]);

  await assert.rejects(
    controller.deleteLayer("backup"),
    /At least one layer must remain/
  );
  assert.deepEqual(screen.data.layers.map(({ id }) => id), ["backup"]);
  assert.deepEqual(screen.data.materials.map(({ id }) => id), ["backup-item"]);
});

test("reorders placements within their layer without changing other layers", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [{ id: "base", name: "Base" }, { id: "overlay", name: "Overlay" }],
      materials: [
        { id: "first", layer: "base" },
        { id: "other-layer", layer: "overlay" },
        { id: "second", layer: "base" },
        { id: "third", layer: "base" }
      ]
    }
  };
  const state = { screens: [screen], activeScreenIndex: 0, activeInstancePath: [0] };
  let renders = 0;
  const selections = [];
  const controller = new ScreenMaterialController({
    state,
    services: {
      markEdited() {},
      selectInstance(path) {
        state.activeInstancePath = path;
        selections.push(path);
      },
      async renderScreen() { renders += 1; }
    }
  });

  await controller.moveMaterial(0, 1);
  assert.deepEqual(screen.data.materials.map(({ id }) => id), [
    "second", "other-layer", "first", "third"
  ]);
  await controller.moveMaterial(3, -1);
  assert.deepEqual(screen.data.materials.map(({ id }) => id), [
    "second", "other-layer", "third", "first"
  ]);
  assert.equal(renders, 2);
  assert.deepEqual(selections, [[2], [3]]);
});

test("reorders layers and placements by drop position while preserving placement selection", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [
        { id: "top", name: "Top" },
        { id: "middle", name: "Middle" },
        { id: "base", name: "Base" }
      ],
      materials: [
        { id: "moving", layer: "base" },
        { id: "base-target", layer: "base" },
        { id: "top-target", layer: "top" }
      ]
    }
  };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [0]
  };
  const selections = [];
  let renders = 0;
  const controller = new ScreenMaterialController({
    state,
    services: {
      markEdited() {},
      selectInstance(path) {
        state.activeInstancePath = path;
        selections.push(path);
      },
      async renderScreen() { renders += 1; }
    }
  });

  await controller.reorderLayer("base", "top", false);
  assert.deepEqual(screen.data.layers.map(({ id }) => id), ["base", "top", "middle"]);
  await controller.reorderLayer("base", "middle", true);
  assert.deepEqual(screen.data.layers.map(({ id }) => id), ["top", "middle", "base"]);

  await controller.reorderMaterial(0, "base-target", true);
  assert.deepEqual(screen.data.materials.map(({ id }) => id), [
    "base-target", "moving", "top-target"
  ]);
  assert.equal(screen.data.materials[1].layer, "base");
  assert.deepEqual(state.activeInstancePath, [1]);

  await controller.reorderMaterial(1, "top-target", true);
  assert.deepEqual(screen.data.materials.map(({ id }) => id), [
    "base-target", "top-target", "moving"
  ]);
  assert.equal(screen.data.materials[2].layer, "top");
  assert.deepEqual(state.activeInstancePath, [2]);
  assert.deepEqual(selections, [[1], [2]]);
  assert.equal(renders, 4);
});

test("shows one-line layers above placements for the selected layer", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  function element(tagName, className = "", textContent = "") {
    const listeners = new Map();
    const attributes = new Map();
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    const children = [];
    return {
      tagName,
      className,
      textContent,
      children,
      dataset: {},
      listeners,
      attributes,
      classList: {
        add(name) { classes.add(name); },
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        }
      },
      append(...nodes) { children.push(...nodes); },
      replaceChildren(...nodes) {
        children.splice(0, children.length, ...nodes);
      },
      addEventListener(type, callback) { listeners.set(type, callback); },
      setAttribute(name, value) { attributes.set(name, value); },
      getBoundingClientRect() { return { top: 0, height: 20 }; },
      closest() { return null; }
    };
  }
  const dragCalls = [];
  const deletionMessages = [];
  const screen = {
    layers: [{ id: "overlay", name: "Overlay" }, { id: "base", name: "Base" }],
    materials: [
      { id: "title", layer: "overlay" },
      { id: "background", layer: "base" },
      { id: "footer", layer: "base" }
    ]
  };
  const renderer = new InspectorRenderer({
    state: {
      screens: [{ file: "screens/home/screen.yml", data: screen }],
      activeScreenIndex: 0,
      activeInstancePath: []
    },
    services: {
      element,
      createLayer: async () => {},
      setLayerVisibility: async () => {},
      renameLayer: async () => {},
      moveLayer: async () => {},
      reorderLayer: (...args) => { dragCalls.push(["layer", ...args]); },
      deleteLayer: async (layerId) => { dragCalls.push(["delete", layerId]); },
      assignMaterialLayer: (...args) => { dragCalls.push(["assign", ...args]); },
      moveMaterial: async () => {},
      reorderMaterial: (...args) => { dragCalls.push(["material", ...args]); },
      selectInstance() {},
      confirm(message) {
        deletionMessages.push(message);
        return true;
      },
      showFatalError() {}
    }
  });
  const panel = element("div");
  renderer.renderLayersDetails(panel, screen);

  const [layerBox, placementBox] = panel.children;
  const layerList = layerBox.children[1];
  const placementList = placementBox.children[2];
  assert.equal(layerList.children.length, 2);
  assert.equal(layerList.children[1].attributes.get("aria-current"), "true");
  assert.ok(layerList.children[1].children.some((child) =>
    child.className === "layer-delete-button"
  ));
  assert.equal(placementList.children[0].dataset.materialIndex, "1");
  assert.equal(placementList.children[0].children.length, 4);
  assert.ok(placementList.children[0].children.every((child) =>
    child.className !== "layer-placement-assignment"
  ));

  const layerTransfer = {
    types: ["application/x-specux-layer"],
    setData(type, value) { this[type] = value; },
    getData(type) { return this[type]; }
  };
  const layerHandle = layerList.children[1].children[0];
  layerHandle.listeners.get("dragstart")({ dataTransfer: layerTransfer });
  layerList.children[0].listeners.get("dragover")({
    dataTransfer: layerTransfer,
    clientY: 19,
    preventDefault() {}
  });
  layerList.children[0].listeners.get("drop")({
    dataTransfer: layerTransfer,
    preventDefault() {}
  });
  assert.deepEqual(dragCalls[0], ["layer", "base", "overlay", true]);

  const materialTransfer = {
    types: ["application/x-specux-material"],
    setData(type, value) { this[type] = value; },
    getData(type) { return this[type]; }
  };
  placementList.children[0].children[0].listeners.get("dragstart")({
    dataTransfer: materialTransfer
  });
  layerList.children[0].listeners.get("drop")({
    dataTransfer: materialTransfer,
    preventDefault() {}
  });
  assert.deepEqual(dragCalls[1], ["assign", 1, "overlay"]);

  placementList.children[0].children[0].listeners.get("dragstart")({
    dataTransfer: materialTransfer
  });
  placementList.children[1].listeners.get("dragover")({
    dataTransfer: materialTransfer,
    clientY: 19,
    preventDefault() {}
  });
  placementList.children[1].listeners.get("drop")({
    dataTransfer: materialTransfer,
    preventDefault() {}
  });
  assert.deepEqual(dragCalls[2], ["material", 1, "footer", true]);

  layerList.children[1].children
    .find((child) => child.className === "layer-delete-button")
    .listeners.get("click")();
  assert.deepEqual(deletionMessages, ['Delete "Base" and its 2 placements?']);
  assert.deepEqual(dragCalls[3], ["delete", "base"]);

  layerList.children[0].listeners.get("click")({ target: layerList.children[0] });
  assert.equal(layerList.children[0].attributes.get("aria-current"), "true");
  assert.equal(placementList.children[0].dataset.materialIndex, "0");

  screen.layers = [{ id: "base", name: "Base" }];
  const singleLayerPanel = element("div");
  renderer.renderLayersDetails(singleLayerPanel, screen);
  const singleLayerRow = singleLayerPanel.children[0].children[1].children[0];
  const singleLayerDelete = singleLayerRow.children
    .find((child) => child.className === "layer-delete-button");
  assert.equal(singleLayerDelete.disabled, true);
  assert.equal(singleLayerDelete.title, "At least one layer must remain");
});

test("reuses one Material file with independent placement transforms", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = { id: "home", file: "screens/home/screen.yml", data: { materials: [] } };
  const definition = {
    id: "notice",
    file: "materials/notice.stml",
    data: {
      id: "notice",
      name: "Label",
      type: "label",
      attributes: { text: { type: "string", default: "Notice", overridable: true } }
    },
    html: '<div>${attributes.text}</div>'
  };
  const calls = { renders: 0 };
  const controller = new ScreenMaterialController({
    state: {
      screens: [screen],
      activeScreenIndex: 0,
      materialFiles: new Map([[definition.file, definition]])
    },
    services: {
      markEdited() {},
      renderNavigation() {},
      async renderScreen() { calls.renders += 1; },
      selectInstance() {}
    }
  });

  await controller.addFromFile(definition.file, { x: 30, y: 40 });
  await controller.addFromFile(definition.file, { x: 90, y: 120 });

  assert.deepEqual(screen.data.materials, [
    {
      id: "notice",
      src: "materials/notice.stml",
      attributes: { text: "Notice" },
      position: { x: 30, y: 40 },
      size: { width: 240, height: 56 },
      rotation: 0,
      layer: "base"
    },
    {
      id: "notice-2",
      src: "materials/notice.stml",
      attributes: { text: "Notice" },
      position: { x: 90, y: 120 },
      size: { width: 240, height: 56 },
      rotation: 0,
      layer: "base"
    }
  ]);
  assert.equal(calls.renders, 2);
});

test("places each supported Material kind with its own default dimensions", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const expectedSizes = {
    label: { width: 240, height: 56 },
    button: { width: 160, height: 48 },
    surface: { width: 240, height: 120 },
    avatar: { width: 48, height: 48 },
    "navigation-item": { width: 160, height: 40 },
    "text-field": { width: 280, height: 48 },
    progress: { width: 240, height: 24 },
    divider: { width: 120, height: 24 },
    checkbox: { width: 24, height: 24 }
  };

  for (const [type, size] of Object.entries(expectedSizes)) {
    const screen = { id: "home", file: "screens/home/screen.yml", data: { materials: [] } };
    const definition = {
      id: type,
      file: `materials/${type}.stml`,
      data: { id: type, name: type, type },
      html: "<div></div>"
    };
    const controller = new ScreenMaterialController({
      state: {
        screens: [screen],
        activeScreenIndex: 0,
        materialFiles: new Map([[definition.file, definition]])
      },
      services: {
        markEdited() {},
        async renderScreen() {},
        selectInstance() {}
      }
    });

    await controller.addFromFile(definition.file, { x: 10, y: 20 });
    assert.deepEqual(screen.data.materials[0].size, size, type);
  }
});

test("renders Label and Button instances with their placement-specific text", async () => {
  const { ScreenMaterialRenderer } = await import("../frontend/browser/ScreenMaterialRenderer.mjs");
  const calls = [];
  const materialFiles = new Map([
    ["materials/title.stml", {
      id: "title",
      data: {
        id: "label",
        name: "Label",
        type: "label",
        attributes: { text: { type: "string", overridable: true } }
      },
      base: new URL("http://localhost/specux/materials/"),
      html: '<div class="material-visual material-visual-label">${attributes.text}</div>'
    }],
    ["materials/continue.stml", {
      id: "continue",
      data: {
        id: "continue",
        name: "Button",
        type: "button",
        attributes: { text: { type: "string", overridable: true } }
      },
      base: new URL("http://localhost/specux/materials/"),
      html: '<div class="material-visual material-visual-button">${attributes.text}</div>'
    }]
  ]);
  const renderer = new ScreenMaterialRenderer({
    state: { activeInstancePath: [], materialFiles },
    services: {
      document: { createElement },
      sameInstancePath: () => false,
      selectInstance(path) { calls.push(path); },
      templateMarkupRenderer: {
        mount(host, html, base, instance) {
          const visual = createElement("div");
          visual.className = html.includes("button") ?
            "material-visual material-visual-button" : "material-visual material-visual-label";
          visual.textContent = instance.attributes.text;
          host.append(visual);
        }
      }
    }
  });

  const text = renderer.render(
    { id: "title", src: "materials/title.stml", attributes: { text: "Hello" } },
    0
  );
  const button = renderer.render(
    { id: "continue", src: "materials/continue.stml", attributes: { text: "Continue" } },
    1
  );

  assert.equal(text.className, "material-instance");
  assert.equal(text.children[0].className, "material-visual material-visual-label");
  assert.equal(text.children[0].textContent, "Hello");
  assert.equal(button.children[0].className, "material-visual material-visual-button");
  assert.equal(button.children[0].textContent, "Continue");
  assert.equal(button.children[0].tagName, "div");
  text.listeners.get("click")();
  button.listeners.get("click")();
  assert.deepEqual(calls, [[0], [1]]);
});
