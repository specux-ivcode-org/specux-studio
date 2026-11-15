const assert = require("node:assert/strict");
const test = require("node:test");
const validation = require("../shared/validation");

/** Creates an editor with the collaborators required for workflow lifecycle actions. */
async function createEditor(overrides = {}) {
  const { WorkflowEditor } = await import("../frontend/browser/WorkflowEditor.mjs");
  const controls = new Map();
  for (const id of [
    "workflow-panel-diagram",
    "workflow-panel-source",
    "workflow-view-split",
    "workflow-view-diagram",
    "workflow-spec-section-previous",
    "workflow-spec-section-next",
    "workflow-linked-back",
    "workflow-mode-exit",
    "workflow-spec-file-select"
  ]) {
    controls.set(id, {
      listeners: {},
      addEventListener(name, listener) { this.listeners[name] = listener; }
    });
  }
  const state = {
    screens: [{ id: "home", file: "screens/home/screen.yml", data: {} }],
    activeScreenIndex: 0,
    projectFilePaths: [],
    workflowSources: new Map(),
    createdWorkflowFiles: new Set(),
    invalidWorkflowFiles: new Map(),
    dirtyFiles: new Map(),
    ...overrides.state
  };
  const calls = {
    created: [],
    deleted: [],
    edited: [],
    markedDeleted: [],
    cleared: [],
    rendered: [],
    expanded: []
  };
  const services = {
    byId: (id) => controls.get(id),
    prompt: () => "Add item",
    confirm: () => true,
    fetcher: async () => ({ status: 404, ok: false }),
    safeProjectUrl: (filePath) => filePath,
    validation,
    projectFileTree: { expandPath: (filePath) => calls.expanded.push(filePath) },
    showEditorMessage() {},
    markEdited: (filePath) => calls.edited.push(filePath),
    markDeleted: (filePath) => calls.markedDeleted.push(filePath),
    clearEdited: (filePath) => calls.cleared.push(filePath),
    updateSaveControls() {},
    renderNavigation() {},
    renderInspector() {},
    renderWorkflowEditor: async (filePath, screenIndex) =>
      calls.rendered.push({ filePath, screenIndex }),
    deleteWorkflowFile: async (filePath) => calls.deleted.push(filePath),
    ...overrides.services
  };
  return { editor: new WorkflowEditor({ state, services }), state, services, calls, controls };
}

test("Workflow header close delegates to the primary mode exit", async () => {
  let exitCount = 0;
  const { controls } = await createEditor({
    services: { exitWorkflowMode: async () => { exitCount += 1; } }
  });

  await controls.get("workflow-mode-exit").listeners.click();

  assert.equal(exitCount, 1);
});

test("creates a Screen-owned workflow and tracks it as a new project file", async () => {
  const { editor, state, calls } = await createEditor();

  const filePath = await editor.createForScreen();

  assert.equal(filePath, "screens/home/workflows/add-item.mmd");
  assert.equal(state.workflowSources.get(filePath), 'flowchart TD\n  start["Start"]\n');
  assert.equal(state.createdWorkflowFiles.has(filePath), true);
  assert.deepEqual(calls.edited, [filePath]);
  assert.deepEqual(calls.expanded, [filePath]);
  assert.deepEqual(calls.rendered, [{ filePath, screenIndex: 0 }]);
});

test("detects Mermaid entry points in vertex source order", async () => {
  const { getWorkflowEntryNodeIds } = await import(
    "../frontend/browser/WorkflowEditor.mjs"
  );
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false });

  assert.deepEqual(await getWorkflowEntryNodeIds(mermaid, [
    "flowchart TD",
    "first",
    "later --> first"
  ].join("\n")), ["later"]);
  assert.deepEqual(await getWorkflowEntryNodeIds(mermaid, [
    "flowchart TD",
    "start --> finish",
    "alternate"
  ].join("\n")), ["start", "alternate"]);
  assert.deepEqual(await getWorkflowEntryNodeIds(mermaid, [
    "flowchart TD",
    "first --> second",
    "second --> first"
  ].join("\n")), []);
});

