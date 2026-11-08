const assert = require("node:assert/strict");
const test = require("node:test");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("clears prior-session annotations before loading a Screen", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const requests = [];
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: () => ({ textContent: "", classList: { toggle() {} } }),
      fetcher: async (url, options = {}) => {
        requests.push({ url, method: options.method || "GET" });
        if (url === "/api/annotations" && options.method === "DELETE") {
          return response({ cleared: 1 });
        }
        if (url === "/api/annotations?screenId=home") {
          return response({ screenId: "home", annotations: [], updatedAt: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    }
  });
  controller.render = () => {};
  controller.updateControls = () => {};

  await controller.setScreen({ id: "home" });

  assert.deepEqual(requests, [
    { url: "/api/annotations", method: "DELETE" },
    { url: "/api/annotations?screenId=home", method: "GET" }
  ]);
});

test("updates annotation tool buttons and actions for the active tool", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const attributes = new Map();
  const makeButton = (tool) => ({
    dataset: { annotationTool: tool },
    disabled: false,
    setAttribute(name, value) {
      attributes.set(`${tool || "mode"}:${name}`, value);
    }
  });
  const toolButtons = ["pen", "circle", "rectangle", "arrow", "highlight", "note"]
    .map(makeButton);
  const controls = new Map([
    ["annotation-mode-exit", { ...makeButton(null), disabled: true }],
    ["annotation-undo", makeButton(null)],
    ["annotation-redo", makeButton(null)],
    ["annotation-clear", makeButton(null)]
  ]);
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: (id) => controls.get(id),
      document: { querySelectorAll: () => toolButtons }
    }
  });
  controller.screenId = "home";
  controller.context = { key: "screen:home", kind: "screen" };
  controller.enabled = true;
  controller.tool = "rectangle";
  controller.annotations = [{ id: "mark-1" }];

  controller.updateControls();

  assert.equal(controls.get("annotation-mode-exit").disabled, false);
  assert.equal(attributes.get("rectangle:aria-pressed"), "true");
  assert.equal(attributes.get("circle:aria-pressed"), "false");
  assert.equal(toolButtons.every((button) => !button.disabled), true);
  assert.equal(controls.get("annotation-undo").disabled, false);
  assert.equal(controls.get("annotation-redo").disabled, true);
  assert.equal(controls.get("annotation-clear").disabled, false);
});

test("selecting a tool enters annotation mode and Exit leaves it", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const attributes = new Map();
  const toolButtons = ["pen", "circle", "rectangle", "arrow", "highlight", "note"].map((tool) => ({
    dataset: { annotationTool: tool },
    setAttribute(name, value) {
      attributes.set(`${tool}:${name}`, value);
    }
  }));
  const exitButton = { disabled: true };
  const status = { textContent: "", classList: { toggle() {} } };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: (id) => id === "annotation-mode-exit" ? exitButton : status,
      document: { querySelectorAll: () => toolButtons }
    }
  });
  controller.screenId = "home";
  controller.context = { key: "screen:home", kind: "screen" };
  controller.render = () => {};

  controller.updateControls();
  assert.equal(exitButton.disabled, true);

  controller.selectTool("circle");

  assert.equal(controller.enabled, true);
  assert.equal(controller.tool, "circle");
  assert.equal(exitButton.disabled, false);
  assert.equal(attributes.get("circle:aria-pressed"), "true");
  controller.setEnabled(false);
  assert.equal(exitButton.disabled, true);
  assert.equal(attributes.get("circle:aria-pressed"), "false");
});

