const assert = require("node:assert/strict");
const test = require("node:test");

function createInstance(path, children = [], shadowRoot = null) {
  const classes = new Set(["asset-instance"]);
  const styles = new Map();
  return {
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
}

test("focuses an Element spec target and dims unrelated preview branches", async () => {
  const { SpecEditor } = await import("../browser/SpecEditor.mjs");
  const selected = createInstance([0, "navigation", 0]);
  const sibling = createInstance([0, "header", 0]);
  const ancestor = createInstance([0], [], { children: [selected, sibling] });
  const unrelated = createInstance([1]);
  const preview = { children: [ancestor, unrelated] };
  const editor = new SpecEditor({
    state: {},
    services: { byId: () => preview }
  });

  editor.updatePreviewFocus([0, "navigation", 0]);

  assert.equal(selected.classList.contains("spec-focus-target"), true);
  assert.equal(selected.style.getPropertyValue("filter"), "");
  assert.equal(selected.style.getPropertyValue("z-index"), "1");
  assert.equal(ancestor.classList.contains("spec-focus-ancestor"), true);
  assert.equal(ancestor.style.getPropertyValue("filter"), "");
  assert.equal(sibling.style.getPropertyValue("filter"), "blur(1.5px)");
  assert.equal(unrelated.style.getPropertyValue("filter"), "blur(1.5px)");

  editor.updatePreviewFocus(null);

  assert.equal(selected.classList.contains("spec-focus-target"), false);
  assert.equal(selected.style.getPropertyValue("z-index"), "");
  assert.equal(sibling.classList.contains("spec-focus-dimmed"), false);
  assert.equal(sibling.style.getPropertyValue("filter"), "");
  assert.equal(unrelated.style.getPropertyValue("filter"), "");
});

test("keeps all descendants clear when a container Element is focused", async () => {
  const { SpecEditor } = await import("../browser/SpecEditor.mjs");
  const nestedChild = createInstance([0, "navigation", 0]);
  const nestedGrandchild = createInstance([0, "navigation", 0, "links", 0]);
  const selectedContainer = createInstance(
    [0],
    [],
    { children: [nestedChild, nestedGrandchild] }
  );
  const unrelated = createInstance([1]);
  const preview = { children: [selectedContainer, unrelated] };
  const editor = new SpecEditor({
    state: {},
    services: { byId: () => preview }
  });

  editor.updatePreviewFocus([0]);

  assert.equal(selectedContainer.classList.contains("spec-focus-target"), true);
  assert.equal(nestedChild.classList.contains("spec-focus-descendant"), true);
  assert.equal(nestedChild.style.getPropertyValue("filter"), "");
  assert.equal(nestedGrandchild.classList.contains("spec-focus-descendant"), true);
  assert.equal(nestedGrandchild.style.getPropertyValue("filter"), "");
  assert.equal(unrelated.style.getPropertyValue("filter"), "blur(1.5px)");
});