test("selects the first entry point and warns when there is no entry point", async () => {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false });
  const classes = new Set();
  const node = {
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    },
    getAttribute: () => "source",
    querySelectorAll: () => []
  };
  const statusClasses = new Set();
  const status = {
    textContent: "",
    classList: {
      add: (value) => statusClasses.add(value),
      remove: (...values) => values.forEach((value) => statusClasses.delete(value)),
      toggle(value, enabled) {
        if (enabled) statusClasses.add(value);
        else statusClasses.delete(value);
      },
      contains: (value) => statusClasses.has(value)
    }
  };
  const diagram = { querySelectorAll: () => [node] };
  const { editor, state } = await createEditor({
    services: {
      byId: (id) => id === "workflow-diagram" ? diagram
        : id === "workflow-status" ? status
          : { addEventListener() {} }
    }
  });
  editor.getMermaid = async () => mermaid;
  state.activeWorkflowPath = "screens/home/workflows/example.mmd";
  await editor.selectInitialWorkflowNode(new Map(), [
    "flowchart TD",
    "later",
    "source --> later",
    "alternate"
  ].join("\n"));
  assert.equal(state.selectedWorkflowNodeId, "source");
  assert.equal(classes.has("selected"), true);
  assert.match(status.textContent, /multiple entry points/);
  assert.equal(statusClasses.has("warning"), true);

  node.getAttribute = () => "first";
  classes.add("selected");
  state.selectedWorkflowNodeId = "first";
  await editor.selectInitialWorkflowNode(new Map(), [
    "flowchart TD",
    "first --> second",
    "second --> first"
  ].join("\n"));
  assert.equal(state.selectedWorkflowNodeId, null);
  assert.equal(classes.has("selected"), false);
  assert.match(status.textContent, /no entry point/);
});

test("keeps the existing canvas context when a workflow target cannot be resolved", async () => {
  const classes = new Set();
  const statusClasses = new Set();
  const node = {
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    },
    getAttribute: () => "save",
    querySelectorAll: () => []
  };
  const diagram = {
    querySelectorAll(selector) {
      return selector === "g.node.selected" ? [] : [node];
    }
  };
  const status = {
    textContent: "",
    classList: {
      add: (value) => statusClasses.add(value),
      remove: (...values) => values.forEach((value) => statusClasses.delete(value)),
      contains: (value) => statusClasses.has(value)
    }
  };
  const calls = [];
  const { editor, state } = await createEditor({
    state: { workflowScreenIndex: 0, activeWorkflowPath: "screens/home/workflows/account.mmd" },
    services: {
      byId: (id) => id === "workflow-diagram" ? diagram
        : id === "workflow-status" ? status
          : { addEventListener() {} },
      showWorkflowNode: async (...args) => {
        calls.push(args);
        return { warning: 'Element "missing" is not available on Screen "home".' };
      }
    }
  });

  await editor.selectNode("save", {
    screenId: "home",
    placementIds: ["missing"],
    stateId: "default"
  });

  assert.equal(state.selectedWorkflowNodeId, "save");
  assert.deepEqual(calls, [[{
    screenId: "home",
    placementIds: ["missing"],
    stateId: "default"
  }, 0, "screens/home/workflows/account.mmd"]]);
  assert.match(status.textContent, /Element "missing" is not available/);
  assert.equal(statusClasses.has("warning"), true);
  assert.equal(statusClasses.has("error"), false);
});

test("checks existing workflow paths before selecting a unique creation path", async () => {
  const { editor, state, services } = await createEditor({
    state: {
      workflowSources: new Map([
        ["screens/home/workflows/add-item.mmd", "existing"]
      ])
    },
    services: {
      fetcher: async () => ({ status: 404, ok: false }),
      prompt: () => "Add item"
    }
  });

  const filePath = await editor.createForScreen();

  assert.equal(filePath, "screens/home/workflows/add-item-2.mmd");
  assert.equal(state.workflowSources.has(filePath), true);
  assert.equal(services.validation.validateWorkflowPath(filePath), filePath);
});

test("deletes workflows as undoable project edits", async () => {
  const filePath = "screens/home/workflows/add-item.mmd";
  const { editor, state, services, calls } = await createEditor({
    state: {
      workflowSources: new Map([[filePath, "flowchart TD"]]),
      createdWorkflowFiles: new Set([filePath]),
      dirtyFiles: new Map([[filePath, 1]])
    }
  });

  assert.equal(await editor.deleteWorkflow(filePath), true);
  assert.equal(state.workflowSources.has(filePath), false);
  assert.equal(state.createdWorkflowFiles.has(filePath), false);
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.markedDeleted, [filePath]);

  state.workflowSources.set(filePath, "flowchart TD");
  state.dirtyFiles.set(filePath, 2);
  state.fileHashes = new Map([[filePath, "a".repeat(64)]]);
  await editor.deleteWorkflow(filePath);
  assert.deepEqual(calls.markedDeleted, [filePath, filePath]);
  assert.deepEqual(calls.deleted, []);

  services.confirm = () => false;
  state.workflowSources.set(filePath, "flowchart TD");
  assert.equal(await editor.deleteWorkflow(filePath), false);
  assert.equal(state.workflowSources.has(filePath), true);
  assert.deepEqual(calls.deleted, []);
});

