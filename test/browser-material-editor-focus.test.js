const assert = require("node:assert/strict");
const test = require("node:test");

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
