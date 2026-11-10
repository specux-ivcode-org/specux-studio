const assert = require("node:assert/strict");
const test = require("node:test");

/** Creates a DOM-like node fixture with child and event support. */
function createNode(tagName, ownerDocument = null) {
  let textContent = "";
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    className: "",
    ownerDocument,
    listeners: new Map(),
    scrollTop: 0,
    scrollLeft: 0,
    append(child) {
      this.children.push(child);
    },
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
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

/** Blur handling must preserve the source selection overlay and keep its scroll offsets aligned with the editor. */
test("Material source retains a visible text selection and its scroll position on blur", async () => {
  const { MaterialFileEditor } = await import("../frontend/browser/MaterialFileEditor.mjs");
  const document = {
    createElement(tagName) {
      return createNode(tagName, document);
    }
  };
  const path = "materials/button.stml";
  const source = "title: Button\r\nlabel: Selected text\r\n";
  const sourceEditor = createNode("textarea");
  sourceEditor.value = source.replace(/\r\n/g, "\n");
  sourceEditor.selectionStart = sourceEditor.value.indexOf("Selected");
  sourceEditor.selectionEnd = sourceEditor.selectionStart + "Selected text".length;
  sourceEditor.scrollTop = 48;
  sourceEditor.scrollLeft = 12;
  sourceEditor.setAttribute = () => {};
  const sourceHighlight = createNode("pre", document);
  const sourceHighlightListeners = sourceHighlight.listeners;
  const elements = new Map([
    ["material-document-source", sourceEditor],
    ["material-source-container", createNode("div")],
    ["material-source-highlight", sourceHighlight]
  ]);
  let published = 0;
  const editor = new MaterialFileEditor({
    state: {
      viewingMaterialFile: true,
      activeMaterialFilePath: path,
      materialFiles: new Map([[path, { documentSource: source }]])
    },
    services: {
      byId: (id) => elements.get(id),
      publishSelection: () => { published += 1; }
    }
  });

  sourceEditor.listeners.get("scroll")();
  assert.equal(sourceHighlight.scrollTop, 48);
  assert.equal(sourceHighlight.scrollLeft, 12);
  sourceHighlight.scrollTop = 72;
  sourceHighlight.scrollLeft = 18;
  sourceHighlightListeners.get("scroll")();
  assert.equal(sourceEditor.scrollTop, 72);
  assert.equal(sourceEditor.scrollLeft, 18);

  sourceEditor.listeners.get("blur")();

  assert.deepEqual(
    sourceHighlight.children.map((line) => line.textContent),
    sourceEditor.value.split("\n")
  );
  assert.equal(sourceHighlight.scrollTop, 72);
  assert.equal(sourceHighlight.scrollLeft, 18);
  const selectedLine = sourceHighlight.children.find((line) =>
    line.children.some((segment) => segment.className === "material-source-text-selection")
  );
  const selectedSegment = selectedLine.children.find((segment) =>
    segment.className === "material-source-text-selection"
  );
  assert.equal(selectedSegment.textContent, "Selected text");
  assert.equal(published, 1);
  assert.equal(typeof editor.renderSourceHighlight, "function");
});

/** The drag path updates width and height in the existing STML block while leaving surrounding source text unchanged. */
test("resizing a Material preview updates only its STML preview-size block", async () => {
  const { MaterialFileEditor } = await import("../frontend/browser/MaterialFileEditor.mjs");
  const validation = require("../shared/validation");
  const editor = new MaterialFileEditor({
    state: {},
    services: { validation, byId: () => null }
  });
  const source = [
    "---",
    "id: navigation-item",
    "name: Navigation Item",
    "type: navigation-item",
    "attributes:",
    "  text:",
    "    type: string",
    "    default: Dashboard",
    "    overridable: true",
    "---",
    "<div>${attributes.text}</div>",
    ""
  ].join("\n");
  const updated = editor.updatePreviewSizeSource(
    source,
    "materials/navigation-item.stml",
    { width: 280, height: 64 }
  );

  assert.match(updated, /preview-size:\n  width: 280\n  height: 64\n---/);
  assert.match(updated, /<div>\$\{attributes\.text\}<\/div>\n$/);

  const inline = source.replace(
    "attributes:",
    "preview-size: { width: 160, height: 40 }\nattributes:"
  );
  const resizedInline = editor.updatePreviewSizeSource(
    inline,
    "materials/navigation-item.stml",
    { width: 300, height: 48 }
  );
  assert.match(resizedInline, /preview-size: \{ width: 300, height: 48 \}/);
  assert.match(resizedInline, /    default: Dashboard/);

  const block = source.replace(
    "attributes:",
    [
      "preview-size:",
      "  # Keep the sizing note.",
      "  width: 160 # Keep the width note.",
      "  height: 40",
      "attributes:"
    ].join("\n")
  );
  const resizedBlock = editor.updatePreviewSizeSource(
    block,
    "materials/navigation-item.stml",
    { width: 320, height: 72 }
  );
  assert.match(resizedBlock, /  # Keep the sizing note\./);
  assert.match(resizedBlock, /  width: 320 # Keep the width note\./);
  assert.match(resizedBlock, /  height: 72/);
});

/** The completed resize notifies annotation overlays so they can recalculate their canvas dimensions. */
test("Material preview resizing dispatches the overlay resize event", async () => {
  const { MaterialFileEditor } = await import("../frontend/browser/MaterialFileEditor.mjs");
  const eventTypes = [];
  const preview = {
    addEventListener() {},
    dispatchEvent(event) {
      eventTypes.push(event.type);
    }
  };
  const editor = new MaterialFileEditor({
    state: {},
    services: {
      byId: (id) => id === "screen-preview" ? preview : null
    }
  });

  editor.dispatchPreviewResizeEvent();

  assert.deepEqual(eventTypes, ["material-preview-resized"]);
});
