const assert = require("node:assert/strict");
const test = require("node:test");
const validation = require("../shared/validation");

/** Checks the accepted and rejected data shapes and their validation results. */
test("validates Screen-scoped Mermaid workflow paths", () => {
  assert.equal(
    validation.validateWorkflowPath("screens/home/workflows/add-item.mmd"),
    "screens/home/workflows/add-item.mmd"
  );
  for (const filePath of [
    "workflows/add-item.mmd",
    "screens/Home/workflows/add-item.mmd",
    "screens/home/workflows/Add-Item.mmd",
    "screens/home/workflows/add-item.md",
    "screens/home/workflows/nested/add-item.mmd"
  ]) {
    assert.throws(() => validation.validateWorkflowPath(filePath), /Workflow path must be/);
  }
});

test("preserves and reports specs whose Workflow nodes were removed", async () => {
  const { WorkflowEditor } = await import("../frontend/browser/WorkflowEditor.mjs");
  const statusClasses = new Set();
  const status = {
    textContent: "",
    classList: {
      add: (name) => statusClasses.add(name),
      remove: (name) => statusClasses.delete(name)
    }
  };
  const editor = Object.create(WorkflowEditor.prototype);
  editor.entryPointWarnings = [];
  editor.workflowTargetWarning = null;
  editor.services = { byId: () => status };

  editor.validateLinkedWorkflowNodes(
    "flowchart TD\n  start[Start]",
    "screens/home/workflows/add-item.mmd",
    new Set(["start"]),
    new Map(),
    new Map([["saveItem", [{ filePath: "screens/home/specs/workflow-add-item-saveItem.md" }]]])
  );

  assert.match(status.textContent, /preserved as unlinked documentation/);
  assert.equal(statusClasses.has("warning"), true);
});

/** The workflow inspector shows placement details without exposing editing controls. */
test("workflow inspector exposes read-only placement context", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const panel = {
    children: [],
    parentElement: { classList: { toggle() {} } },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    querySelector() { return null; }
  };

  /** Creates a DOM element with the supplied content and attributes. */
  const createElement = (tagName, className, textContent) => ({
    tagName,
    className,
    textContent,
    children: [],
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    addEventListener() {},
    querySelector() { return null; }
  });
  const renderer = new InspectorRenderer({
    state: {
      viewingWorkflow: true,
      screens: [{ data: { id: "home", name: "Home" } }],
      activeScreenIndex: 0,
      activeInstancePath: [0]
    },
    services: {
      byId: () => panel,
      element: createElement,
      getInstanceAtPath: (_screen, path) =>
        path[0] === 0 ? { id: "save-button" } : null
    }
  });

  renderer.render();

  const rendered = panel.children.flatMap((child) => [
    child,
    ...(child.children || [])
  ]);
  assert.ok(rendered.some((node) => node.textContent === "This Screen preview is read-only. It shows the Screen linked from the selected Workflow node."));
  assert.ok(rendered.some((node) => node.textContent === "save-button"));
  assert.equal(rendered.some((node) => node.tagName === "button" || node.tagName === "input"), false);
});

