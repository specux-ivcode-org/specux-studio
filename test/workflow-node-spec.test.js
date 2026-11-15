const assert = require("node:assert/strict");
const test = require("node:test");
const validation = require("../shared/validation");

const workflowPath = "screens/home/workflows/add-item.mmd";
const nodeSpecPath = "screens/home/specs/workflow-add-item-saveItem.md";

/** Creates the collaborators used to exercise contextual Workflow node specs. */
async function createSpecEditor({ specSources = new Map(), fetchStatus = 404 } = {}) {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const shown = [];
  const expanded = [];
  let fetchCount = 0;
  const state = {
    viewingWorkflow: true,
    activeWorkflowPath: workflowPath,
    workflowSources: new Map([[workflowPath, "flowchart TD\n  saveItem[Save item]"]]),
    screens: [{ id: "home", file: "screens/home/screen.yml", data: {} }],
    activeScreenIndex: 0,
    specSources,
    createdSpecDrafts: new Map(),
    createdSpecFiles: new Set(),
    elementSpecOwners: new Map()
  };
  const services = {
    validation,
    byId: () => ({ addEventListener() {} }),
    fetcher: async () => {
      fetchCount += 1;
      return { status: fetchStatus, ok: fetchStatus >= 200 && fetchStatus < 300 };
    },
    safeProjectUrl: (filePath) => filePath,
    loadText: async () => {
      throw new Error("Unexpected request to load an existing spec.");
    },
    projectFileTree: { expandPath: (filePath) => expanded.push(filePath) },
    renderNavigation() {},
    showWorkflowNodeSpec: (spec, nodeId) => shown.push({ spec, nodeId })
  };
  return {
    editor: new SpecEditor({ state, services }),
    state,
    shown,
    expanded,
    get fetchCount() { return fetchCount; }
  };
}

test("validates deterministic Workflow node spec paths", () => {
  assert.equal(
    validation.getWorkflowNodeSpecPath("home", workflowPath, "saveItem"),
    nodeSpecPath
  );
  assert.equal(validation.validateWorkflowNodeSpecPath(
    nodeSpecPath,
    "home",
    workflowPath,
    "saveItem"
  ), undefined);
  assert.throws(
    () => validation.getWorkflowNodeSpecPath("home", workflowPath, "../saveItem"),
    /identity is invalid/
  );
  assert.throws(
    () => validation.validateWorkflowNodeSpecPath(
      "screens/home/specs/workflow-add-item-other.md",
      "home",
      workflowPath,
      "saveItem"
    ),
    /must be named/
  );
});

test("builds a main-editor context for a Workflow node spec", async () => {
  const harness = await createSpecEditor();
  await harness.editor.createForWorkflowNode(workflowPath, "saveItem");

  const context = harness.editor.getSpecRenderContext(
    nodeSpecPath,
    [],
    "workflow-node",
    { workflowPath, nodeId: "saveItem" }
  );

  assert.equal(context.owner, "workflow-node");
  assert.equal(context.isWorkflowNodeSpec, true);
  assert.equal(context.screen.id, "home");
  assert.equal(context.workflowPath, workflowPath);
  assert.equal(context.nodeId, "saveItem");
});

