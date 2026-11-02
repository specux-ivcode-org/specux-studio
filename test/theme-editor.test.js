const assert = require("node:assert/strict");
const test = require("node:test");

function createThemeEditor(ThemeEditor, activeInstancePath = []) {
  const screen = {
    id: "home",
    data: {
      name: "Home",
      materials: [
        {
          id: "surface",
          src: "materials/surface.stml",
          attributes: { background: "var(--theme-panel, #fff)" }
        },
        {
          id: "label",
          src: "materials/label.stml"
        }
      ]
    }
  };
  const materialFiles = new Map([
    ["materials/surface.stml", {
      file: "materials/surface.stml",
      data: {
        name: "Surface",
        attributes: {
          background: { default: "var(--theme-surface)" },
          border: { default: "1px solid var(--theme-border)" },
          text: { default: "Title" }
        }
      },
      html: "<style>.surface { box-shadow: var(--theme-card-shadow); }</style>"
    }],
    ["materials/label.stml", {
      file: "materials/label.stml",
      data: {
        name: "Label",
        attributes: { color: { default: "var(--theme-ink)" } }
      },
      html: "<span></span>"
    }]
  ]);
  return new ThemeEditor({
    state: {
      screens: [screen],
      materialFiles,
      activeScreenIndex: 0,
      activeInstancePath
    },
    services: {
      getInstanceAtPath(owner, path) {
        return owner.data.materials[path[0]];
      }
    }
  });
}

test("Screen Theme context finds attribute and style token references", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);

  assert.deepEqual([...editor.getScreenTokenUses().keys()].sort(), [
    "border",
    "card-shadow",
    "ink",
    "panel"
  ]);
  assert.equal(
    editor.getScreenTokenUses().get("panel").has("Surface · surface · background"),
    true
  );
});

test("Screen Theme usage stays Screen-wide regardless of placement state", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor, [0]);
  const usages = editor.getScreenTokenUses();

  assert.deepEqual([...usages.keys()].sort(), [
    "border",
    "card-shadow",
    "ink",
    "panel"
  ]);
});

test("Material Theme context reads its defaults and style references", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const usages = editor.getMaterialTokenUses("materials/surface.stml");

  assert.deepEqual([...usages.keys()].sort(), ["border", "card-shadow", "surface"]);
});

test("preview point maps to the painted background or border token, not every token on the element", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const makeStyle = (entries) => {
    const values = new Map(entries);
    return {
      length: entries.length,
      cssText: entries.map(([name, value]) => `${name}: ${value};`).join(" "),
      getPropertyValue: (name) => values.get(name),
      getPropertyPriority: () => ""
    };
  };
  const target = {
    nodeType: 1,
    localName: "div",
    className: "material-visual",
    parentElement: null,
    style: makeStyle([
      ["background", "var(--theme-surface)"],
      ["border", "1px solid var(--theme-border)"]
    ]),
    namespaceURI: "http://www.w3.org/1999/xhtml",
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    matches: () => false
  };
  const root = {
    contains: (node) => node === target,
    querySelectorAll: () => [],
    matches: () => false
  };
  target.parentElement = root;
  target.closest = () => root;
  target.computedStyle = {
    backgroundColor: "rgb(255, 255, 255)",
    backgroundImage: "none",
    borderTopWidth: "2px",
    borderRightWidth: "2px",
    borderBottomWidth: "2px",
    borderLeftWidth: "2px",
    borderTopStyle: "solid",
    borderRightStyle: "solid",
    borderBottomStyle: "solid",
    borderLeftStyle: "solid"
  };
  editor.services.document = {
    caretPositionFromPoint: () => null,
    caretRangeFromPoint: () => null
  };
  editor.services.getComputedStyle = (node) => node.computedStyle;

  const background = editor.getPointColorBinding(
    { clientX: 50, clientY: 50 },
    target,
    root
  );
  const border = editor.getPointColorBinding(
    { clientX: 1, clientY: 50 },
    target,
    root
  );

  assert.equal(background.token, "surface");
  assert.equal(background.property, "background");
  assert.equal(border.token, "border");
  assert.equal(border.property, "border");
});

