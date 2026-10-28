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
