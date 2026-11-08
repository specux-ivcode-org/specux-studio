const assert = require("node:assert/strict");
const test = require("node:test");

function createInstance(path, children = [], shadowRoot = null, bounds = null) {
  const classes = new Set(["material-instance"]);
  const styles = new Map();
  const instance = {
    children,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name))
    },
    dataset: { instancePath: JSON.stringify(path) },
    shadowRoot,
    style: {
      getPropertyValue: (name) => styles.get(name) || "",
      removeProperty: (name) => styles.delete(name),
      setProperty: (name, value) => styles.set(name, value)
    }
  };
  if (bounds) instance.getBoundingClientRect = () => bounds;
  return instance;
}

function createControl() {
  return {
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
}

function createEditorServices(preview, calls = []) {
  const elements = new Map([
    ["screen-preview", preview],
    ["spec-reference-previous", createControl()],
    ["spec-reference-next", createControl()],
    ["spec-reference-navigation", { hidden: true }],
    ["spec-reference-position", { textContent: "" }]
  ]);
  return {
    byId: (id) => elements.get(id),
    elements,
    calls
  };
}

function createHighlightNode(tagName, ownerDocument) {
  const classes = new Set();
  let textContent = "";
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    className: "",
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name)
    },
    listeners: new Map(),
    ownerDocument,
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    append(child) {
      this.children.push(child);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    set textContent(value) {
      textContent = String(value);
      this.children = [];
    },
    get textContent() {
      return this.children.length
        ? this.children.map((child) => child.textContent).join("")
        : textContent;
    }
  };
}

test("focuses an Element spec target and dims unrelated preview branches", async () => {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const selectedChild = createInstance([0, "navigation", 0, "links", 0]);
  const selected = createInstance(
    [0, "navigation", 0],
    [],
    { children: [selectedChild] },
    { left: 100, top: 100, right: 300, bottom: 300 }
  );
  const siblingDescendant = createInstance([0, "header", 0, "logo", 0]);
  const sibling = createInstance(
    [0, "header", 0],
    [],
    { children: [siblingDescendant] }
  );
  const ancestor = createInstance([0], [], { children: [selected, sibling] });
  const unrelatedDescendant = createInstance([1, "content", 0]);
  const unrelated = createInstance([1], [], { children: [unrelatedDescendant] });
  const insideSelectedArea = createInstance(
    [2],
    [],
    null,
    { left: 120, top: 120, right: 280, bottom: 280 }
  );
  const preview = { children: [ancestor, unrelated, insideSelectedArea] };
  const services = createEditorServices(preview);
  const editor = new SpecEditor({
    state: {},
    services
  });

  editor.updatePreviewFocus([0, "navigation", 0]);

  assert.equal(selected.classList.contains("spec-focus-target"), true);
  assert.equal(selected.style.getPropertyValue("filter"), "");
  assert.equal(selected.style.getPropertyValue("z-index"), "1");
  assert.equal(selectedChild.classList.contains("spec-focus-descendant"), true);
  assert.equal(selectedChild.style.getPropertyValue("filter"), "");
  assert.equal(ancestor.classList.contains("spec-focus-ancestor"), true);
  assert.equal(ancestor.style.getPropertyValue("filter"), "");
  assert.equal(sibling.style.getPropertyValue("filter"), "blur(1.5px)");
  assert.equal(siblingDescendant.style.getPropertyValue("filter"), "");
  assert.equal(siblingDescendant.classList.contains("spec-focus-dimmed"), false);
  assert.equal(unrelated.style.getPropertyValue("filter"), "blur(1.5px)");
  assert.equal(unrelatedDescendant.style.getPropertyValue("filter"), "");
  assert.equal(insideSelectedArea.classList.contains("spec-focus-dimmed"), false);
  assert.equal(insideSelectedArea.style.getPropertyValue("filter"), "");

  editor.updatePreviewFocus(null);

  assert.equal(selected.classList.contains("spec-focus-target"), false);
  assert.equal(selectedChild.classList.contains("spec-focus-descendant"), false);
  assert.equal(selected.style.getPropertyValue("z-index"), "");
  assert.equal(sibling.classList.contains("spec-focus-dimmed"), false);
  assert.equal(sibling.style.getPropertyValue("filter"), "");
  assert.equal(unrelated.style.getPropertyValue("filter"), "");
  assert.equal(insideSelectedArea.style.getPropertyValue("filter"), "");
});