test("arrow annotations reference the marker rendered in their overlay", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  function createSvgNode(tagName) {
    return {
      tagName,
      attributes: new Map(),
      children: [],
      append(child) {
        this.children.push(child);
      },
      setAttribute(name, value) {
        this.attributes.set(name, value);
      }
    };
  }
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      document: { createElementNS: (_namespace, tagName) => createSvgNode(tagName) }
    }
  });
  const overlay = createSvgNode("svg");
  const markerId = "annotation-arrowhead-material-source";
  controller.renderArrowhead(overlay, markerId);
  controller.renderAnnotation({
    id: "arrow-1",
    tool: "arrow",
    points: [{ x: 10, y: 20 }, { x: 80, y: 90 }]
  }, overlay, markerId);

  const marker = overlay.children[0].children[0];
  const line = overlay.children[1].children.find((child) => child.tagName === "line");
  assert.equal(marker.attributes.get("id"), markerId);
  assert.equal(line.attributes.get("marker-end"), `url(#${markerId})`);
});

test("publishes non-Screen editor annotations as transient selection context", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  let published = 0;
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      publishSelection: () => { published += 1; }
    }
  });
  controller.render = () => {};
  controller.updateControls = () => {};
  controller.setEditorContext({
    key: "spec:screens/home/specs/overview.md:markdown",
    view: "spec",
    type: "spec",
    file: "screens/home/specs/overview.md",
    mode: "markdown"
  });
  controller.annotations.push({
    id: "mark-1",
    tool: "note",
    points: [{ x: 120, y: 80 }],
    text: "Change this heading"
  });

  await controller.persist();

  assert.equal(published, 1);
  assert.deepEqual(controller.getEditorAnnotationContext(), {
    annotationContext: {
      key: "spec:screens/home/specs/overview.md:markdown",
      view: "spec",
      type: "spec",
      file: "screens/home/specs/overview.md",
      mode: "markdown",
      coordinateSpace: "editor preview pixels",
      canvasSize: { width: 1440, height: 900 },
      previews: []
    },
    annotations: [{
      id: "mark-1",
      tool: "note",
      points: [{ x: 120, y: 80 }],
      text: "Change this heading"
    }]
  });
  assert.equal(controller.screenId, null);
});

test("keeps editor annotations in each preview's full scrollable coordinate space", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const preview = {
    id: "workflow-diagram",
    dataset: { annotationPreview: "workflow-diagram" },
    hidden: false,
    scrollWidth: 720,
    scrollHeight: 1400,
    clientWidth: 300,
    clientHeight: 500,
    scrollLeft: 40,
    scrollTop: 200,
    offsetWidth: 300,
    offsetHeight: 500,
    getAttribute: () => "Workflow diagram preview",
    getBoundingClientRect: () => ({ left: 20, top: 50, width: 300, height: 500 }),
    closest: () => null,
    classList: { toggle() {} }
  };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      document: { querySelectorAll: () => [preview] }
    }
  });
  controller.context = {
    key: "workflow:screens/home/workflows/main.mmd:home",
    kind: "editor",
    view: "workflow",
    type: "workflow",
    file: "screens/home/workflows/main.mmd",
    mode: "split:diagram"
  };
  controller.editorTargets = new Map([["workflow-diagram", {
    id: "workflow-diagram",
    element: preview,
    scrollElement: preview,
    width: 720,
    height: 1400
  }]]);
  controller.annotations = [{
    id: "mark-1",
    tool: "pen",
    previewId: "workflow-diagram",
    points: [{ x: 120, y: 200 }]
  }];

  assert.deepEqual(controller.pointFromEvent({ clientX: 100, clientY: 150 }, "workflow-diagram"), {
    x: 120,
    y: 300
  });
  assert.deepEqual(controller.getEditorAnnotationContext(), {
    annotationContext: {
      key: "workflow:screens/home/workflows/main.mmd:home",
      view: "workflow",
      type: "workflow",
      file: "screens/home/workflows/main.mmd",
      mode: "split:diagram",
      coordinateSpace: "editor preview pixels",
      canvasSize: { width: 1440, height: 1400 },
      previews: [{
        id: "workflow-diagram",
        label: "Workflow diagram preview",
        coordinateSpace: "preview content pixels",
        canvasSize: { width: 720, height: 1400 }
      }]
    },
    annotations: controller.annotations
  });
});

