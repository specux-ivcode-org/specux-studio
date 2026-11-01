const assert = require("node:assert/strict");
const test = require("node:test");
const validation = require("../shared/validation");

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

test("workflow inspector exposes read-only placement context", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const panel = {
    children: [],
    parentElement: { classList: { toggle() {} } },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); }
  };
  const createElement = (tagName, className, textContent) => ({
    tagName,
    className,
    textContent,
    children: [],
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    addEventListener() {}
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
  assert.ok(rendered.some((node) => node.textContent === "This Screen preview is read-only. The highlighted placement is the target of the selected workflow node."));
  assert.ok(rendered.some((node) => node.textContent === "save-button"));
  assert.equal(rendered.some((node) => node.tagName === "button" || node.tagName === "input"), false);
});

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
    placementId: null,
    stateId: "default"
  });
  assert.deepEqual(
    parseWorkflowLink(
      "specux://screen/home/screen.yml?placement=dialog-save&state=add-item-open"
    ),
    {
      screenId: "home",
      placementId: "dialog-save",
      stateId: "add-item-open"
    }
  );
  assert.deepEqual(
    parseWorkflowSpecReference(
      "specux://screen/home/workflows/add-item.mmd?node=saveItem",
      workflowPath
    ),
    { nodeId: "saveItem" }
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
    placementId: "dialog-save",
    stateId: "add-item-open"
  });
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
    { nodeId: "saveItem", lineIndex: 7, sectionLineIndex: 6 },
    { nodeId: "saveItem", lineIndex: 10, sectionLineIndex: 9 }
  ]);
  assert.deepEqual(
    parseWorkflowSpecReferences([
      "## Link examples",
      "```md",
      "[Example](specux://screen/home/workflows/add-item.mmd?node=saveItem)",
      "```",
      "[Actual link](specux://screen/home/workflows/add-item.mmd?node=saveItem)"
    ].join("\n"), workflowPath),
    [{ nodeId: "saveItem", lineIndex: 4, sectionLineIndex: 0 }]
  );
  const specLinks = collectWorkflowSpecLinks([{
    filePath: "screens/home/specs/screen.md",
    source: specSource
  }], workflowPath);
  assert.equal(specLinks.get("saveItem")[0].references.length, 2);
  assert.throws(
    () => parseWorkflowLink("specux://screen/Home/screen.yml"),
    /Workflow link path must be/
  );
  assert.throws(() =>
    parseWorkflowLink("specux://screen/home/screen.yml?state=not-a-state&other=value"),
    /one placement and one state query parameter/
  );
  assert.throws(() =>
    parseWorkflowClickDirectives([
      'click saveItem href "specux://screen/home/screen.yml"',
      'click saveItem href "specux://screen/home/screen.yml?placement=about"'
    ].join("\n")),
    /more than one SpecUX link/
  );
  const noopElement = { addEventListener() {} };
  const editor = new WorkflowEditor({
    state: {},
    services: { byId: () => noopElement }
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

  const attributes = new Map();
  const createElement = (tagName) => {
    const classes = new Set();
    const element = {
      tagName,
      className: "",
      textContent: "",
      dataset: {},
      children: [],
      classList: { add: (value) => classes.add(value) },
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
      toggle(name, enabled) {
        if (enabled) mainClasses.add(name);
        else mainClasses.delete(name);
      }
    }
  };
  const sectionNav = { hidden: true };
  const sectionPosition = { textContent: "" };
  const previousButton = { disabled: false, addEventListener() {} };
  const nextButton = { disabled: false, addEventListener() {} };
  const previewEditor = new WorkflowEditor({
    state: {},
    services: {
      byId: (id) => id === "main" ? main
        : id === "workflow-spec-preview" ? preview
        : id === "screen-preview" ? screenPreview
        : id === "screen-stage" ? stage
          : id === "workflow-spec-section-navigation" ? sectionNav
            : id === "workflow-spec-section-position" ? sectionPosition
              : id === "workflow-spec-section-previous" ? previousButton
                : id === "workflow-spec-section-next" ? nextButton
          : noopElement
    }
  });
  previewEditor.showSpecPreview(
    "screens/home/specs/screen.md",
    "# Home behavior\n\n## Purpose",
    [
      { lineIndex: 2, sectionLineIndex: 2 },
      { lineIndex: 0, sectionLineIndex: 0 }
    ]
  );
  assert.equal(preview.className, "workflow-spec-preview");
  assert.equal(preview.hidden, false);
  assert.equal(preview.children[0].tagName, "pre");
  assert.equal(preview.children[0].children[2].textContent, "## Purpose");
  assert.equal(preview.scrollTop, 20);
  assert.equal(sectionNav.hidden, false);
  assert.equal(sectionPosition.textContent, "1 of 2");
  assert.equal(previousButton.disabled, true);
  assert.equal(nextButton.disabled, false);
  assert.equal(
    attributes.get("aria-label"),
    "Behavior spec preview: screens/home/specs/screen.md"
  );
  assert.equal(stageAttributes.get("aria-label"), attributes.get("aria-label"));
  previewEditor.moveSpecReference(1);
  assert.equal(sectionPosition.textContent, "2 of 2");
  assert.equal(previousButton.disabled, false);
  assert.equal(nextButton.disabled, true);
  previewEditor.showSpecPreview(
    "screens/home/specs/screen.md",
    "# Home behavior\n\n## Purpose",
    [{ lineIndex: 2, sectionLineIndex: 2 }]
  );
  assert.equal(sectionNav.hidden, false);
  assert.equal(sectionPosition.textContent, "1 of 1");
  assert.equal(previousButton.disabled, true);
  assert.equal(nextButton.disabled, true);
  assert.equal(mainClasses.has("workflow-spec-preview-active"), true);
  previewEditor.activeSpecPreview = null;
  previewEditor.updateSpecSectionNavigation();
  assert.equal(sectionNav.hidden, true);
  assert.equal(preview.hidden, true);
  assert.equal(mainClasses.has("workflow-spec-preview-active"), false);
  assert.equal(screenPreview.className, "screen-preview");
  assert.equal(screenPreview.children, undefined);
});

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
      viewingAssetTemplate: false,
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
    ["asset-document-editor-panel", createElement()],
    ["asset-document-source", createElement()],
    ["spec-editor-panel", createElement()],
    ["spec-source", createElement()],
    ["screen-heading", createElement()],
    ["breadcrumb", createElement()],
    ["screen-stage", createElement()],
    ["screen-preview", createElement()]
  ]);
  const services = {
    byId: (id) => elements.get(id),
    discardUneditedActiveSpecDraft() {},
    closeAssetContextMenu() {},
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