test("preview maps a matching Material CSS color declaration", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const values = new Map([["color", "var(--theme-ink)"]]);
  const target = {
    style: { cssText: "" },
    parentElement: null,
    matches: (selector) => selector === ".material-label"
  };
  const root = {
    contains: (node) => node === target,
    querySelectorAll: (selector) => selector === "style" ? [{
      sheet: {
        cssRules: [{
          selectorText: ".material-label",
          style: {
            cssText: "color: var(--theme-ink);",
            getPropertyValue: (property) => values.get(property),
            getPropertyPriority: () => ""
          }
        }]
      }
    }] : [],
    matches: () => false
  };
  target.parentElement = root;

  const binding = editor.findColorBinding(target, root, "text");

  assert.equal(binding.status, "mapped");
  assert.equal(binding.token, "ink");
  assert.equal(binding.source, "Material CSS");
});

test("Theme preview pointer handling consumes the color pick without selecting a placement", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  editor.state.viewingTheme = true;
  const candidates = [{ binding: { token: "surface" }, distance: 0 }];
  const selected = [];
  editor.getNearbyColorBindings = () => candidates;
  editor.updateRadiusCursor = () => {};
  editor.openColorPopup = (...args) => selected.push(args);
  const eventCalls = [];

  editor.selectPreviewColor({
    button: 0,
    clientX: 12,
    clientY: 20,
    preventDefault: () => eventCalls.push("preventDefault"),
    stopPropagation: () => eventCalls.push("stopPropagation")
  });

  assert.deepEqual(eventCalls, ["preventDefault", "stopPropagation"]);
  assert.deepEqual(selected[0][1], candidates);
});

test("Theme preview shows a 35px radius guide and retains the normal pointer", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const listeners = new Set();
  const previewClasses = new Set();
  const target = {};
  const preview = {
    contains: (node) => node === target,
    classList: {
      add: (value) => previewClasses.add(value),
      remove: (value) => previewClasses.delete(value)
    }
  };
  const cursor = {
    classList: {
      add: (value) => listeners.add(value),
      remove: (value) => listeners.delete(value)
    },
    append() {},
    style: {
      values: new Map(),
      setProperty(name, value) { this.values.set(name, value); }
    },
    setAttribute() {}
  };
  const appended = [];
  editor.state.viewingTheme = true;
  editor.services.byId = () => preview;
  editor.services.document = {
    createElement: () => cursor,
    body: { append: (node) => appended.push(node) }
  };

  editor.updateRadiusCursor({ target, clientX: 120, clientY: 240 });

  assert.equal(appended[0], cursor);
  assert.equal(cursor.style.left, "120px");
  assert.equal(cursor.style.top, "240px");
  assert.equal(cursor.style.values.get("--theme-color-pick-radius"), "17.5px");
  assert.equal(Number.parseFloat(cursor.style.values.get("--theme-color-pick-radius")) * 2, 35);
  assert.equal(listeners.has("is-visible"), true);
  assert.equal(previewClasses.has("theme-color-picking"), false);

  editor.hideRadiusCursor();
  assert.equal(listeners.has("is-visible"), false);
  assert.equal(previewClasses.has("theme-color-picking"), false);
});

test("nearby Theme colors are deduplicated and ordered within a 35px circle", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const root = {};
  const candidatesByOffset = new Map([
    ["0.5,0.5", { token: "thin", node: {} }],
    ["5.5,0.5", { token: "near", node: {} }],
    ["10.5,0.5", { token: "near", node: {} }],
    ["0.5,10.5", { token: "next", node: {} }],
    ["17.5,0", { token: "edge", node: {} }],
    ["18,0", { token: "outside", node: {} }]
  ]);
  editor.services.byId = () => ({
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200 })
  });
  editor.services.document = {
    elementFromPoint(x, y) {
      const binding = candidatesByOffset.get(`${x - 100},${y - 100}`);
      return binding
        ? { binding, closest: () => root }
        : null;
    }
  };
  editor.services.getComputedStyle = () => ({
    opacity: "1",
    backgroundImage: "none",
    backgroundColor: "rgba(0, 0, 0, 0)"
  });
  editor.getPointColorBinding = (_point, target) => ({
    ...target.binding,
    status: "mapped"
  });

  const candidates = editor.getNearbyColorBindings({ clientX: 100, clientY: 100 });

  assert.deepEqual(candidates.map(({ binding, distance }) => [
    binding.token,
    Number(distance.toFixed(2))
  ]), [
    ["thin", 0.71],
    ["near", 5.52],
    ["next", 10.51],
    ["edge", 17.5]
  ]);
});