test("saves newly created workflows with create=true and clears the marker on acknowledgment", async () => {
  const { ProjectPersistence } = await import("../frontend/browser/ProjectPersistence.mjs");
  const filePath = "screens/home/workflows/add-item.mmd";
  const state = {
    specSources: new Map(),
    workflowSources: new Map([[filePath, "flowchart TD"]]),
    createdWorkflowFiles: new Set([filePath]),
    createdScreenFiles: new Set(),
    createdMaterialFiles: new Set(),
    createdSpecFiles: new Set(),
    createdSpecDrafts: new Map(),
    invalidYamlFiles: new Map(),
    invalidWorkflowFiles: new Map(),
    dirtyFiles: new Map([[filePath, 1]]),
    screens: [],
    projectFilePaths: [],
    hasEdits: true
  };
  const persistence = new ProjectPersistence({
    state,
    services: {
      renderNavigation() {},
      showEditorMessage() {},
      byId: () => null
    }
  });

  assert.deepEqual(persistence.getProjectFileSaveEntry(filePath), {
    path: filePath,
    create: true,
    content: "flowchart TD"
  });
  persistence.finishSuccessfulSave(
    [{ path: filePath, create: true, version: 1 }],
    { saved: [filePath] }
  );
  assert.equal(state.createdWorkflowFiles.has(filePath), false);
  assert.equal(state.dirtyFiles.has(filePath), false);
});

test("renders workflows in a Screen State-style selector", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const panel = {
    children: [],
    append(...children) { this.children.push(...children); }
  };
  const createElement = (tagName, className, textContent) => {
    const attributes = new Map();
    const listeners = new Map();
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    return {
      tagName,
      className,
      textContent,
      children: [],
      attributes,
      listeners,
      dataset: {},
      classes,
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        }
      },
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { attributes.set(name, value); },
      addEventListener(type, listener) { listeners.set(type, listener); }
    };
  };
  const workflowDeletes = [];
  const workflowOpens = [];
  const renderer = new InspectorRenderer({
    state: {
      screens: [{ id: "home", file: "screens/home/screen.yml", data: {} }],
      activeScreenIndex: 0,
      activeInstancePath: [],
      workflowSources: new Map([
        ["screens/home/workflows/add-item.mmd", "flowchart TD"],
        ["screens/other/workflows/ignored.mmd", "flowchart TD"]
      ])
    },
    services: {
      element: createElement,
      createSpecForScreen: async () => {},
      createWorkflowForScreen: async () => {},
      deleteWorkflow: async (filePath) => {
        workflowDeletes.push(filePath);
        return false;
      },
      renderWorkflowEditor: async (...args) => { workflowOpens.push(args); },
      showFatalError() {}
    }
  });

  renderer.renderSpecsWorkflowsDetails(panel, {}, null);

  const workflowsSeparator = panel.children.find((child) =>
    child.className === "section-title" && child.textContent === "Workflows"
  );
  const workflowBox = panel.children.find((child) =>
    child.className === "screen-property-box"
  );
  assert.ok(workflowsSeparator);
  assert.ok(panel.children.indexOf(workflowsSeparator) < panel.children.indexOf(workflowBox));
  assert.ok(workflowBox);
  assert.equal(workflowBox.children[0].children[0].textContent, "Workflows");
  const [createButton, deleteButton] = workflowBox.children[0].children[1].children;
  assert.equal(createButton.textContent, "Create");
  assert.equal(createButton.attributes.get("aria-label"), "Create workflow");
  assert.equal(deleteButton.textContent, "Delete");
  assert.equal(deleteButton.attributes.get("aria-label"), "Delete selected workflow");
  assert.equal(deleteButton.disabled, true);

  const workflowList = workflowBox.children[1];
  assert.equal(workflowList.className, "screen-state-list");
  assert.equal(workflowList.attributes.get("aria-label"), "Screen workflows");
  assert.equal(workflowList.children.length, 1);
  const [workflowRow] = workflowList.children;
  assert.equal(workflowRow.className, "screen-state-row workflow-selector-row");
  assert.equal(workflowRow.attributes.get("role"), "listitem");
  assert.equal(workflowRow.children[0].className, "screen-state-select");
  assert.equal(workflowRow.children[0].textContent, "add-item");
  assert.equal(workflowRow.children[0].attributes.get("aria-pressed"), "false");
  assert.equal(workflowRow.children.length, 1);

  workflowRow.children[0].listeners.get("click")();
  assert.equal(workflowRow.classes.has("selected"), true);
  assert.equal(workflowRow.children[0].attributes.get("aria-pressed"), "true");
  assert.equal(deleteButton.disabled, false);
  assert.equal(deleteButton.title, "Delete screens/home/workflows/add-item.mmd");
  assert.equal(renderer.keepScreenDetails, true);
  assert.deepEqual(workflowOpens, [[
    "screens/home/workflows/add-item.mmd",
    0
  ]]);
  deleteButton.listeners.get("click")();
  await Promise.resolve();
  assert.deepEqual(workflowDeletes, ["screens/home/workflows/add-item.mmd"]);
});