test("mounts the editable node spec source inside the main Screen preview", async () => {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const createElement = (tagName) => ({
    tagName,
    children: [],
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    listeners: {},
    append(...children) { this.children.push(...children); }
  });
  const sourceEditor = {
    setAttribute() {},
    focus() { this.focused = true; }
  };
  const sourceContainer = createElement("div");
  const preview = createElement("article");
  preview.ownerDocument = { createElement };
  preview.classList = { add: (value) => preview.classes.add(value) };
  preview.classes = new Set();
  preview.replaceChildren = (...children) => { preview.children = children; };
  const specPanel = { hidden: false, append(child) { this.child = child; } };
  const mainClasses = new Set();
  const main = { classList: { add: (value) => mainClasses.add(value) } };
  const screenStage = { setAttribute() {} };
  let returnCount = 0;
  const elements = new Map([
    ["main", main],
    ["screen-preview", preview],
    ["spec-source-container", sourceContainer],
    ["spec-source", sourceEditor],
    ["spec-editor-panel", specPanel],
    ["screen-stage", screenStage]
  ]);
  const source = "# Save item behavior\n";
  const state = {
    specSources: new Map([[nodeSpecPath, source]]),
    activeSpecPath: null,
    activeSpecScreenFile: null,
    activeSpecOwner: "instance",
    activeSpecWorkflowPath: null,
    activeSpecWorkflowNodeId: null,
    activeSpecInstancePath: [],
    viewingSpec: false
  };
  const editor = Object.create(SpecEditor.prototype);
  editor.state = state;
  editor.services = {
    validation,
    byId: (id) => elements.get(id),
    hideEditorMessage() {},
    returnToWorkflowAfterSpec: async () => { returnCount += 1; }
  };
  editor.getSpecRenderContext = (filePath, instancePath, owner, workflowContext) => ({
    filePath,
    screen: { file: "screens/home/screen.yml" },
    instancePath,
    owner,
    workflowPath: workflowContext.workflowPath,
    nodeId: workflowContext.nodeId
  });
  editor.renderSpecSource = () => { sourceEditor.value = source; };
  editor.renderSourceHighlight = () => {};

  await editor.renderWorkflowNodeSpecInMainView(nodeSpecPath, workflowPath, "saveItem");

  assert.equal(preview.children[0].className, "workflow-node-spec-main-editor");
  const header = preview.children[0].children[0];
  assert.equal(header.className, "workflow-node-spec-main-header");
  assert.equal(header.children[0].className, "workflow-node-spec-main-heading");
  assert.equal(header.children[1].textContent, "×");
  await header.children[1].listeners.click();
  assert.equal(returnCount, 1);
  assert.equal(preview.children[0].children[1], sourceContainer);
  assert.equal(preview.classes.has("workflow-node-spec-main-active"), true);
  assert.equal(mainClasses.has("workflow-node-spec-main-active"), true);
  assert.equal(specPanel.hidden, true);
  assert.equal(sourceEditor.focused, true);
  assert.equal(state.activeSpecOwner, "workflow-node");
  assert.equal(state.activeSpecWorkflowPath, workflowPath);
  assert.equal(state.activeSpecWorkflowNodeId, "saveItem");
  assert.equal(state.viewingSpec, false);
});

test("double-click creates a separate node spec and reopens its existing draft", async () => {
  const harness = await createSpecEditor();
  const createdPath = await harness.editor.createForWorkflowNode(workflowPath, "saveItem");
  assert.equal(createdPath, nodeSpecPath);
  assert.equal(harness.state.viewingWorkflow, true);
  assert.equal(harness.state.specSources.has(nodeSpecPath), true);
  assert.equal(harness.state.createdSpecFiles.has(nodeSpecPath), true);
  assert.equal(harness.state.createdSpecDrafts.get(nodeSpecPath).owner, "workflow-node");
  assert.match(
    harness.state.specSources.get(nodeSpecPath),
    /\[Workflow node\]\(specux:\/\/screen\/home\/workflows\/add-item\.mmd\?node=saveItem\)/
  );
  assert.deepEqual(harness.shown[0], {
    spec: {
      filePath: nodeSpecPath,
      source: harness.state.specSources.get(nodeSpecPath),
      references: [{
        nodeId: "saveItem",
        lineIndex: 2,
        columnIndex: 0,
        sectionLineIndex: 0
      }]
    },
    nodeId: "saveItem"
  });
  await harness.editor.createForWorkflowNode(workflowPath, "saveItem");
  assert.equal(harness.shown.length, 2);
  assert.equal(harness.fetchCount, 1);
  assert.deepEqual(harness.expanded, [nodeSpecPath]);
});

test("reopens a loaded node spec and rejects an unlinked file at its reserved path", async () => {
  const existingSource = [
    "# Save item",
    "",
    "[Workflow node](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
  ].join("\n");
  const existing = await createSpecEditor({
    specSources: new Map([[nodeSpecPath, existingSource]])
  });
  assert.equal(await existing.editor.createForWorkflowNode(workflowPath, "saveItem"), nodeSpecPath);
  assert.equal(existing.fetchCount, 0);
  assert.equal(existing.shown[0].spec.source, existingSource);

  const unlinked = await createSpecEditor({
    specSources: new Map([[nodeSpecPath, "# Preserved documentation\n"]])
  });
  await assert.rejects(
    unlinked.editor.createForWorkflowNode(workflowPath, "saveItem"),
    /is not linked to Workflow node/
  );
  assert.equal(unlinked.state.specSources.get(nodeSpecPath), "# Preserved documentation\n");
});

