const assert = require("node:assert/strict");
const test = require("node:test");

/** Creates the DOM-like elements used by the Material selector test. */
function createElement(tag, className = "", textContent = "") {
  const listeners = new Map();
  return {
    tag,
    className,
    textContent,
    children: [],
    attributes: new Map(),
    style: {},
    hidden: true,
    offsetWidth: 190,
    offsetHeight: 42,
    classList: { add() {} },
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    replaceChildren(...children) { this.children = children; },
    click(name = "click", event = {}) { return listeners.get(name)?.(event); },
    focus() { this.focused = true; },
    contains(target) { return target === this || this.children.includes(target); }
  };
}

/** Creates document-level pointer listeners for a selector drag test. */
function createDocument() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatch(name, event) { return listeners.get(name)?.(event); }
  };
}

test("Material selector tiles preview and add on click, and edit from the context menu", async () => {
  const { ProjectFileNavigator } = await import("../frontend/browser/ProjectFileNavigator.mjs");
  const list = createElement("div");
  const menu = createElement("div");
  const editMenuItem = createElement("button");
  menu.append(editMenuItem);
  const elements = {
    "material-selector-list": list,
    "material-selector-context-menu": menu,
    "material-selector-context-edit": editMenuItem
  };
  const document = createDocument();
  const mounted = [];
  const added = [];
  const opened = [];
  let resizePreviews;
  class ResizeObserverMock {
    constructor(callback) {
      resizePreviews = callback;
    }
    observe() {}
    disconnect() {}
  }
  const material = {
    id: "action",
    file: "materials/action.stml",
    base: new URL("https://example.test/materials/"),
    data: {
      id: "action",
      name: "Action",
      type: "button",
      "preview-size": { width: 300, height: 100 },
      attributes: { label: { type: "string", default: "Continue", overridable: true } }
    },
    html: "<button>${attributes.label}</button>"
  };
  const navigator = new ProjectFileNavigator({
    state: {
      materialFiles: new Map([[material.file, material]]),
      activeProjectFilePath: null,
      viewingSpec: false,
      viewingTheme: false,
      viewingProject: false,
      viewingMaterialFile: false,
      viewingWorkflow: false,
      screens: []
    },
    services: {
      document,
      window: {
        innerWidth: 500,
        innerHeight: 500,
        ResizeObserver: ResizeObserverMock,
        setTimeout() {}
      },
      byId: (id) => elements[id],
      element: createElement,
      getMaterialDropGeometry: () => ({ inside: false }),
      templateMarkupRenderer: {
        mount: (...args) => mounted.push(args)
      },
      placeMaterialFile: async (filePath) => added.push(filePath),
      renderMaterialFile: async (filePath) => opened.push(filePath),
      showEditorMessage() {},
      updateNavigationSelection() {}
    },
    projectFileTree: { expandPath() {}, render() {} }
  });

  navigator.bindMaterialContextMenu();
  navigator.renderMaterialSelector();

  const item = list.children[0];
  const addButton = item.children[0];
  const preview = addButton.children[0];
  const heading = addButton.children[1];
  const viewport = preview.children[0];
  assert.equal(heading.className, "material-selector-item-heading");
  assert.equal(heading.children[0].textContent, "Action");
  assert.equal(heading.children[1].textContent, "300 x 100");
  const previewCanvas = viewport.children[0];
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0][3].size.width, 300);
  assert.equal(mounted[0][3].attributes.label, "Continue");
  assert.equal(previewCanvas.style.width, "300px");
  assert.equal(previewCanvas.style.height, "100px");
  assert.equal(viewport.style.width, "160px");
  assert.equal(viewport.style.height, "53.333333333333336px");
  assert.equal(previewCanvas.style.transform, "scale(0.5333333333333333)");

  preview.clientWidth = 100;
  resizePreviews([{ target: preview }]);
  assert.equal(viewport.style.width, "100px");
  assert.equal(viewport.style.height, "33.33333333333333px");
  assert.equal(previewCanvas.style.transform, "scale(0.3333333333333333)");

  await addButton.click();
  assert.deepEqual(added, ["materials/action.stml"]);

  assert.equal(item.children.length, 1);
  let prevented = false;
  item.click("contextmenu", {
    clientX: 120,
    clientY: 220,
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(menu.hidden, false);
  assert.equal(editMenuItem.focused, true);
  await editMenuItem.click();
  assert.deepEqual(opened, ["materials/action.stml"]);
  assert.equal(menu.hidden, true);
});