test("maps Material source annotations through the scrolled text mirror", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const sourceCanvas = {
    dataset: {},
    scrollWidth: 880,
    scrollHeight: 1200,
    clientWidth: 360,
    clientHeight: 480,
    scrollLeft: 24,
    scrollTop: 180,
    offsetWidth: 360,
    offsetHeight: 480,
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 360, height: 480 }),
    classList: { remove() {}, toggle() {} }
  };
  const host = {
    id: "material-source-container",
    dataset: { annotationPreview: "material-source" },
    hidden: false,
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 360, height: 480 }),
    getAttribute: () => "Material source preview",
    closest: () => null,
    querySelector: (selector) =>
      selector === ":scope > [data-annotation-canvas]" ? sourceCanvas : null
  };
  const controller = new ScreenAnnotationController({
    state: {},
    services: { document: { querySelectorAll: () => [host] } }
  });
  controller.context = { kind: "editor", key: "material:button" };
  controller.editorTargets = new Map(
    controller.getEditorPreviewTargets().map((target) => [target.id, target])
  );

  assert.deepEqual(
    controller.pointFromEvent({ clientX: 140, clientY: 130 }, "material-source"),
    { x: 64, y: 230 }
  );
  assert.equal(sourceCanvas.dataset.annotationCaptureScroll, "material-source");
});

test("discovers the spec source text area as an annotation preview", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const sourceCanvas = {
    scrollWidth: 480,
    scrollHeight: 920,
    clientWidth: 480,
    clientHeight: 620,
    offsetWidth: 480,
    offsetHeight: 620,
    scrollLeft: 18,
    scrollTop: 200,
    dataset: {},
    getBoundingClientRect: () => ({ left: 20, top: 30, width: 480, height: 620 })
  };
  const sourceContainer = {
    dataset: { annotationPreview: "spec-source" },
    hidden: false,
    scrollWidth: 480,
    scrollHeight: 620,
    clientWidth: 480,
    clientHeight: 620,
    querySelector: (selector) =>
      selector === ":scope > [data-annotation-canvas]" ? sourceCanvas : null,
    getAttribute: () => "Behavior spec source preview",
    getBoundingClientRect: () => ({ left: 20, top: 30, width: 480, height: 620 }),
    closest: () => null,
    classList: { toggle() {} }
  };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      document: { querySelectorAll: () => [sourceContainer] }
    }
  });
  controller.render = () => {};
  controller.updateControls = () => {};
  controller.setEditorContext({
    key: "spec:screens/home/specs/overview.md",
    view: "spec",
    type: "spec",
    file: "screens/home/specs/overview.md",
    mode: "split"
  });

  const target = controller.getEditorPreviewTargets()[0];
  controller.editorTargets = new Map([[target.id, target]]);

  assert.equal(target.id, "spec-source");
  assert.equal(target.element, sourceCanvas);
  assert.equal(target.scrollElement, sourceCanvas);
  assert.equal(target.captureElement, sourceContainer);
  assert.equal(target.width, 480);
  assert.equal(target.height, 920);
  assert.deepEqual(
    controller.pointFromEvent({ clientX: 120, clientY: 150 }, "spec-source"),
    { x: 118, y: 320 }
  );
  assert.equal(sourceCanvas.dataset.annotationCaptureScroll, "spec-source");
  assert.equal(sourceContainer.dataset.annotationCaptureScroll, undefined);
  assert.deepEqual(
    controller.getEditorAnnotationContext().annotationContext.previews,
    [{
      id: "spec-source",
      label: "Behavior spec source preview",
      coordinateSpace: "preview content pixels",
      canvasSize: { width: 480, height: 920 }
    }]
  );
});