/** Workflow URLs are decoded into the linked Screen, workflow, and optional node context. */
test("parses explicit SpecUX workflow links", async () => {
  const {
    WorkflowEditor,
    collectWorkflowSpecLinks,
    parseWorkflowClickDirectives,
    parseWorkflowLink,
    parseWorkflowSpecReference,
    parseWorkflowSpecReferences
  } = await import(
    "../frontend/browser/WorkflowEditor.mjs"
  );
  const workflowPath = "screens/home/workflows/add-item.mmd";
  assert.deepEqual(parseWorkflowLink("specux://screen/home/screen.yml"), {
    screenId: "home",
    placementIds: [],
    stateId: "default"
  });
  assert.deepEqual(
    parseWorkflowLink(
      "specux://screen/home/screen.yml?placement=dialog-save&state=add-item-open"
    ),
    {
      screenId: "home",
      placementIds: ["dialog-save"],
      stateId: "add-item-open"
    }
  );
  assert.deepEqual(
    parseWorkflowLink(
      "specux://screen/home/screen.yml?placement=dialog.actions.save"
    ),
    {
      screenId: "home",
      placementIds: ["dialog.actions.save"],
      stateId: "default"
    }
  );
  assert.deepEqual(
    parseWorkflowSpecReference(
      "specux://screen/home/workflows/add-item.mmd?node=saveItem",
      workflowPath
    ),
    { nodeId: "saveItem" }
  );
  assert.deepEqual(
    parseWorkflowSpecReference(
      "specux://screen/home/workflows/add-item.mmd?node=saveItem"
    ),
    { workflowPath, nodeId: "saveItem" }
  );
  assert.equal(
    parseWorkflowSpecReference(
      "specux://screen/home/screen.yml?placement=dialog-save",
      workflowPath
    ),
    null
  );
  const parsed = parseWorkflowClickDirectives([
    "flowchart TD",
    "saveItem[Save item]",
    'click saveItem href "specux://screen/home/screen.yml?placement=dialog-save&state=add-item-open"',
    ""
  ].join("\n"));
  assert.equal(parsed.diagramSource, "flowchart TD\nsaveItem[Save item]\n");
  assert.deepEqual(parsed.links.get("saveItem"), {
    screenId: "home",
    placementIds: ["dialog-save"],
    stateId: "add-item-open"
  });
  assert.deepEqual(
    parseWorkflowLink(
      "specux://screen/home/screen.yml?placement=dialog.title&placement=dialog.actions.save&state=add-item-open"
    ),
    {
      screenId: "home",
      placementIds: ["dialog.title", "dialog.actions.save"],
      stateId: "add-item-open"
    }
  );
  const specSource = [
    "# Home behavior",
    "",
    "## Purpose",
    "Purpose text.",
    "",
    "### Requirement: Save an item",
    "#### Scenario: Item is saved",
    "[Save item flow](specux://screen/home/workflows/add-item.mmd?node=saveItem)",
    "",
    "#### Scenario: Item is not saved",
    "[Retry flow](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
  ].join("\n");
  assert.deepEqual(parseWorkflowSpecReferences(specSource, workflowPath), [
    { nodeId: "saveItem", lineIndex: 7, columnIndex: 0, sectionLineIndex: 6 },
    { nodeId: "saveItem", lineIndex: 10, columnIndex: 0, sectionLineIndex: 9 }
  ]);
  assert.deepEqual(
    parseWorkflowSpecReferences([
      "## Link examples",
      "```md",
      "[Example](specux://screen/home/workflows/add-item.mmd?node=saveItem)",
      "```",
      "[Actual link](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
    ].join("\n"), workflowPath),
    [{ nodeId: "saveItem", lineIndex: 4, columnIndex: 0, sectionLineIndex: 0 }]
  );
  assert.deepEqual(
    parseWorkflowSpecReferences(
      "[Save item](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
    ),
    [{
      workflowPath,
      nodeId: "saveItem",
      lineIndex: 0,
      columnIndex: 0,
      sectionLineIndex: 0
    }]
  );
  const specLinks = collectWorkflowSpecLinks([{
    filePath: "screens/home/specs/screen.md",
    source: specSource
  }, {
    filePath: "screens/home/specs/add-item.md",
    source: "[Save item details](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
  }], workflowPath);
  assert.equal(specLinks.get("saveItem")[0].references.length, 2);
  assert.equal(specLinks.get("saveItem").length, 2);
  assert.equal(specLinks.get("saveItem")[1].filePath, "screens/home/specs/add-item.md");
  assert.throws(
    () => parseWorkflowLink("specux://screen/Home/screen.yml"),
    /Workflow link path must be/
  );
  assert.throws(() =>
    parseWorkflowLink("specux://screen/home/screen.yml?state=not-a-state&other=value"),
    /repeated placements and one state query parameter/
  );
  const duplicateLinks = parseWorkflowClickDirectives([
      'click saveItem href "specux://screen/home/screen.yml"',
      'click saveItem href "specux://screen/home/screen.yml?placement=about"'
    ].join("\n"));
  assert.equal(duplicateLinks.links.has("saveItem"), false);
  assert.match(duplicateLinks.warnings.get("saveItem"), /more than one SpecUX click directive/);
  const invalidTarget = parseWorkflowClickDirectives(
    'click saveItem href "specux://screen/home/screen.yml?state=not-a-state&extra=value"'
  );
  assert.equal(invalidTarget.links.has("saveItem"), false);
  assert.match(invalidTarget.warnings.get("saveItem"), /repeated placements and one state/);
  const incompatibleStates = parseWorkflowClickDirectives(
    'click saveItem href "specux://screen/home/screen.yml?placement=save&state=default&state=edit"'
  );
  assert.equal(incompatibleStates.links.has("saveItem"), false);
  assert.match(incompatibleStates.warnings.get("saveItem"), /one state query parameter/);
  const noopElement = { addEventListener() {} };
  const editor = new WorkflowEditor({
    state: {},
    services: { byId: () => noopElement }
  });

  /** Checks that the preview output reflects the supplied project and selection data. */
  test("renders a workflow node referenced from a behavior spec", async () => {
    const { WorkflowEditor } = await import("../frontend/browser/WorkflowEditor.mjs");
    const classes = new Set();
    const main = {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        }
      }
    };
    const heading = { textContent: "Preview" };
    const attributes = new Map();
    const nodeClasses = new Set();
    const insetShapes = [];
    let nodeBounds = {
      left: 180, right: 220, top: 220, bottom: 240, width: 40, height: 20
    };
    const basicShape = {
      getBBox: () => ({ x: -76, y: -22.5, width: 152, height: 45 }),
      getAttribute: () => null,
      cloneNode: () => ({
        attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        remove() { this.removed = true; }
      })
    };
    const node = {
      id: "",
      getAttribute: () => null,
      classList: { add: (name) => nodeClasses.add(name) },
      querySelector: (selector) => selector === ".basic" ? basicShape : null,
      querySelectorAll: (selector) =>
        selector === ".workflow-node-focus-inset" ? insetShapes : [],
      appendChild(shape) { insetShapes.push(shape); },
      getBoundingClientRect: () => nodeBounds
    };
    const preview = {
      hidden: true,
      innerHTML: "",
      clientWidth: 100,
      clientHeight: 100,
      clientLeft: 0,
      clientTop: 0,
      scrollLeft: 0,
      scrollTop: 0,
      getBoundingClientRect: () => ({
        left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100
      }),
      scrollTo(options) { this.scrollOptions = options; },
      setAttribute: (name, value) => attributes.set(name, value),
      querySelectorAll: () => [node],
      replaceChildren() { this.innerHTML = ""; }
    };
    const noopControl = { addEventListener() {} };
    const elements = new Map([
      ["main", main],
      ["spec-view-heading", heading],
      ["spec-workflow-preview", preview],
      ["workflow-spec-preview", { hidden: true }],
      ["workflow-panel-diagram", noopControl],
      ["workflow-panel-source", noopControl],
      ["workflow-view-split", noopControl],
      ["workflow-view-diagram", noopControl],
      ["workflow-spec-section-previous", noopControl],
      ["workflow-spec-section-next", noopControl],
      ["workflow-linked-back", { ...noopControl, hidden: true }],
      ["workflow-mode-exit", noopControl],
      ["workflow-spec-file-select", noopControl],
      ["workflow-diagram", { querySelectorAll: () => [], replaceChildren() {} }],
      ["workflow-node-spec-preview", {
        hidden: true,
        replaceChildren() {},
        ownerDocument: { createElement: () => ({}) }
      }],
      ["workflow-spec-section-navigation", { hidden: false }],
      ["workflow-spec-section-position", { textContent: "1 of 1" }],
      ["workflow-editor-panel", {
        hidden: false,
        classList: { add() {}, remove() {} }
      }],
      ["spec-editor-panel", { hidden: false }],
      ["workflow-source", { oninput() {}, hidden: false }]
    ]);
    const workflowPath = "screens/home/workflows/add-item.mmd";
    const editor = new WorkflowEditor({
      state: {
        viewingSpec: true,
        workflowSources: new Map([[workflowPath, "flowchart TD\nsaveItem[Save item]\n"]])
      },
      services: { byId: (id) => elements.get(id) }
    });
    editor.mermaidPromise = Promise.resolve({
      parse: async () => {},
      render: async (id) => {
        node.id = `${id}-flowchart-saveItem-0`;
        return { svg: "<svg></svg>" };
      }
    });

    await editor.showSpecReferencePreview({
      workflowPath,
      nodeId: "saveItem"
    }, "screens/home/specs/screen.md");

    assert.equal(preview.hidden, false);
    assert.equal(nodeClasses.has("selected"), true);
    assert.equal(insetShapes.length, 1);
    assert.equal(
      insetShapes[0].attributes.get("class"),
      "workflow-node-focus-inset"
    );
    assert.match(insetShapes[0].attributes.get("transform"), /scale\(0\./);
    assert.equal(insetShapes[0].attributes.get("pointer-events"), "none");
    assert.equal(classes.has("spec-workflow-preview-active"), true);
    assert.equal(heading.textContent, `Workflow: ${workflowPath}`);
    assert.match(attributes.get("aria-label"), /focused on node "saveItem"/);
    assert.deepEqual(preview.scrollOptions, {
      left: 150,
      top: 180,
      behavior: "smooth"
    });
    preview.scrollOptions = null;
    nodeBounds = { left: 10, right: 50, top: 10, bottom: 30, width: 40, height: 20 };
    editor.scrollSpecPreviewNodeIntoView(preview, node);
    assert.deepEqual(preview.scrollOptions, {
      left: -20,
      top: -30,
      behavior: "smooth"
    });

    editor.setNodeSelectionHighlight(node, false);
    assert.equal(insetShapes.every((shape) => shape.removed), true);
    editor.clearSpecReferencePreview();
    assert.equal(preview.hidden, true);
    assert.equal(preview.innerHTML, "");
    assert.equal(classes.has("spec-workflow-preview-active"), false);
    assert.equal(heading.textContent, "Preview");

    classes.add("spec-workflow-preview-active");
    preview.hidden = false;
    preview.innerHTML = "<svg></svg>";
    heading.textContent = `Workflow: ${workflowPath}`;
    editor.deactivate();
    assert.equal(preview.hidden, true);
    assert.equal(preview.innerHTML, "");
    assert.equal(classes.has("spec-workflow-preview-active"), false);
    assert.equal(heading.textContent, "Preview");
    assert.equal(elements.get("workflow-editor-panel").hidden, true);
    assert.equal(elements.get("workflow-source").oninput, null);
  });
  editor.diagramId = 3;
  assert.equal(editor.getNodeId({
    getAttribute: () => null,
    id: "specux-workflow-3-flowchart-saveItem-0"
  }), "saveItem");
  assert.equal(editor.getNodeId({
    getAttribute: () => null,
    id: "specux-workflow-3-flowchart-node-flowchart-inner-0"
  }), "node-flowchart-inner");

  const specLinkElements = [];
  const specLinkDocument = {
    createElementNS(namespace, tagName) {
      const element = {
        namespace,
        tagName,
        attributes: new Map(),
        classNames: new Set(),
        classList: {
          add(name) { element.classNames.add(name); },
          toggle(name, enabled) {
            if (enabled) element.classNames.add(name);
            else element.classNames.delete(name);
          }
        },
        dataset: {},
        children: [],
        setAttribute(name, value) { this.attributes.set(name, value); },
        append(...children) { this.children.push(...children); },
        addEventListener() {}
      };
      return element;
    }
  };
  const node = {
    ownerDocument: specLinkDocument,
    getAttribute: () => "saveItem",
    getBBox: () => ({ x: 10, y: 20, width: 100, height: 40 }),
    append(control) { specLinkElements.push(control); }
  };
  editor.services = { byId: () => ({ textContent: "", classList: { add() {} } }) };
  editor.addSpecLinkControl(node, [
    { filePath: "screens/home/specs/screen.md", references: [] },
    { filePath: "screens/home/specs/element-save.md", references: [] }
  ]);
  const specLinkControl = specLinkElements[0];
  const specIcon = specLinkControl.children.find((child) => child.tagName === "image");
  const hitArea = specLinkControl.children.find((child) => child.tagName === "circle");
  assert.equal(specIcon.attributes.get("href"), "/icons/spec-icon.svg");
  assert.equal(specIcon.attributes.get("width"), "20");
  assert.equal(specIcon.attributes.get("height"), "20");
  assert.equal(hitArea.attributes.get("pointer-events"), "all");
  assert.equal(hitArea.attributes.get("fill"), "transparent");
  assert.equal(hitArea.attributes.get("r"), "12");
  assert.equal(specLinkControl.dataset.specNodeId, "saveItem");
  assert.equal(specLinkControl.children.some((child) => child.tagName === "text"), false);
  editor.services = { byId: () => ({ querySelectorAll: () => [specLinkControl] }) };
  editor.activeSpecPreview = {
    filePath: "screens/home/specs/screen.md",
    nodeId: "saveItem"
  };
  editor.updateSpecLinkSelection();
  assert.equal(specLinkControl.classNames.has("selected"), true);
  assert.equal(specLinkControl.attributes.get("aria-pressed"), "true");
  editor.activeSpecPreview = null;
  editor.updateSpecLinkSelection();
  assert.equal(specLinkControl.classNames.has("selected"), false);
  assert.equal(specLinkControl.attributes.get("aria-pressed"), "false");

  const attributes = new Map();

  /** Creates a DOM element with the supplied content and attributes. */
  const createElement = (tagName) => {
    const classes = new Set();
    const element = {
      tagName,
      className: "",
      textContent: "",
      dataset: {},
      children: [],
      classList: {
        add: (value) => classes.add(value),
        contains: (value) => classes.has(value)
      },
      append(child) { this.children.push(child); },
      querySelector(selector) {
        const lineIndex = Number(selector.match(/"(\d+)"/)?.[1]);
        return this.children.find((child) =>
          Number(child.dataset?.lineIndex) === lineIndex
        );
      },
      getBoundingClientRect: () => ({ top: 120 })
    };
    return element;
  };
  const preview = {
    className: "workflow-spec-preview",
    hidden: true,
    ownerDocument: {
      createElement
    },
    setAttribute: (name, value) => attributes.set(name, value),
    replaceChildren(...children) { this.children = children; },
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTop: 120
  };
  const stageAttributes = new Map();
  const stage = {
    setAttribute: (name, value) => stageAttributes.set(name, value)
  };
  const screenPreview = { className: "screen-preview" };
  const mainClasses = new Set();
  const main = {
    classList: {
      add(name) { mainClasses.add(name); },
      remove(name) { mainClasses.delete(name); },
      toggle(name, enabled) {
        if (enabled) mainClasses.add(name);
        else mainClasses.delete(name);
      }
    }
  };
  const sectionNav = { hidden: true };
  const sectionPosition = { textContent: "" };
  const workflowPanelClasses = new Set();
  const workflowPanel = {
    hidden: false,
    classList: {
      add: (name) => workflowPanelClasses.add(name),
      remove: (name) => workflowPanelClasses.delete(name)
    }
  };
  const previousButton = { disabled: false, addEventListener() {} };
  const nextButton = { disabled: false, addEventListener() {} };
  const fileSelect = {
    hidden: true,
    value: "",
    options: [],
    ownerDocument: { createElement },
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    replaceChildren(...options) { this.options = options; }
  };
  const previewEditor = new WorkflowEditor({
    state: {},
    services: {
      byId: (id) => id === "main" ? main
        : id === "workflow-spec-preview" ? preview
          : id === "workflow-node-spec-preview" ? preview
        : id === "screen-preview" ? screenPreview
        : id === "screen-stage" ? stage
          : id === "workflow-editor-panel" ? workflowPanel
          : id === "workflow-diagram" ? { hidden: false, replaceChildren() {} }
          : id === "workflow-source" ? { hidden: true }
            : id === "workflow-linked-back" ? {
              hidden: true,
              textContent: "",
              addEventListener() {}
            }
            : id === "workflow-mode-exit" ? noopElement
          : id === "spec-editor-panel" ? { hidden: false }
          : id === "workflow-spec-section-navigation" ? sectionNav
            : id === "workflow-spec-section-position" ? sectionPosition
              : id === "workflow-spec-file-select" ? fileSelect
              : id === "workflow-spec-section-previous" ? previousButton
                : id === "workflow-spec-section-next" ? nextButton
          : noopElement
    }
  });
  previewEditor.showSpecPreview(
    [
      {
        filePath: "screens/home/specs/screen.md",
        source: [
          "# Home behavior",
          "",
          "## Purpose",
          "[Save item](specux://screen/home/workflows/add-item.mmd?node=saveItem) trailing content.",
          "Purpose text.",
          "### Details",
          "Nested details.",
          "```md",
          "## Not a heading",
          "```",
          "## Next section",
          "Outside the active section."
        ].join("\n"),
        references: [
          { lineIndex: 3, columnIndex: 0, sectionLineIndex: 2 },
          { lineIndex: 0, sectionLineIndex: 0 }
        ]
      },
      {
        filePath: "screens/home/specs/element-save.md",
        source: "# Save behavior\n\n## Requirements",
        references: [{ lineIndex: 2, sectionLineIndex: 2 }]
      }
    ],
    "saveItem"
  );
  assert.equal(preview.className, "workflow-spec-preview");
  assert.equal(preview.hidden, false);
  assert.equal(preview.children[0].tagName, "pre");
  const renderedLines = preview.children[0].children;
  assert.equal(renderedLines[2].textContent, "## Purpose");
  assert.equal(renderedLines[2].classList.contains("workflow-spec-section-target"), true);
  assert.equal(renderedLines[3].classList.contains("workflow-spec-section-target"), true);
  assert.equal(renderedLines[4].classList.contains("workflow-spec-section-target"), true);
  assert.equal(renderedLines[5].classList.contains("workflow-spec-section-target"), true);
  assert.equal(renderedLines[8].classList.contains("workflow-spec-section-target"), true);
  assert.equal(renderedLines[10].classList.contains("workflow-spec-section-target"), false);
  assert.equal(renderedLines[3].children[1].className, "workflow-spec-link-target");
  assert.equal(
    renderedLines[3].children[1].textContent,
    "[Save item](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
  );
  assert.equal(renderedLines[3].children[2].textContent, " trailing content.");
  assert.equal(preview.scrollTop, 20);
  assert.equal(sectionNav.hidden, false);
  assert.equal(sectionPosition.textContent, "1 of 3");
  assert.equal(fileSelect.hidden, false);
  assert.deepEqual(fileSelect.options.map((option) => option.value), [
    "screens/home/specs/screen.md",
    "screens/home/specs/element-save.md"
  ]);
  assert.equal(fileSelect.value, "screens/home/specs/screen.md");
  assert.equal(previousButton.disabled, false);
  assert.equal(nextButton.disabled, false);
  assert.equal(
    attributes.get("aria-label"),
    "Behavior spec preview: screens/home/specs/screen.md"
  );
  assert.equal(stageAttributes.has("aria-label"), false);
  previewEditor.moveSpecReference(1);
  assert.equal(sectionPosition.textContent, "2 of 3");
  assert.equal(fileSelect.value, "screens/home/specs/screen.md");
  assert.equal(previousButton.disabled, false);
  assert.equal(nextButton.disabled, false);
  previewEditor.moveSpecReference(1);
  assert.equal(sectionPosition.textContent, "3 of 3");
  assert.equal(fileSelect.value, "screens/home/specs/element-save.md");
  assert.equal(preview.children[0].children[2].textContent, "## Requirements");
  assert.equal(previousButton.disabled, false);
  assert.equal(nextButton.disabled, false);
  previewEditor.moveSpecReference(1);
  assert.equal(sectionPosition.textContent, "1 of 3");
  assert.equal(fileSelect.value, "screens/home/specs/screen.md");
  previewEditor.moveSpecReference(-1);
  assert.equal(sectionPosition.textContent, "3 of 3");
  assert.equal(fileSelect.value, "screens/home/specs/element-save.md");
  fileSelect.listeners.change({
    target: { value: "screens/home/specs/screen.md" }
  });
  assert.equal(sectionPosition.textContent, "1 of 3");
  assert.equal(fileSelect.value, "screens/home/specs/screen.md");
  previewEditor.showSpecPreview([{
    filePath: "screens/home/specs/screen.md",
    source: "# Home behavior\n\n## Purpose",
    references: [{ lineIndex: 2, sectionLineIndex: 2 }]
  }], "saveItem");
  assert.equal(sectionNav.hidden, false);
  assert.equal(sectionPosition.textContent, "1 of 1");
  assert.equal(fileSelect.hidden, true);
  assert.equal(previousButton.disabled, true);
  assert.equal(nextButton.disabled, true);
  assert.equal(workflowPanelClasses.has("workflow-node-spec-active"), true);
  previewEditor.closeWorkflowNodeSpecPreview();
  assert.equal(sectionNav.hidden, true);
  assert.equal(preview.hidden, true);
  assert.equal(workflowPanelClasses.has("workflow-node-spec-active"), false);
  assert.equal(screenPreview.className, "screen-preview");
  assert.equal(screenPreview.children, undefined);
});

