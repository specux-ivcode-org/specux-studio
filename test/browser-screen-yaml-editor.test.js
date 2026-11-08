const assert = require("node:assert/strict");
const test = require("node:test");

function createElement() {
  return {
    value: "",
    hidden: false,
    textContent: "",
    attributes: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

test("leaves annotation toolbar visibility to the annotation controller", async () => {
  const { ScreenYamlEditor } = await import("../frontend/browser/ScreenYamlEditor.mjs");
  const elements = new Map([
    ["screen-view-preview", createElement()],
    ["screen-view-yaml", createElement()],
    ["preview-state-controls", createElement()],
    ["screen-canvas-viewport", createElement()],
    ["screen-preview", createElement()],
    ["screen-yaml-editor-panel", createElement()],
    ["annotation-toolbar", createElement()],
    ["screen-yaml-source", createElement()],
    ["preview-state-toolbar", createElement()]
  ]);
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: (id) => elements.get(id) || createElement() },
    fetcher: async () => ({ ok: true, json: async () => ({}) }),
    getActiveScreen: () => null,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles: new Map(),
    markEdited() {},
    renderNavigation() {},
    renderScreen() {},
    updateSaveControls() {},
    validatePreviewStates() {},
    validateScreenMaterials() {}
  });

  elements.get("annotation-toolbar").hidden = true;
  editor.syncViewMode();
  assert.equal(elements.get("annotation-toolbar").hidden, true);
  editor.setViewMode("yaml");
  assert.equal(elements.get("screen-canvas-viewport").hidden, true);
  assert.equal(elements.get("annotation-toolbar").hidden, true);
  editor.setViewMode("preview");
  assert.equal(elements.get("screen-canvas-viewport").hidden, false);
  assert.equal(elements.get("annotation-toolbar").hidden, true);
  editor.hideControls();
  assert.equal(elements.get("screen-canvas-viewport").hidden, false);
  assert.equal(elements.get("annotation-toolbar").hidden, true);
});

test("parses valid Screen YAML and refreshes the active Screen", async () => {
  const { ScreenYamlEditor } = await import("../frontend/browser/ScreenYamlEditor.mjs");
  const screen = {
    id: "home",
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlParseVersion: 2
  };
  const status = createElement();
  const elements = new Map([["screen-yaml-status", status]]);
  const invalidYamlFiles = new Map([[screen.file, "Validating Screen YAML..."]]);
  const calls = { navigation: 0, renders: [], saves: 0, validations: [] };
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: (id) => elements.get(id) || createElement() },
    fetcher: async () => ({ ok: true, json: async () => ({ data: { name: "Updated" } }) }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles,
    markEdited() {},
    renderNavigation: () => { calls.navigation += 1; },
    renderScreen: async (index) => { calls.renders.push(index); },
    updateSaveControls: () => { calls.saves += 1; },
    validatePreviewStates: (data, file) => { calls.validations.push([data, file]); },
    validateScreenMaterials() {}
  });

  await editor.parse(screen, "name: Updated", 2);

  assert.deepEqual(screen.data, {
    name: "Updated",
    layers: [{ id: "base", name: "Base" }]
  });
  assert.equal(screen.yamlSource, "name: Updated");
  assert.equal(screen.yamlSourceMode, "data");
  assert.equal(invalidYamlFiles.has(screen.file), false);
  assert.equal(status.textContent, "YAML is valid. Save to persist changes.");
  assert.equal(calls.navigation, 1);
  assert.deepEqual(calls.renders, [0]);
  assert.equal(calls.saves, 1);
  assert.deepEqual(calls.validations, [[{
    name: "Updated",
    layers: [{ id: "base", name: "Base" }]
  }, screen.file]]);
});

test("ignores a stale Screen YAML parse response", async () => {
  const { ScreenYamlEditor } = await import("../frontend/browser/ScreenYamlEditor.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlParseVersion: 3
  };
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: () => createElement() },
    fetcher: async () => ({ ok: true, json: async () => ({ data: { name: "Stale" } }) }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles: new Map(),
    markEdited() {},
    renderNavigation() { assert.fail("stale response must not rerender navigation"); },
    renderScreen() { assert.fail("stale response must not rerender the Screen"); },
    updateSaveControls() { assert.fail("stale response must not update save controls"); },
    validatePreviewStates() { assert.fail("stale response must not validate data"); },
    validateScreenMaterials() { assert.fail("stale response must not validate data"); }
  });

  await editor.parse(screen, "name: Stale", 2);
  assert.deepEqual(screen.data, { name: "Home" });
});

test("generates Screen YAML and fills the active YAML editor", async () => {
  const { ScreenYamlEditor } = await import("../frontend/browser/ScreenYamlEditor.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlSourceMode: "data",
    yamlSerializeVersion: 0
  };
  const textarea = createElement();
  const status = createElement();
  const elements = new Map([
    ["screen-yaml-source", textarea],
    ["screen-yaml-status", status]
  ]);
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: (id) => elements.get(id) || createElement() },
    fetcher: async (url) => ({
      ok: true,
      json: async () => url.endsWith("/stringify") ? { source: "name: Home\n" } : {}
    }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles: new Map(),
    markEdited() {},
    renderNavigation() {},
    renderScreen() {},
    updateSaveControls() {},
    validatePreviewStates() {},
    validateScreenMaterials() {}
  });
  editor.mode = "yaml";

  await editor.prepareSource(screen);

  assert.equal(screen.yamlSource, "name: Home\n");
  assert.equal(screen.yamlSourceMode, "generated");
  assert.equal(textarea.value, "name: Home\n");
  assert.equal(status.textContent, "YAML source is ready.");
});

test("rejects Screen YAML placements without an explicit layer", async () => {
  const { ScreenYamlEditor } = await import("../frontend/browser/ScreenYamlEditor.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlParseVersion: 1
  };
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: () => createElement() },
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        data: {
          name: "Home",
          materials: [{ id: "welcome" }]
        }
      })
    }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles: new Map(),
    markEdited() {},
    renderNavigation() { assert.fail("invalid Screen YAML must not be accepted"); },
    renderScreen() { assert.fail("invalid Screen YAML must not render"); },
    updateSaveControls() { assert.fail("invalid Screen YAML must not update save controls"); },
    validatePreviewStates() {},
    validateScreenMaterials({ data }) {
      if (data.materials.some((material) => typeof material.layer !== "string")) {
        throw new Error("materials[0]: layer must reference a layer defined on this Screen.");
      }
    }
  });

  await assert.rejects(editor.parse(screen, "name: Home", 1), /layer must reference a layer/);
  assert.deepEqual(screen.data, { name: "Home" });
});