test("saves absolute canvas annotations without capturing a browser image", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const annotationUpdatedAt = "2026-10-25T12:00:00.000Z";
  let annotationRequest;
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      getActivePreviewStateId: () => "add-item-open",
      fetcher: async (url, options = {}) => {
        if (url === "/api/annotations") {
          annotationRequest = options;
          return response({ saved: 1, cached: true, updatedAt: annotationUpdatedAt });
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    }
  });
  controller.screenId = "home";
  controller.annotationRevision = 1;
  controller.renderWidth = 1440;
  controller.renderHeight = 900;
  controller.annotations = [{
    id: "note-1",
    tool: "note",
    points: [{ x: 220, y: 180 }],
    text: "Review this Material",
    target: { instancePath: [0], materialId: "header", materialSrc: "materials/surface.stml" }
  }];

  await controller.persist();

  assert.equal(annotationRequest.method, "POST");
  assert.equal(annotationRequest.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(annotationRequest.body), {
    screenId: "home",
    annotations: controller.annotations,
    coordinateSpace: "screen canvas pixels",
    canvasSize: { width: 1440, height: 900 },
    previewStateId: "add-item-open"
  });
});

test("converts pointer positions to absolute canvas pixels at zoomed scale", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const content = {
    offsetWidth: 1440,
    offsetHeight: 900,
    getBoundingClientRect: () => ({ left: -120, top: -45, width: 720, height: 450 })
  };
  const preview = { querySelector: () => content };
  const controller = new ScreenAnnotationController({
    state: {},
    services: { byId: () => preview }
  });
  controller.renderWidth = 1440;
  controller.renderHeight = 900;

  assert.deepEqual(controller.pointFromEvent({ clientX: 100, clientY: 100 }), {
    x: 440,
    y: 290
  });
});

test("maps editor viewport positions into a stable annotation canvas after resize", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const main = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 500, height: 400 })
  };
  const controller = new ScreenAnnotationController({
    state: {},
    services: { byId: (id) => id === "main" ? main : null }
  });
  controller.context = { key: "spec:overview:markdown", kind: "editor" };
  controller.renderWidth = 1000;
  controller.renderHeight = 800;

  assert.deepEqual(controller.pointFromEvent({ clientX: 350, clientY: 250 }), {
    x: 500,
    y: 400
  });
});

test("places the annotation overlay above material layers and captures the canvas", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const overlay = {
    style: {},
    setAttribute() {},
    replaceChildren() {},
    append() {}
  };
  const content = {
    offsetWidth: 1440,
    offsetHeight: 900,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    querySelector: () => overlay,
    querySelectorAll: () => [{
      style: { zIndex: "42" },
      getBoundingClientRect: () => ({ right: 0, bottom: 0 })
    }]
  };
  const preview = {
    querySelector: () => content,
    classList: { toggle() {} }
  };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: (id) => id === "main" ? { querySelector: () => null } : preview,
      document: {
        createElementNS: () => ({
          setAttribute() {},
          append() {}
        })
      }
    }
  });
  controller.enabled = true;

  controller.render();

  assert.equal(overlay.style.zIndex, "43");
  assert.equal(overlay.style.pointerEvents, "all");
});

test("records Material identity as the target of an annotation", async () => {
  const { ScreenAnnotationController } = await import("../frontend/browser/ScreenAnnotationController.mjs");
  const content = {
    offsetWidth: 1440,
    offsetHeight: 900,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 })
  };
  const preview = { querySelector: () => content };
  const material = {
    classList: { contains: (name) => name === "material-instance" },
    dataset: {
      instancePath: "[2]",
      materialId: "brand-label",
      materialSrc: "materials/label.stml"
    },
    parentElement: null
  };
  const text = { textContent: "Northstar", parentElement: material };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: () => preview,
      document: { elementFromPoint: () => text }
    }
  });
  controller.overlay = { style: {} };
  controller.enabled = true;

  assert.deepEqual(controller.targetAtPoint({ x: 120, y: 80 }), {
    instancePath: [2],
    materialId: "brand-label",
    materialSrc: "materials/label.stml",
    text: "Northstar"
  });
});
