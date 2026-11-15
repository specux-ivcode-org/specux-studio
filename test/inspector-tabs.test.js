const assert = require("node:assert/strict");
const test = require("node:test");

/** Screen Details exposes two tabs and combines all contextual content in Properties. */
test("combines Screen State and spec/workflow details in the Properties tab", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");

  function element(tagName, className = "", textContent = "") {
    const attributes = new Map();
    const listeners = new Map();
    return {
      tagName,
      className,
      textContent,
      children: [],
      attributes,
      listeners,
      dataset: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { attributes.set(name, value); },
      addEventListener(type, listener) { listeners.set(type, listener); },
      focus() { this.focused = true; }
    };
  }

  const screen = { name: "Home" };
  const panel = element("div", "inspector-content");
  panel.parentElement = {
    scrollTop: 0,
    classList: { toggle() {} }
  };
  panel.querySelector = (selector) => {
    const match = selector.match(/data-inspector-tab="([^"]+)"/);
    if (!match) return null;
    return panel.children[0].children.find((tab) =>
      tab.dataset.inspectorTab === match[1]
    );
  };

  let renderer;
  const services = {
    element,
    byId: () => panel,
    renderInspector() {
      panel.replaceChildren();
      renderer.renderScreenEditorDetails(panel, screen, null, null, false);
    }
  };
  renderer = new InspectorRenderer({
    state: {
      screens: [{ file: "screens/home/screen.yml" }],
      activeScreenIndex: 0,
      activeInstancePath: []
    },
    services
  });
  renderer.renderScreenProperties = (target) =>
    target.append(element("section", "screen-properties"));
  renderer.renderInstanceDetails = (target) =>
    target.append(element("section", "instance-properties"));
  renderer.renderScreenStatesDetails = (target) =>
    target.append(element("section", "screen-states"));
  renderer.renderSpecsWorkflowsDetails = (target) =>
    target.append(element("section", "screen-specs-workflows"));
  renderer.renderLayersDetails = (target) =>
    target.append(element("section", "screen-layers"));

  renderer.screenDetailsTab = "specs-workflows";
  renderer.renderScreenEditorDetails(panel, screen, null, null, false);
  let [tabList, content] = panel.children;
  assert.deepEqual(tabList.children.map((tab) => tab.textContent), [
    "Properties",
    "Layers"
  ]);
  assert.equal(tabList.attributes.get("role"), "tablist");
  assert.equal(content.attributes.get("aria-labelledby"), "screen-details-tab-properties");
  assert.deepEqual(content.children.map((section) => section.className), [
    "screen-properties",
    "screen-specs-workflows",
    "screen-states"
  ]);

  tabList.children[1].listeners.get("click")();
  [tabList, content] = panel.children;
  assert.equal(tabList.children[1].attributes.get("aria-selected"), "true");
  assert.deepEqual(content.children.map((section) => section.className), ["screen-layers"]);

  let prevented = false;
  tabList.children[1].listeners.get("keydown")({
    key: "ArrowRight",
    preventDefault() { prevented = true; }
  });
  [tabList, content] = panel.children;
  assert.equal(prevented, true);
  assert.equal(tabList.children[0].focused, true);
  assert.equal(tabList.children[0].attributes.get("aria-selected"), "true");
  assert.equal(content.attributes.get("aria-labelledby"), "screen-details-tab-properties");
  assert.deepEqual(content.children.map((section) => section.className), [
    "screen-properties",
    "screen-specs-workflows",
    "screen-states"
  ]);

  const instance = { id: "add-item" };
  let screenStateDetailsRendered = false;
  renderer.renderScreenProperties = () => assert.fail("Screen properties rendered for a placement");
  renderer.renderInstanceDetails = (target, selectedInstance) => {
    assert.equal(selectedInstance, instance);
    target.append(element("section", "instance-properties"));
  };
  renderer.renderSpecsWorkflowsDetails = (target, _screen, selectedInstance) => {
    assert.fail(`Screen spec/workflow details rendered for placement ${selectedInstance?.id}`);
  };
  renderer.renderScreenStatesDetails = () => { screenStateDetailsRendered = true; };
  panel.replaceChildren();
  renderer.renderScreenEditorDetails(panel, screen, instance, null, false);
  [, content] = panel.children;
  assert.deepEqual(content.children.map((section) => section.className), ["instance-properties"]);
  assert.equal(screenStateDetailsRendered, false);
});

test("placement details place the placement spec action below placement metadata", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");

  function element(tagName, className = "", textContent = "") {
    return {
      tagName,
      className,
      textContent,
      children: [],
      attributes: new Map(),
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attributes.set(name, value); },
      addEventListener() {},
      classList: { toggle() {} }
    };
  }

  const renderer = new InspectorRenderer({
    state: {
      screens: [{ id: "home", file: "screens/home/screen.yml" }],
      activeScreenIndex: 0,
      activeInstancePath: ["add-item"],
      workflowSources: new Map()
    },
    services: {
      element,
      createSpecForInstance: async () => {},
      showFatalError() {}
    }
  });
  const panel = element("div");
  renderer.renderMaterialPlacementHeader(
    panel,
    { id: "add-item" },
    {
      id: "button",
      data: { name: "Button", type: "button" },
      file: "materials/button.stml"
    }
  );

  assert.deepEqual(panel.children.map((child) => child.className), [
    "section-title",
    "placement-properties-table",
    "section-title",
    "spec-action-button"
  ]);
  assert.equal(panel.children[0].textContent, "Material placement");
  assert.equal(panel.children[2].textContent, "Placement spec");
  assert.equal(panel.children[3].textContent, "Open or create placement spec");
});