test("Material selector crops to project framing metadata without changing placement size", async () => {
  const { ProjectFileNavigator } = await import("../frontend/browser/ProjectFileNavigator.mjs");
  const list = createElement("div");
  const material = {
    id: "action",
    file: "materials/action.stml",
    data: {
      id: "action",
      name: "Action",
      type: "button",
      "preview-size": { width: 300, height: 100 },
      attributes: {}
    },
    html: "<div>Action</div>"
  };
  const navigator = new ProjectFileNavigator({
    state: {
      project: { "material-previews": { action: { x: 20, y: 10, width: 200, height: 40 } } },
      materialFiles: new Map([[material.file, material]])
    },
    services: {
      document: createDocument(),
      window: { setTimeout() {} },
      byId: () => list,
      element: createElement,
      getMaterialDropGeometry: () => ({ inside: false }),
      templateMarkupRenderer: { mount() {} },
      placeMaterialFile: async () => {},
      renderMaterialFile: async () => {},
      showEditorMessage() {}
    },
    projectFileTree: {}
  });
  let draggedPlacementSize;
  navigator.bindMaterialDragButton = (_button, _filePath, size) => {
    draggedPlacementSize = size;
  };

  navigator.renderMaterialSelector();

  const item = list.children[0];
  const addButton = item.children[0];
  const viewport = addButton.children[0].children[0];
  const previewCanvas = viewport.children[0];
  assert.equal(viewport.style.width, "160px");
  assert.equal(viewport.style.height, "32px");
  assert.equal(previewCanvas.style.left, "-16px");
  assert.equal(previewCanvas.style.top, "-8px");
  assert.equal(previewCanvas.style.transform, "scale(0.8)");
  assert.equal(previewCanvas.style.width, "300px");
  assert.equal(previewCanvas.style.height, "100px");
  assert.deepEqual(draggedPlacementSize, { width: 160, height: 48 });
});

test("selector frame edits persist only project presentation metadata", async () => {
  const { MaterialFileEditor } = await import("../frontend/browser/MaterialFileEditor.mjs");
  const material = {
    id: "action",
    file: "materials/action.stml",
    documentSource: "unchanged STML",
    data: { id: "action", "preview-size": { width: 300, height: 100 } }
  };
  const placement = { position: { x: 30, y: 40 }, size: { width: 160, height: 48 } };
  const state = { project: {} };
  const marked = [];
  let rendered = false;
  const editor = Object.create(MaterialFileEditor.prototype);
  editor.state = state;
  editor.services = {
    markEdited: (filePath) => marked.push(filePath),
    renderNavigation: () => { rendered = true; }
  };
  const frame = { x: 20, y: 10, width: 100, height: 40 };
  editor.finishSelectorFrameGesture(
    { pointerId: 7 },
    {
      pointerId: 7,
      target: { hasPointerCapture: () => false },
      material,
      changed: true,
      currentFrame: frame
    }
  );

  assert.deepEqual(state.project["material-previews"].action, frame);
  assert.equal(material.documentSource, "unchanged STML");
  assert.deepEqual(placement, { position: { x: 30, y: 40 }, size: { width: 160, height: 48 } });
  assert.deepEqual(marked, ["project.yml"]);
  assert.equal(rendered, true);
});

test("selector frame can move and resize within the Material preview canvas", async () => {
  const { MaterialFileEditor } = await import("../frontend/browser/MaterialFileEditor.mjs");
  const editor = Object.create(MaterialFileEditor.prototype);
  const gesture = {
    frame: { x: 20, y: 10, width: 100, height: 40 },
    size: { width: 300, height: 100 },
    direction: "move"
  };
  assert.deepEqual(editor.getUpdatedSelectorFrame(gesture, 25, 15), {
    x: 45,
    y: 25,
    width: 100,
    height: 40
  });

  gesture.direction = "se";
  assert.deepEqual(editor.getUpdatedSelectorFrame(gesture, 30, 20), {
    x: 20,
    y: 10,
    width: 130,
    height: 60
  });
  assert.deepEqual(editor.getUpdatedSelectorFrame(gesture, 500, 500), {
    x: 20,
    y: 10,
    width: 280,
    height: 90
  });
});