/** Checks that selection and preview state remain consistent through the interaction. */
test("keeps the workflow owner Screen in the editor selection while previewing another Screen", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screens = [
    { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } },
    { id: "settings", file: "screens/settings/screen.yml", data: { name: "Settings" } }
  ];
  const navigation = new EditorNavigation({
    state: {
      screens,
      activeScreenIndex: 1,
      workflowScreenIndex: 0,
      viewingWorkflow: true,
      activeWorkflowPath: "screens/home/workflows/account.mmd",
      viewingProject: false,
      viewingTheme: false,
      viewingSpec: false,
      viewingMaterialFile: false,
      activeInstancePath: []
    },
    services: {}
  });
  assert.deepEqual(navigation.currentSelection(), {
    view: "workflow",
    screen: {
      id: "home",
      name: "Home",
      file: "screens/home/screen.yml"
    },
    workflow: { file: "screens/home/workflows/account.mmd" }
  });
});

/** Checks that navigation exposes document ownership separately from canvas context. */
test("exposes explicit workspace context for a cross-Screen workflow", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screens = [
    { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } },
    { id: "settings", file: "screens/settings/screen.yml", data: { name: "Settings" } }
  ];
  const navigation = new EditorNavigation({
    state: {
      screens,
      activeScreenIndex: 1,
      activePreviewStateIds: new Map([["settings", "edit"]]),
      activeInstancePaths: [["dialog", "save"]],
      workflowScreenIndex: 0,
      viewingWorkflow: true,
      activeWorkflowPath: "screens/home/workflows/account.mmd",
      selectedWorkflowNodeId: "save",
      viewingProject: false,
      viewingTheme: false,
      viewingSpec: false,
      viewingMaterialFile: false,
      activeInstancePath: []
    },
    services: {}
  });

  assert.deepEqual(navigation.getWorkspaceContext(), {
    activeMode: "workflow",
    workspace: "screen",
    document: {
      view: "workflow",
      file: "screens/home/workflows/account.mmd"
    },
    documentOwner: {
      kind: "screen",
      screenId: "home",
      file: "screens/home/screen.yml"
    },
    canvas: {
      screen: {
        id: "settings",
        name: "Settings",
        file: "screens/settings/screen.yml"
      },
      stateId: "edit",
      placementPaths: [["dialog", "save"]]
    },
    dock: {
      primary: {
        view: "workflow",
        file: "screens/home/workflows/account.mmd",
        nodeId: "save"
      },
      linked: [],
      active: "primary",
      reopenable: null
    }
  });
});