test("Workflow-mode node double-click opens the node spec without changing mode", async () => {
  const { WorkflowEditor } = await import("../frontend/browser/WorkflowEditor.mjs");
  const listeners = new Map();
  const opened = [];
  const editor = Object.create(WorkflowEditor.prototype);
  editor.state = {
    viewingWorkflow: true,
    viewingSpec: false,
    activeWorkflowPath: workflowPath
  };
  editor.services = {
    openWorkflowNodeSpec: async (...args) => opened.push(args)
  };
  const node = {
    classList: { add() {}, toggle() {} },
    setAttribute() {},
    addEventListener: (name, handler) => listeners.set(name, handler)
  };
  editor.configureLinkedWorkflowNode(node, "saveItem", null, null, []);
  let prevented = false;
  let stopped = false;
  listeners.get("dblclick")({
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
  });
  await Promise.resolve();
  assert.deepEqual(opened, [[workflowPath, "saveItem"]]);
  assert.equal(editor.state.viewingWorkflow, true);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test("Spec-linked Workflow renders read-only in the dock without hiding the Screen", async () => {
  const { WorkflowEditor } = await import("../frontend/browser/WorkflowEditor.mjs");
  const classes = new Set();
  const main = {
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    }
  };
  const node = {
    getAttribute: (name) => name === "data-id" ? "saveItem" : null,
    classList: { add() {} }
  };
  const diagram = {
    hidden: true,
    innerHTML: "",
    setAttribute() {},
    querySelectorAll: () => [node],
    replaceChildren() {}
  };
  const panelClasses = new Set();
  const panel = {
    hidden: true,
    classList: {
      add: (value) => panelClasses.add(value),
      remove: (value) => panelClasses.delete(value)
    }
  };
  const elements = new Map([
    ["main", main],
    ["workflow-editor-panel", panel],
    ["workflow-diagram", diagram],
    ["workflow-node-spec-preview", { hidden: true, replaceChildren() {} }],
    ["workflow-source", { hidden: false }],
    ["workflow-linked-back", { hidden: true }],
    ["workflow-editor-heading", { textContent: "" }],
    ["spec-editor-panel", { hidden: false }]
  ]);
  const editor = Object.create(WorkflowEditor.prototype);
  editor.state = {
    viewingSpec: true,
    viewingWorkflow: false,
    workflowSources: new Map([[workflowPath, "flowchart TD\n  saveItem[Save item]"]])
  };
  editor.services = { byId: (id) => elements.get(id) };
  editor.diagramId = 0;
  editor.specPreviewVersion = 0;
  editor.getMermaid = async () => ({
    parse: async () => {},
    render: async () => ({ svg: "<svg></svg>" })
  });
  editor.setNodeSelectionHighlight = () => {};
  editor.scrollSpecPreviewNodeIntoView = () => {};

  await editor.showLinkedWorkflowPreview(
    { workflowPath, nodeId: "saveItem" },
    "screens/home/specs/screen.md"
  );
  assert.equal(classes.has("spec-linked-workflow-active"), true);
  assert.equal(panel.hidden, false);
  assert.equal(elements.get("spec-editor-panel").hidden, true);
  assert.equal(diagram.hidden, false);
  assert.equal(diagram.innerHTML, "<svg></svg>");
  assert.equal(editor.state.viewingSpec, true);
  assert.equal(editor.state.viewingWorkflow, false);

  editor.clearLinkedWorkflowPreview();
  assert.equal(classes.has("spec-linked-workflow-active"), false);
  assert.equal(panel.hidden, true);
  assert.equal(elements.get("spec-editor-panel").hidden, false);
});

test("closing a Workflow node spec returns to the graph in Workflow mode", async () => {
  const { WorkflowEditor } = await import("../frontend/browser/WorkflowEditor.mjs");
  const panelClasses = new Set(["workflow-node-spec-active"]);
  const diagram = { hidden: true };
  const source = { hidden: true };
  const back = { hidden: false };
  const panel = {
    classList: { remove: (value) => panelClasses.delete(value) }
  };
  const preview = { hidden: false, replaceChildren() {} };
  const sectionNavigation = { hidden: false };
  const sectionPosition = { textContent: "" };
  const editor = Object.create(WorkflowEditor.prototype);
  editor.state = { viewingWorkflow: true };
  editor.activeSpecPreview = { navigation: [] };
  editor.nodeSpecPreviousPanel = { diagramHidden: false, sourceHidden: true };
  editor.services = {
    byId: (id) => ({
      "workflow-editor-panel": panel,
      "workflow-diagram": diagram,
      "workflow-source": source,
      "workflow-linked-back": back,
      "workflow-node-spec-preview": preview,
      "workflow-spec-section-navigation": sectionNavigation,
      "workflow-spec-section-position": sectionPosition,
      "workflow-spec-file-select": { hidden: false },
      "workflow-spec-section-previous": { disabled: false },
      "workflow-spec-section-next": { disabled: false }
    })[id]
  };

  assert.equal(editor.closeWorkflowNodeSpecPreview(), true);
  assert.equal(editor.activeSpecPreview, null);
  assert.equal(panelClasses.has("workflow-node-spec-active"), false);
  assert.equal(diagram.hidden, false);
  assert.equal(source.hidden, true);
  assert.equal(back.hidden, true);
  assert.equal(preview.hidden, true);
  assert.equal(editor.state.viewingWorkflow, true);
});