test("radius search finds Theme colors beneath transparent overlapping Materials", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const overlayRoot = {};
  const backgroundRoot = {};
  const overlay = {
    closest: () => overlayRoot,
    binding: { status: "unmapped" }
  };
  const background = {
    closest: () => backgroundRoot,
    binding: { status: "mapped", token: "primary-gradient", node: {} }
  };
  editor.services.byId = () => ({
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 200 })
  });
  editor.services.document = {
    elementsFromPoint(x, y) {
      return x === 100 && y === 100 ? [overlay, background] : [];
    }
  };
  editor.services.getComputedStyle = () => ({
    opacity: "1",
    backgroundImage: "none",
    backgroundColor: "rgba(0, 0, 0, 0)"
  });
  editor.getPointColorBinding = (_point, target) => target.binding;

  const candidates = editor.getNearbyColorBindings({ clientX: 100, clientY: 100 });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].binding.token, "primary-gradient");
  assert.equal(candidates[0].root, backgroundRoot);
});

test("live Theme color edits preserve token alpha and apply immediately", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  editor.state.theme = {
    modes: { dark: { tokens: { overlay: "rgba(0, 0, 0, 0.62)" } } }
  };
  editor.state.project = { theme: "theme.yml" };
  const calls = [];
  editor.services.applyTheme = () => calls.push("apply");
  editor.services.markEdited = (path) => calls.push(path);

  editor.updateThemeColor("overlay", "dark", "#123456", 0.62);

  assert.equal(editor.state.theme.modes.dark.tokens.overlay, "rgba(18, 52, 86, 0.62)");
  assert.deepEqual(calls, ["apply", "theme.yml"]);
});

test("Material context selection renders the chosen Material and Screen context restores the Screen", async () => {
  const { ThemeEditor } = await import("../frontend/browser/ThemeEditor.mjs");
  const editor = createThemeEditor(ThemeEditor);
  const calls = [];
  const makeElement = (tagName, className = "", textContent = "") => ({
    tagName,
    className,
    textContent,
    children: [],
    listeners: new Map(),
    append(...children) { this.children.push(...children); },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute() {}
  });
  editor.services.element = makeElement;
  editor.services.appendSection = () => {};
  editor.services.renderInspector = () => {};
  editor.services.renderThemeMaterial = (path) => calls.push(["material", path]);
  editor.services.renderThemeScreen = (index) => {
    calls.push(["screen", index]);
    return Promise.resolve();
  };
  editor.services.showFatalError = () => {};

  const screenPanel = makeElement("div");
  editor.renderContextControls(screenPanel);
  const scopeSelect = screenPanel.children[0].children[1];
  scopeSelect.value = "material";
  scopeSelect.listeners.get("change")();
  assert.deepEqual(calls[0], ["material", editor.getMaterialOptions()[0].value]);

  const materialPanel = makeElement("div");
  editor.renderContextControls(materialPanel);
  const materialSelect = materialPanel.children[1].children[1];
  materialSelect.value = "materials/surface.stml";
  materialSelect.listeners.get("change")();
  assert.deepEqual(calls[1], ["material", "materials/surface.stml"]);

  const materialScopeSelect = materialPanel.children[0].children[1];
  materialScopeSelect.value = "screen";
  materialScopeSelect.listeners.get("change")();
  assert.deepEqual(calls[2], ["screen", 0]);
});