test("renders placement metadata as label/value rows in a table", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");

  function element(tagName, className = "", textContent = "") {
    return {
      tagName,
      className,
      textContent,
      children: [],
      attributes: new Map(),
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attributes.set(name, value); },
      addEventListener() {}
    };
  }

  const renderer = new InspectorRenderer({
    state: {},
    services: { element }
  });
  const panel = element("div");
  renderer.renderMaterialPlacementHeader(
    panel,
    { id: "welcome-banner" },
    {
      id: "welcome-material",
      data: { name: "Welcome banner", type: "html" },
      file: "materials/welcome.stml"
    }
  );

  const table = panel.children.find((child) =>
    child.className === "placement-properties-table"
  );
  const rows = table.children[0].children;
  assert.equal(table.tagName, "table");
  assert.equal(table.attributes.get("aria-label"), "Placement properties");
  assert.deepEqual(rows.slice(0, 3).map((row) =>
    row.children.map((cell) => cell.textContent)
  ), [
    ["Placement ID", "welcome-banner"],
    ["Material", "Welcome banner"],
    ["Type", "html"]
  ]);
  const [fileLabel, fileCell] = rows[3].children;
  assert.equal(fileLabel.textContent, "File");
  assert.equal(fileCell.children[0].children[0].textContent, "materials/welcome.stml");
  assert.equal(fileCell.children[0].children[1].textContent, "Edit");
  assert.equal(
    fileCell.children[0].children[1].attributes.get("aria-label"),
    "Edit shared Material"
  );
  assert.equal(panel.children.filter((child) =>
    child.className.includes("placement-properties-edit-button")
  ).length, 0);
  assert.equal(rows[0].children[0].attributes.get("scope"), "row");
});

test("renders Placement Transformation before Instance Variables", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const renderOrder = [];
  const renderer = new InspectorRenderer({
    state: {
      screens: [{ data: {}, file: "screens/home/screen.yml" }],
      activeScreenIndex: 0,
      activeInstancePath: ["add-item"],
      materialFiles: new Map()
    },
    services: {
      getActivePreviewStateId: () => "default"
    }
  });
  renderer.renderMaterialPlacementHeader = () => renderOrder.push("Material placement");
  renderer.renderMaterialPlacementTransform = () => renderOrder.push("Placement Transformation");
  renderer.renderInstanceVariables = () => renderOrder.push("Instance Variables");
  renderer.renderRemovePlacementButton = () => renderOrder.push("Remove placement");

  renderer.renderMaterialPlacementDetails(
    {},
    { id: "add-item" },
    { data: { attributes: {} } }
  );

  assert.deepEqual(renderOrder, [
    "Material placement",
    "Placement Transformation",
    "Instance Variables",
    "Remove placement"
  ]);
});

test("pairs placement transform axes and leaves rotation last", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");

  function element(tagName, className = "", textContent = "") {
    return {
      tagName,
      className,
      textContent,
      children: [],
      append(...children) { this.children.push(...children); }
    };
  }

  const renderer = new InspectorRenderer({
    state: {},
    services: {
      element,
      appendEditableField(parent, label) {
        parent.append(element("div", "editor-field", label));
      }
    }
  });
  const panel = element("div");
  renderer.renderEditablePlacementTransform(
    panel,
    {
      position: { x: 10, y: 20 },
      size: { width: 120, height: 48 },
      scale: { x: 1.5, y: 2 },
      rotation: 30
    },
    {}
  );

  assert.deepEqual(panel.children.slice(0, 3).map((row) =>
    row.children.map((field) => field.textContent)
  ), [
    ["Position X", "Position Y"],
    ["Width", "Height"],
    ["Transform scale X", "Transform scale Y"]
  ]);
  assert.equal(panel.children[3].className, "editor-field");
  assert.equal(panel.children[3].textContent, "Rotation");
});

test("renders inspector content without a generic Details heading", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const panel = {
    children: [],
    parentElement: { classList: { toggle() {} } },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    querySelector() { return null; }
  };
  const renderer = new InspectorRenderer({
    state: {
      viewingProject: true,
      viewingTheme: false,
      viewingSpec: false,
      viewingMaterialFile: false,
      viewingWorkflow: false
    },
    services: {
      byId: () => panel,
      element: (tagName, className) => ({ tagName, className })
    }
  });
  renderer.renderProjectDetails = (target) =>
    target.append({ tagName: "section", className: "project-details" });

  renderer.render();

  assert.deepEqual(panel.children, [{ tagName: "section", className: "project-details" }]);
});

test("keeps Screen Details visible while opening a workflow from the selector", async () => {
  const { InspectorRenderer } = await import("../frontend/browser/InspectorRenderer.mjs");
  const panel = {
    children: [],
    parentElement: { classList: { toggle() {} } },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    querySelector() { return null; }
  };
  const renderer = new InspectorRenderer({
    state: {
      viewingProject: false,
      viewingTheme: false,
      viewingSpec: false,
      viewingMaterialFile: false,
      viewingWorkflow: true,
      screens: [{ data: { materials: [] } }],
      activeScreenIndex: 0,
      activeInstancePath: [],
      materialFiles: new Map()
    },
    services: {
      byId: () => panel,
      getActivePreviewStateId: () => "default"
    }
  });
  renderer.renderScreenEditorDetails = (target) =>
    target.append({ className: "screen-details" });
  renderer.renderWorkflowPreviewDetails = (target) =>
    target.append({ className: "workflow-preview-details" });

  renderer.keepScreenDetails = true;
  renderer.render();
  assert.deepEqual(panel.children, [{ className: "screen-details" }]);

  renderer.keepScreenDetails = false;
  renderer.render();
  assert.deepEqual(panel.children, [{ className: "workflow-preview-details" }]);
});