test("serializes and restores multi-placement SpecUX canvas targets", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screen = {
    id: "home",
    file: "screens/home/screen.yml",
    data: {
      name: "Home",
      "preview-states": [{ id: "default" }, { id: "dialog-open" }],
      materials: [{
        id: "dialog",
        type: "group",
        children: [{ id: "title" }, { id: "save" }]
      }]
    }
  };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activePreviewStateIds: new Map([["home", "dialog-open"]]),
    activeInstancePaths: [[0, 0], [0, 1]],
    activeInstancePath: [0, 1],
    workflowScreenIndex: 0,
    viewingWorkflow: true,
    activeWorkflowPath: "screens/home/workflows/checkout.mmd",
    viewingProject: false,
    viewingTheme: false,
    viewingSpec: false,
    viewingMaterialFile: false
  };
  const rendered = [];
  let selectedPaths;
  const navigation = new EditorNavigation({
    state,
    services: {
      renderScreen: async (...args) => rendered.push(args),
      selectInstancesInPreview: (paths) => { selectedPaths = paths; },
      showEditorMessage: (_title, message) => { throw new Error(message); }
    }
  });

  assert.equal(
    navigation.getCanvasSpecuxTarget(),
    "screen/home/screen.yml?placement=dialog.title&placement=dialog.save&state=dialog-open"
  );
  await navigation.restoreUrlCanvasTarget({
    canvasTarget:
      "screen/home/screen.yml?placement=dialog.title&placement=dialog.save&state=dialog-open"
  });

  assert.deepEqual(rendered, [[0, {
    preserveSpec: false,
    preserveWorkflow: true,
    previewStateSelected: true
  }]]);
  assert.deepEqual(selectedPaths, [[0, 0], [0, 1]]);
  assert.deepEqual(state.activeInstancePaths, [[0, 0], [0, 1]]);
});

