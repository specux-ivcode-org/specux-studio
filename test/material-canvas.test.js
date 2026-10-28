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
  rotate.listeners.get("pointerdown")(createPointerEvent({
    clientX: 75,
    clientY: 60,
    target: rotate
  }));
  frame.listeners.get("pointermove")(createPointerEvent({
    clientX: 75,
    clientY: 110,
    target: frame
  }));
  frame.listeners.get("pointerup")(createPointerEvent({
    clientX: 75,
    clientY: 110,
    target: frame
  }));
  assert.equal(instance.rotation, 90);
  assert.equal(frame.style.transform, "rotate(90deg)");
  assert.equal(calls.edited, 2);

  const transform = {
    position: { x: 10, y: 20 },
    size: { width: 100, height: 60 },
    rotation: 90
  };
  const gesture = {
    direction: "e",
    startPosition: { x: 10, y: 20 },
    startSize: { width: 100, height: 60 },
    startRotation: 90
  };
  const { MaterialCanvas } = await import("../frontend/browser/MaterialCanvas.mjs");
  new MaterialCanvas({ state: {}, services: {} }).resizeTransform(transform, gesture, 0, 10);
  assert.deepEqual(transform.size, { width: 110, height: 60 });
  assert.deepEqual(transform.position, { x: 10, y: 20 });
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

test("adds Label instances from one reusable template with independent variables and transforms", async () => {
  const { ScreenMaterialController } = await import("../frontend/browser/ScreenMaterialController.mjs");
  const screen = { id: "home", file: "screens/home/screen.yml", data: { materials: [] } };
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
    rotation: 0
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
      rotation: 0
    },
    {
      id: "notice-2",
      src: "materials/notice.stml",
      attributes: { text: "Notice" },
      position: { x: 90, y: 120 },
      size: { width: 240, height: 56 },
      rotation: 0
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
