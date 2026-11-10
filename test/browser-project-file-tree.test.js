const assert = require("node:assert/strict");
const test = require("node:test");

/** Creates a DOM-like node fixture with child and event support. */
function createNode(tagName, className = "", textContent = "") {
  return {
    tagName,
    className,
    textContent,
    dataset: {},
    children: [],
    listeners: new Map(),
    open: false,
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    querySelectorAll(selector) {
      if (selector !== ".file-tree-folder") return [];
      return [
        ...(this.className === "file-tree-folder" ? [this] : []),
        ...this.children.flatMap((child) => child.querySelectorAll?.(selector) || [])
      ];
    }
  };
}

/** Finds the rendered folder node for a project-relative directory path. */
function findFolder(container, directoryPath) {
  return container.querySelectorAll(".file-tree-folder")
    .find((folder) => folder.dataset.directoryPath === directoryPath);
}

/** Checks that the preview output reflects the supplied project and selection data. */
test("renders sorted project files and preserves expanded directory state", async () => {
  const { ProjectFileTree } = await import("../frontend/browser/ProjectFileTree.mjs");
  const container = createNode("div");
  const fileTree = new ProjectFileTree({
    container,
    createElement: createNode,
    getFilePaths: () => [
      "screens/sign-in/screen.yml",
      "project.yml",
      "screens/home/screen.yml",
      "materials/demo.stml",
      "screens/home/specs/screen.md"
    ],
    renderFile: (file) => createNode("button", "file-tree-file", file.name)
  });

  fileTree.expandPath("screens/home/screen.yml");
  fileTree.render();
  assert.equal(container.children[0].dataset.directoryPath, "materials");
  assert.equal(findFolder(container, "screens").open, true);
  assert.equal(findFolder(container, "screens/home").open, true);
  assert.equal(findFolder(container, "screens/home/specs").open, false);
  assert.equal(findFolder(container, "screens/sign-in").open, false);

  fileTree.expandPath("materials/demo.stml");
  fileTree.render();
  assert.equal(findFolder(container, "materials").open, true);
  const homeFolder = findFolder(container, "screens/home");
  homeFolder.open = false;
  homeFolder.listeners.get("toggle")();
  assert.equal(findFolder(container, "materials").open, true);
  homeFolder.open = true;
  homeFolder.listeners.get("toggle")();
  fileTree.render();
  assert.equal(findFolder(container, "screens/home").open, true);
  assert.equal(findFolder(container, "materials").open, true);

  const screensFolder = findFolder(container, "screens");
  screensFolder.open = false;
  screensFolder.listeners.get("toggle")();
  fileTree.render();
  assert.equal(findFolder(container, "screens").open, false);

  fileTree.reveal("screens/sign-in/screen.yml");
  assert.equal(findFolder(container, "screens").open, true);
  assert.equal(findFolder(container, "screens/sign-in").open, true);
});