test("restores a linked node spec under its primary Workflow context", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screen = {
    id: "home",
    file: "screens/home/screen.yml",
    data: { name: "Home", materials: [] }
  };
  const linked = [];
  const navigation = new EditorNavigation({
    state: {
      screens: [screen],
      activeScreenIndex: 0,
      activePreviewStateIds: new Map(),
      activeInstancePaths: [],
      activeInstancePath: [],
      workflowScreenIndex: 0,
      viewingWorkflow: true,
      activeWorkflowPath: "screens/home/workflows/checkout.mmd",
      selectedWorkflowNodeId: "save",
      workflowSources: new Map([
        ["screens/home/workflows/checkout.mmd", "flowchart TD\\nsave"]
      ]),
      viewingProject: false,
      viewingTheme: false,
      viewingSpec: false,
      viewingMaterialFile: false
    },
    services: {
      getProjectFileAction: () => ({ kind: "spec" }),
      showWorkflowNodeSpecPreview: (filePath, nodeId) => linked.push([filePath, nodeId]),
      showEditorMessage: (_title, message) => { throw new Error(message); }
    }
  });

  await navigation.restoreUrlLinkedDocument({
    linkedFile: "screens/home/specs/workflow-checkout-save.md",
    nodeId: "save"
  });

  assert.deepEqual(linked, [["screens/home/specs/workflow-checkout-save.md", "save"]]);
  assert.deepEqual(navigation.getWorkspaceContext().dock.linked, [{
    view: "spec",
    file: "screens/home/specs/workflow-checkout-save.md",
    nodeId: "save",
    readOnly: false
  }]);
});