test("Material selector uses the type's default preview size when no override exists", async () => {
  const { ProjectFileNavigator } = await import("../frontend/browser/ProjectFileNavigator.mjs");
  const list = createElement("div");
  const material = {
    id: "avatar",
    file: "materials/avatar.stml",
    data: { id: "avatar", name: "Avatar", type: "avatar", attributes: {} },
    html: "<span>Avatar</span>"
  };
  const navigator = new ProjectFileNavigator({
    state: { materialFiles: new Map([[material.file, material]]) },
    services: {
      document: createDocument(),
      window: { setTimeout() {} },
      byId: () => list,
      element: createElement,
      getMaterialDropGeometry: () => ({ inside: false }),
      templateMarkupRenderer: { mount() {} },
      placeMaterialFile: async () => {},
      renderMaterialFile: async () => {},
      showEditorMessage() {}
    },
    projectFileTree: {}
  });

  navigator.renderMaterialSelector();

  assert.equal(list.children[0].children[0].children[0].children[0].style.width, "48px");
  assert.equal(list.children[0].children[0].children[0].children[0].style.height, "48px");
});

test("dragging a selector tile shows the transformed outline and drops at its canvas position", async () => {
  const { ProjectFileNavigator } = await import("../frontend/browser/ProjectFileNavigator.mjs");
  const list = createElement("div");
  const previewRoot = createElement("article");
  const document = createDocument();
  const added = [];
  let clearSuppression;
  const material = {
    id: "action",
    file: "materials/action.stml",
    base: new URL("https://example.test/materials/"),
    data: { id: "action", name: "Action", type: "button" },
    html: "<button>Continue</button>"
  };
  const navigator = new ProjectFileNavigator({
    state: { materialFiles: new Map([[material.file, material]]) },
    services: {
      document,
      window: { setTimeout(callback) { clearSuppression = callback; } },
      byId: (id) => id === "material-selector-list" ? list : previewRoot,
      element: createElement,
      getMaterialDropGeometry: () => ({
        inside: true,
        position: { x: 80, y: 120 },
        outline: { left: 40, top: 50, width: 160, height: 48 }
      }),
      templateMarkupRenderer: { mount() {} },
      placeMaterialFile: async (...args) => added.push(args),
      renderMaterialFile: async () => {},
      showEditorMessage() {}
    },
    projectFileTree: {}
  });

  navigator.renderMaterialSelector();
  const addButton = list.children[0].children[0];
  addButton.click("pointerdown", {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 7,
    preventDefault() {}
  });
  document.dispatch("pointermove", {
    clientX: 20,
    clientY: 20,
    pointerId: 7
  });
  const outline = previewRoot.children[0];
  assert.equal(outline.hidden, false);
  assert.equal(outline.style.width, "160px");
  assert.equal(outline.style.height, "48px");
  assert.equal(outline.style.left, "40px");
  assert.equal(outline.style.top, "50px");

  await document.dispatch("pointerup", {
    clientX: 20,
    clientY: 20,
    pointerId: 7
  });
  assert.deepEqual(added, [["materials/action.stml", { x: 80, y: 120 }]]);
  assert.equal(outline.hidden, true);
  await addButton.click();
  assert.equal(added.length, 1);
  clearSuppression();
});

test("Material workspace return action exits to the Screen workspace", async () => {
  const { EditorEventController } = await import("../frontend/browser/EditorEventController.mjs");
  let returned = false;
  let returnAction;
  const controller = Object.create(EditorEventController.prototype);
  controller.services = {
    byId: () => ({ addEventListener: (_name, callback) => { returnAction = callback; } }),
    returnToScreen: () => { returned = true; }
  };
  controller.bindMaterialReturn();

  returnAction();

  assert.equal(returned, true);
});
