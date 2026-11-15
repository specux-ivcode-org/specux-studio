const assert = require("node:assert/strict");
const test = require("node:test");

/** Creates an Escape event and captures the document-level key handler. */
async function createEscapeHarness({
  activeElement = null,
  dialogOpen = false,
  localEscape = false,
  closeWorkflowNodeSpec = false,
  viewingMaterialFile = false
} = {}) {
  const { EditorEventController } = await import(
    "../frontend/browser/EditorEventController.mjs"
  );
  let keydownHandler;
  let captureKeydownHandler;
  const workspaceEscapes = [];
  const services = {
    document: {
      activeElement,
      addEventListener(type, handler, capture) {
        if (type !== "keydown") return;
        if (capture) captureKeydownHandler = handler;
        else keydownHandler = handler;
      },
      querySelector: () => dialogOpen ? {} : null
    },
    handleLocalEscape: () => localEscape,
    shouldCloseWorkflowNodeSpecOnEscape: () => closeWorkflowNodeSpec,
    hasWorkspaceEscapeView: () => true,
    handleWorkspaceEscape: async () => workspaceEscapes.push("handled"),
    showFatalError: (error) => { throw error; }
  };
  const controller = new EditorEventController({
    state: { viewingMaterialFile },
    services
  });
  controller.bindWorkspaceEscape();
  const event = {
    key: "Escape",
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };

  return { event, keydownHandler, captureKeydownHandler, workspaceEscapes };
}

/** Local UI interactions consume Escape before it can exit the active editor mode. */
test("workspace Escape gives local interactions precedence", async () => {
  const harness = await createEscapeHarness({ localEscape: true });

  harness.keydownHandler(harness.event);

  assert.equal(harness.event.defaultPrevented, true);
  assert.deepEqual(harness.workspaceEscapes, []);
});

/** Focused text edits end before Escape changes workspace navigation. */
test("workspace Escape blurs a transient text editor first", async () => {
  let blurred = false;
  const harness = await createEscapeHarness({
    activeElement: { tagName: "TEXTAREA", blur() { blurred = true; } }
  });

  harness.keydownHandler(harness.event);

  assert.equal(harness.event.defaultPrevented, true);
  assert.equal(blurred, true);
  assert.deepEqual(harness.workspaceEscapes, []);
});

test("Escape leaves the Material workspace even when its source editor has focus", async () => {
  let blurred = false;
  const harness = await createEscapeHarness({
    activeElement: { tagName: "TEXTAREA", blur() { blurred = true; } },
    viewingMaterialFile: true
  });

  harness.captureKeydownHandler(harness.event);
  await Promise.resolve();

  assert.equal(harness.event.defaultPrevented, true);
  assert.equal(blurred, false);
  assert.deepEqual(harness.workspaceEscapes, ["handled"]);
});

test("Material Escape is handled before focused project-file controls", async () => {
  const harness = await createEscapeHarness({ viewingMaterialFile: true });

  harness.captureKeydownHandler(harness.event);
  await Promise.resolve();

  assert.equal(harness.event.defaultPrevented, true);
  assert.equal(harness.event.propagationStopped, true);
  assert.deepEqual(harness.workspaceEscapes, ["handled"]);
});

test("Escape closes a focused Workflow node spec editor", async () => {
  let blurred = false;
  const harness = await createEscapeHarness({
    activeElement: { tagName: "TEXTAREA", blur() { blurred = true; } },
    closeWorkflowNodeSpec: true
  });

  harness.keydownHandler(harness.event);
  await Promise.resolve();

  assert.equal(harness.event.defaultPrevented, true);
  assert.equal(blurred, false);
  assert.deepEqual(harness.workspaceEscapes, ["handled"]);
});

/** Native dialogs retain their own Escape handling. */
test("workspace Escape leaves an open dialog to handle the key", async () => {
  const harness = await createEscapeHarness({ dialogOpen: true });

  harness.keydownHandler(harness.event);

  assert.equal(harness.event.defaultPrevented, false);
  assert.deepEqual(harness.workspaceEscapes, []);
});

test("Delete removes selected placements in the Screen workspace", async () => {
  const { EditorEventController } = await import(
    "../frontend/browser/EditorEventController.mjs"
  );
  let keydownHandler;
  let deleted = 0;
  const controller = new EditorEventController({
    state: {},
    services: {
      document: {
        activeElement: { tagName: "BODY" },
        addEventListener(type, handler) {
          if (type === "keydown") keydownHandler = handler;
        },
        querySelector: () => null
      },
      canDeleteSelectedPlacements: () => true,
      deleteSelectedPlacements: async () => { deleted += 1; },
      showEditorMessage: (_title, message) => { throw new Error(message); }
    }
  });
  controller.bindDeleteShortcut();
  const event = {
    key: "Delete",
    target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; }
  };

  keydownHandler(event);
  await Promise.resolve();

  assert.equal(event.defaultPrevented, true);
  assert.equal(deleted, 1);
});

test("Delete does not remove placements while editing text", async () => {
  const { EditorEventController } = await import(
    "../frontend/browser/EditorEventController.mjs"
  );
  let keydownHandler;
  let deleted = false;
  const controller = new EditorEventController({
    state: {},
    services: {
      document: {
        activeElement: { tagName: "TEXTAREA" },
        addEventListener(type, handler) {
          if (type === "keydown") keydownHandler = handler;
        },
        querySelector: () => null
      },
      canDeleteSelectedPlacements: () => true,
      deleteSelectedPlacements: async () => { deleted = true; },
      showEditorMessage: (_title, message) => { throw new Error(message); }
    }
  });
  controller.bindDeleteShortcut();
  const event = {
    key: "Delete",
    target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; }
  };

  keydownHandler(event);
  await Promise.resolve();

  assert.equal(event.defaultPrevented, undefined);
  assert.equal(deleted, false);
});

test("browser Back restores the URL context and replaces instead of adding history", async () => {
  const { EditorEventController } = await import(
    "../frontend/browser/EditorEventController.mjs"
  );
  let popstateHandler;
  const restored = [];
  const synchronized = [];
  const selection = {
    view: "url",
    file: "screens/home/workflows/checkout.mmd",
    canvasTarget: "screen/settings/screen.yml?placement=save"
  };
  const state = { historyUpdateSuppressed: false };
  const controller = new EditorEventController({
    state,
    services: {
      window: {
        addEventListener(type, handler) {
          if (type === "popstate") popstateHandler = handler;
        }
      },
      isRenderOnly: false,
      selectionFromLocation: () => selection,
      restoreUiSelection: async (target) => restored.push(target),
      syncBrowserHistory: (forceReplace) => synchronized.push(forceReplace),
      showEditorMessage: (_title, message) => { throw new Error(message); },
      loadProject: async () => {}
    }
  });
  controller.bindBrowserHistory();

  popstateHandler({ state: { specuxEditor: { selection: { view: "screen" } } } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(restored, [selection]);
  assert.deepEqual(synchronized, [true]);
  assert.equal(state.historyUpdateSuppressed, false);
});