test("restores a linked Workflow under its primary Spec without changing Spec mode", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screen = {
    id: "home",
    file: "screens/home/screen.yml",
    data: { name: "Home", materials: [] }
  };
  const shown = [];
  let navigation;
  navigation = new EditorNavigation({
    state: {
      screens: [screen],
      activeScreenIndex: 0,
      activePreviewStateIds: new Map(),
      activeInstancePaths: [],
      activeInstancePath: [],
      activeSpecPath: "screens/home/specs/screen.md",
      activeSpecScreenFile: screen.file,
      activeSpecOwner: "screen",
      viewingWorkflow: false,
      viewingSpec: true,
      viewingProject: false,
      viewingTheme: false,
      viewingMaterialFile: false
    },
    services: {
      getProjectFileAction: () => ({ kind: "workflow" }),
      showLinkedWorkflowPreview: async (reference, specPath) => {
        navigation.pushLinkedDock({
          view: "workflow",
          file: reference.workflowPath,
          nodeId: reference.nodeId,
          readOnly: true
        });
        shown.push([reference, specPath]);
      },
      showEditorMessage: (_title, message) => { throw new Error(message); }
    }
  });

  await navigation.restoreUrlLinkedDocument({
    linkedFile: "screens/home/workflows/checkout.mmd",
    nodeId: "save"
  });

  assert.deepEqual(shown, [[{
    workflowPath: "screens/home/workflows/checkout.mmd",
    nodeId: "save"
  }, "screens/home/specs/screen.md"]]);
  assert.equal(navigation.currentSelection().view, "spec");
  assert.equal(navigation.getWorkspaceContext().dock.active, "linked");
});