test("highlights the selected Spec link and its section in the source overlay", async () => {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const filePath = "screens/home/specs/home.md";
  const source = [
    "# Home behavior",
    "[Home link](specux://screen/home/screen.yml)",
    "",
    "## Save flow",
    "The action is described below.",
    "### Save item",
    "The button saves the item.",
    "[Save](specux://screen/home/screen.yml?placement=save-button)",
    "#### Details",
    "Additional details.",
    "### Cancel item",
    "This sibling section is not part of Save item.",
    "# Other behavior",
    "Outside the Home behavior section.",
    ""
  ].join("\n");
  let ownerDocument;
  ownerDocument = {
    createElement: (tagName) => createHighlightNode(tagName, ownerDocument)
  };
  const highlight = createHighlightNode("pre", ownerDocument);
  const sourceEditorListeners = new Map();
  const sourceEditor = {
    scrollLeft: 0,
    scrollTop: 0,
    addEventListener(type, listener) {
      sourceEditorListeners.set(type, listener);
    }
  };
  const sourceContainer = {};
  const services = createEditorServices({ children: [] });
  services.elements.set("spec-source", sourceEditor);
  services.elements.set("spec-source-container", sourceContainer);
  services.elements.set("spec-source-highlight", highlight);
  const editor = new SpecEditor({
    state: {
      activeSpecPath: filePath,
      specSources: new Map([[filePath, source]])
    },
    services
  });

  editor.renderSourceHighlight({
    lineIndex: 1,
    columnIndex: 0,
    sectionLineIndex: 0
  });
  assert.equal(highlight.children[0].classList.contains("workflow-spec-section-target"), true);
  assert.equal(highlight.children[10].classList.contains("workflow-spec-section-target"), true);
  assert.equal(highlight.children[12].classList.contains("workflow-spec-section-target"), false);
  assert.equal(highlight.children[1].children[1].className, "workflow-spec-link-target");
  editor.renderSourceHighlight({
    lineIndex: 7,
    columnIndex: 0,
    sectionLineIndex: 5
  });
  assert.equal(highlight.children[6].classList.contains("workflow-spec-section-target"), true);
  assert.equal(highlight.children[9].classList.contains("workflow-spec-section-target"), true);
  assert.equal(highlight.children[10].classList.contains("workflow-spec-section-target"), false);
  assert.equal(highlight.children[7].children[1].className, "workflow-spec-link-target");
  assert.equal(
    highlight.children[7].children[1].textContent,
    "[Save](specux://screen/home/screen.yml?placement=save-button)"
  );
  sourceEditor.scrollTop = 42;
  sourceEditor.scrollLeft = 18;
  sourceEditorListeners.get("scroll")();
  assert.equal(highlight.scrollTop, 42);
  assert.equal(highlight.scrollLeft, 18);
});

test("keeps selected source text visibly highlighted when the editor loses focus", async () => {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const filePath = "screens/home/specs/home.md";
  const source = "# Home behavior\r\nSelected text remains visible.\r\n";
  const editorValue = source.replace(/\r\n/g, "\n");
  const selectionStart = editorValue.indexOf("text");
  const selectionEnd = selectionStart + "text remains".length;
  let ownerDocument;
  ownerDocument = {
    activeElement: null,
    createElement: (tagName) => createHighlightNode(tagName, ownerDocument)
  };
  const highlight = createHighlightNode("pre", ownerDocument);
  const highlightListeners = highlight.listeners;
  const sourceEditorListeners = new Map();
  const sourceEditor = {
    value: editorValue,
    selectionStart,
    selectionEnd,
    scrollTop: 42,
    scrollLeft: 18,
    addEventListener(type, listener) {
      sourceEditorListeners.set(type, listener);
    }
  };
  const services = createEditorServices({ children: [] });
  let published = 0;
  services.document = ownerDocument;
  services.publishSelection = () => { published += 1; };
  services.elements.set("spec-source", sourceEditor);
  services.elements.set("spec-source-container", {});
  services.elements.set("spec-source-highlight", highlight);
  const editor = new SpecEditor({
    state: {
      viewingSpec: true,
      activeSpecPath: filePath,
      specSources: new Map([[filePath, source]])
    },
    services
  });

  sourceEditorListeners.get("scroll")();
  assert.equal(highlight.scrollTop, 42);
  assert.equal(highlight.scrollLeft, 18);
  highlight.scrollTop = 64;
  highlight.scrollLeft = 24;
  highlightListeners.get("scroll")();
  assert.equal(sourceEditor.scrollTop, 64);
  assert.equal(sourceEditor.scrollLeft, 24);
  sourceEditorListeners.get("blur")();

  const selectedText = highlight.children[1].children.find((child) =>
    child.className.includes("spec-source-text-selection")
  );
  assert.equal(selectedText.textContent, "text remains");
  assert.equal(highlight.scrollTop, 64);
  assert.equal(highlight.scrollLeft, 24);
  assert.equal(published, 1);
});