/** Checks that manual selection exits mode while reference navigation preserves it. */
test("separates manual Screen selection from reference navigation", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screens = [
    { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } },
    { id: "settings", file: "screens/settings/screen.yml", data: { name: "Settings" } }
  ];
  const state = {
    screens,
    activeScreenIndex: 0,
    workflowScreenIndex: 0,
    viewingWorkflow: true,
    activeWorkflowPath: "screens/home/workflows/account.mmd",
    viewingProject: false,
    viewingTheme: false,
    viewingSpec: false,
    viewingMaterialFile: false,
    activeInstancePath: []
  };
  const renderCalls = [];
  const navigation = new EditorNavigation({
    state,
    services: {
      getInstanceAtPath() { return null; },
      async renderScreen(index, options) {
        state.activeScreenIndex = index;
        if (!options?.preserveWorkflow && !options?.preserveSpec) {
          state.viewingWorkflow = false;
          state.activeWorkflowPath = null;
        }
        renderCalls.push({ index, options });
      }
    }
  });

  await navigation.navigateToReferencedScreen(1, "workflow");
  assert.equal(state.activeScreenIndex, 1);
  assert.equal(state.workflowScreenIndex, 0);
  assert.equal(state.viewingWorkflow, true);
  assert.deepEqual(renderCalls[0], {
    index: 1,
    options: { preserveSpec: false, preserveWorkflow: true }
  });

  await navigation.selectScreenManually(state.activeScreenIndex);
  assert.equal(state.activeScreenIndex, 1);
  assert.equal(state.workflowScreenIndex, 1);
  assert.equal(state.viewingWorkflow, false);
  assert.deepEqual(renderCalls[1], {
    index: 1,
    options: { centerPreview: true }
  });
});

/** Checks that linked dock views retain their parent document and canvas context. */
test("pushes and pops linked dock documents without losing the parent context", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screens = [
    { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } },
    { id: "settings", file: "screens/settings/screen.yml", data: { name: "Settings" } }
  ];
  const navigation = new EditorNavigation({
    state: {
      screens,
      activeScreenIndex: 1,
      activePreviewStateIds: new Map([["settings", "edit"]]),
      activeInstancePaths: [["dialog", "save"]],
      workflowScreenIndex: 0,
      viewingWorkflow: false,
      viewingProject: false,
      viewingTheme: false,
      viewingSpec: true,
      viewingMaterialFile: false,
      activeSpecPath: "project.spec.md",
      activeSpecOwner: "project",
      activeSpecScreenFile: null,
      activeSpecInstancePath: []
    },
    services: {}
  });
  const parent = navigation.getWorkspaceContext();
  const linked = navigation.pushLinkedDock({
    view: "workflow",
    file: "screens/home/workflows/account.mmd",
    nodeId: "save",
    readOnly: true
  });
  assert.deepEqual(linked.dock, {
    primary: { view: "spec", file: "project.spec.md" },
    linked: [{
      view: "workflow",
      file: "screens/home/workflows/account.mmd",
      nodeId: "save",
      readOnly: true
    }],
    active: "linked",
    reopenable: null
  });

  assert.deepEqual(navigation.popLinkedDock(), parent);
  assert.deepEqual(navigation.getWorkspaceContext(), parent);
});

/** Material-workspace Escape restores the current Screen. */
test("handles workspace Escape from Material authoring by returning to Screen", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screen = { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [],
    activeInstancePaths: [],
    activePreviewStateIds: new Map(),
    workflowScreenIndex: 0,
    viewingWorkflow: false,
    viewingProject: false,
    viewingTheme: false,
    viewingSpec: false,
    viewingMaterialFile: true,
    materialFiles: new Map(),
    activeMaterialFilePath: "materials/button.stml"
  };
  let renderedScreen = null;
  const navigation = new EditorNavigation({
    state,
    services: {
      async renderScreen(index) {
        renderedScreen = index;
        state.activeScreenIndex = index;
        state.viewingMaterialFile = false;
      }
    }
  });

  assert.deepEqual(await navigation.handleWorkspaceEscape(), {
    handled: true,
    action: "exit-material"
  });
  assert.equal(renderedScreen, 0);
  assert.equal(state.viewingMaterialFile, false);
});

/** Checks that Escape unwinds linked views before closing their primary document. */
test("handles workspace Escape after local interactions and in dock order", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screen = { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [],
    activeInstancePaths: [],
    activePreviewStateIds: new Map(),
    workflowScreenIndex: 0,
    viewingWorkflow: true,
    activeWorkflowPath: "screens/home/workflows/account.mmd",
    viewingProject: false,
    viewingTheme: false,
    viewingSpec: false,
    viewingMaterialFile: false
  };
  const navigation = new EditorNavigation({
    state,
    services: {
      async renderScreen(index) {
        state.activeScreenIndex = index;
        state.viewingWorkflow = false;
        state.activeWorkflowPath = null;
      }
    }
  });
  navigation.pushLinkedDock({ view: "spec", file: "screens/home/specs/element-save.md" });

  assert.deepEqual(
    await navigation.handleWorkspaceEscape({ localInteractionActive: true }),
    { handled: false, reason: "local-interaction" }
  );
  assert.equal(navigation.getWorkspaceContext().dock.active, "linked");

  assert.equal((await navigation.handleWorkspaceEscape()).action, "pop-linked");
  assert.equal(navigation.getWorkspaceContext().dock.active, "primary");
  assert.equal((await navigation.handleWorkspaceEscape()).action, "close-primary");
  assert.equal(state.viewingWorkflow, false);
  assert.equal(state.activeScreenIndex, 0);
});

/** Checks that closing and reopening a primary dock retains its canvas target. */
test("closes and reopens the primary dock at its prior Screen and placement focus", async () => {
  const { EditorNavigation } = await import(
    "../frontend/browser/EditorNavigation.mjs"
  );
  const screens = [
    { id: "home", file: "screens/home/screen.yml", data: { name: "Home" } },
    { id: "settings", file: "screens/settings/screen.yml", data: { name: "Settings" } }
  ];
  const state = {
    screens,
    project: {},
    activeScreenIndex: 1,
    activePreviewStateIds: new Map([["settings", "edit"]]),
    activeInstancePaths: [["dialog", "save"]],
    activeInstancePath: ["dialog", "save"],
    workflowScreenIndex: 0,
    viewingWorkflow: true,
    activeWorkflowPath: "screens/home/workflows/account.mmd",
    workflowSources: new Map([["screens/home/workflows/account.mmd", "flowchart TD"]]),
    viewingProject: false,
    viewingTheme: false,
    viewingSpec: false,
    viewingMaterialFile: false,
    activeSpecOwner: "instance",
    activeSpecPath: null,
    activeSpecScreenFile: null,
    activeSpecInstancePath: [],
    materialFiles: new Map(),
    createdSpecDrafts: new Map(),
    elementSpecOwners: new Map()
  };
  const renderCalls = [];
  const navigation = new EditorNavigation({
    state,
    services: {
      getInstanceAtPath() { return null; },
      async renderScreen(index, options) {
        state.activeScreenIndex = index;
        if (!options?.preserveWorkflow && !options?.preserveSpec) {
          state.viewingWorkflow = false;
          state.activeWorkflowPath = null;
        }
        renderCalls.push({ index, options });
      },
      async renderWorkflowEditor(file, ownerIndex) {
        state.viewingWorkflow = true;
        state.activeWorkflowPath = file;
        state.workflowScreenIndex = ownerIndex;
      },
      selectInstancesInPreview(paths) {
        state.restoredPlacements = paths;
      },
      renderProjectOverview() {}
    }
  });
  navigation.restoreSelection = async () => {
    state.activeScreenIndex = 0;
    state.viewingWorkflow = true;
    state.activeWorkflowPath = "screens/home/workflows/account.mmd";
    state.workflowScreenIndex = 0;
  };

  assert.equal(await navigation.closePrimaryDock(), true);
  assert.equal(state.viewingWorkflow, false);
  assert.equal(state.activeScreenIndex, 1);
  assert.deepEqual(navigation.getWorkspaceContext().dock.reopenable, {
    view: "workflow",
    file: "screens/home/workflows/account.mmd"
  });
  assert.equal(await navigation.reopenPrimaryDock(), true);
  assert.equal(state.viewingWorkflow, true);
  assert.equal(state.workflowScreenIndex, 0);
  assert.equal(state.activeScreenIndex, 1);
  assert.equal(state.activePreviewStateIds.get("settings"), "edit");
  assert.deepEqual(state.restoredPlacements, [["dialog", "save"]]);
  assert.deepEqual(renderCalls.at(-1), {
    index: 1,
    options: {
      preserveSpec: false,
      preserveWorkflow: true,
      previewStateSelected: true
    }
  });
  assert.equal(navigation.getWorkspaceContext().dock.reopenable, null);
});

/** Checks that selection and preview state remain consistent through the interaction. */
test("keeps the workflow layout active while rerendering a linked Screen preview", async () => {
  const { WorkspaceViewRenderer } = await import(
    "../frontend/browser/WorkspaceViewRenderer.mjs"
  );
  const classes = new Set(["workflow-editing"]);
  const main = {
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    }
  };

  /** Creates a DOM element with the supplied content and attributes. */
  const createElement = () => ({
    className: "",
    hidden: false,
    setAttribute() {},
    append() {},
    replaceChildren() {}
  });
  const elements = new Map([
    ["main", main],
    ["workflow-editor-panel", createElement()],
    ["workflow-source", createElement()],
    ["material-document-editor-panel", createElement()],
    ["material-document-source", createElement()],
    ["spec-editor-panel", createElement()],
    ["spec-source", createElement()],
    ["screen-stage", createElement()],
    ["screen-preview", createElement()]
  ]);
  const services = {
    byId: (id) => elements.get(id),
    discardUneditedActiveSpecDraft() {},
    closeScreenPlacementContextMenu() {},
    renderScreenSelector() {},
    projectFileTree: { reveal() {} },
    renderPreviewStateControls() {},
    configureScreenYamlEditor() {},
    syncScreenViewMode() {},
    updateScreenDomContext() {},
    setScreenDomContext() {},
    hideEditorMessage() {},
    updateNavigationSelection() {},
    element: createElement,
    renderInspector() {}
  };
  const renderer = new WorkspaceViewRenderer({
    state: {
      screens: [{
        file: "screens/home/screen.yml",
        data: { name: "Home", materials: [] }
      }]
    },
    services
  });

  await renderer.renderScreen(0, { preserveWorkflow: true });

  assert.equal(classes.has("workflow-editing"), true);
  assert.equal(elements.get("workflow-editor-panel").hidden, false);
});