test("keeps all descendants clear when a container Element is focused", async () => {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const nestedChild = createInstance([0, "navigation", 0]);
  const nestedGrandchild = createInstance([0, "navigation", 0, "links", 0]);
  const selectedContainer = createInstance(
    [0],
    [],
    { children: [nestedChild, nestedGrandchild] }
  );
  const unrelated = createInstance([1]);
  const preview = { children: [selectedContainer, unrelated] };
  const services = createEditorServices(preview);
  const editor = new SpecEditor({
    state: {},
    services
  });

  editor.updatePreviewFocus([0]);

  assert.equal(selectedContainer.classList.contains("spec-focus-target"), true);
  assert.equal(nestedChild.classList.contains("spec-focus-descendant"), true);
  assert.equal(nestedChild.style.getPropertyValue("filter"), "");
  assert.equal(nestedGrandchild.classList.contains("spec-focus-descendant"), true);
  assert.equal(nestedGrandchild.style.getPropertyValue("filter"), "");
  assert.equal(unrelated.style.getPropertyValue("filter"), "blur(1.5px)");
});

test("navigates Screen and workflow links with a wrapping up/down selector", async () => {
  const { SpecEditor } = await import("../frontend/browser/SpecEditor.mjs");
  const preview = { children: [] };
  const calls = [];
  const workflowCalls = [];
  const services = createEditorServices(preview, calls);
  services.validation = require("../shared/validation");
  services.clearSpecWorkflowPreview = () => {};
  services.showSpecReference = async (reference) => {
    calls.push(reference?.href || null);
    return [];
  };
  services.showSpecWorkflowReference = async (reference) => workflowCalls.push(reference);
  services.selectInstanceInPreview = () => {};
  const filePath = "screens/home/specs/screen.md";
  const source = [
    "# Home behavior",
    "[Home](specux://screen/home/screen.yml)",
    "[Dialog](specux://screen/home/screen.yml?state=dialog-open)",
    "[Button](specux://screen/home/screen.yml?placement=continue-button&state=dialog-open)",
    "[Workflow](specux://screen/home/workflows/home.mmd?node=save)"
  ].join("\n");
  const editor = new SpecEditor({
    state: { viewingSpec: true, activeSpecPath: filePath },
    services
  });

  await editor.setPreviewReferences(filePath, source, true);
  assert.equal(services.elements.get("spec-reference-position").textContent, "1 of 4");
  assert.equal(services.elements.get("spec-reference-previous").disabled, false);
  assert.equal(calls.at(-1), "specux://screen/home/screen.yml");

  editor.movePreviewReference(1);
  await editor.previewQueue;
  assert.equal(services.elements.get("spec-reference-position").textContent, "2 of 4");
  assert.equal(calls.at(-1), "specux://screen/home/screen.yml?state=dialog-open");

  editor.movePreviewReference(1);
  await editor.previewQueue;
  assert.equal(services.elements.get("spec-reference-position").textContent, "3 of 4");
  assert.equal(calls.at(-1),
    "specux://screen/home/screen.yml?placement=continue-button&state=dialog-open");

  editor.movePreviewReference(-1);
  await editor.previewQueue;
  assert.equal(services.elements.get("spec-reference-position").textContent, "2 of 4");

  editor.movePreviewReference(-1);
  await editor.previewQueue;
  assert.equal(services.elements.get("spec-reference-position").textContent, "1 of 4");

  editor.movePreviewReference(-1);
  await editor.previewQueue;
  assert.equal(services.elements.get("spec-reference-position").textContent, "4 of 4");
  assert.deepEqual(workflowCalls.at(-1), {
    workflowPath: "screens/home/workflows/home.mmd",
    nodeId: "save",
    lineIndex: 4,
    columnIndex: 0,
    sectionLineIndex: 0,
    kind: "workflow"
  });

  await editor.setPreviewReferences(
    filePath,
    "[Only link](specux://screen/home/screen.yml)",
    true
  );
  assert.equal(services.elements.get("spec-reference-navigation").hidden, false);
  assert.equal(services.elements.get("spec-reference-position").textContent, "1 of 1");
  assert.equal(services.elements.get("spec-reference-previous").disabled, true);
  assert.equal(services.elements.get("spec-reference-next").disabled, true);
});
