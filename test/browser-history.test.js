const assert = require("node:assert/strict");
const test = require("node:test");

/** Creates a test window with a controllable URL and history stub. */
function createWindow(href) {
  const location = new URL(href);
  const history = {
    calls: [],
    state: { retained: true },
    pushState(state, title, url) {
      this.calls.push({ method: "push", state, title, url: url.href });
      this.state = state;
      location.href = url.href;
    },
    replaceState(state, title, url) {
      this.calls.push({ method: "replace", state, title, url: url.href });
      this.state = state;
      location.href = url.href;
    }
  };
  return { location, history };
}

/** Creates the controller using the supplied test selection and window. */
function createController(windowObject, options = {}) {
  return import("../frontend/browser/BrowserHistory.mjs").then(({ BrowserHistory }) =>
    new BrowserHistory({
      windowObject,
      getCurrentSelection: () => options.selection,
      getSelectionFilePath: (selection) =>
        selection.spec?.file || selection.workflow?.file || selection.screen?.file || null,
      getWorkspaceContext: () => options.workspaceContext || null,
      getCanvasSpecuxTarget: () => options.canvasTarget ||
        (options.selection?.screen?.id
          ? `screen/${options.selection.screen.id}/screen.yml`
          : null),
      isRenderOnly: () => false,
      isUpdatesSuppressed: () => false
    })
  );
}

/** Checks that URL parsing recovers the expected selection fields, including nested paths. */
test("reads editor selections and nested Element paths from the URL", async () => {
  const windowObject = createWindow(
    "http://localhost/?file=screens%2Fhome%2Fscreen.yml&view=screen&screen=home&instancePath=%5B%22layout%22%2C%22content%22%2C0%5D"
  );
  const controller = await createController(windowObject);
  assert.deepEqual(controller.selectionFromLocation(), {
    view: "url",
    file: "screens/home/screen.yml",
    requestedView: "screen",
    screen: { id: "home" },
    owner: null,
    instancePath: ["layout", "content", 0],
  });
});

test("reads linked document, workflow node, and encoded SpecUX fragment from the URL", async () => {
  const windowObject = createWindow(
    "http://localhost/?file=screens%2Fhome%2Fspecs%2Fscreen.md&view=spec&screen=home&owner=screen&linked=screens%2Fhome%2Fworkflows%2Fcheckout.mmd&node=save&specux=ignored#specux=screen%2Fhome%2Fscreen.yml%3Fplacement%3Ddialog.title%26placement%3Ddialog.save%26state%3Ddialog-open"
  );
  const controller = await createController(windowObject);
  assert.deepEqual(controller.selectionFromLocation(), {
    view: "url",
    file: "screens/home/specs/screen.md",
    requestedView: "spec",
    screen: { id: "home" },
    owner: "screen",
    instancePath: null,
    linkedFile: "screens/home/workflows/checkout.mmd",
    nodeId: "save",
    canvasTarget:
      "screen/home/screen.yml?placement=dialog.title&placement=dialog.save&state=dialog-open"
  });
});

test("writes primary, linked, node, and complete canvas contexts to separate URL fields", async () => {
  const windowObject = createWindow("http://localhost/");
  const options = {
    selection: {
      view: "spec",
      screen: { id: "home", file: "screens/home/screen.yml" },
      spec: { file: "screens/home/specs/screen.md", owner: "screen" }
    },
    workspaceContext: {
      dock: {
        primary: { view: "spec", file: "screens/home/specs/screen.md" },
        linked: [{ view: "workflow", file: "screens/home/workflows/checkout.mmd", nodeId: "save" }]
      }
    },
    canvasTarget:
      "screen/home/screen.yml?placement=dialog.title&placement=dialog.save&state=dialog-open"
  };
  const controller = await createController(windowObject, options);
  controller.sync();

  const url = new URL(windowObject.history.calls[0].url);
  assert.equal(url.searchParams.get("file"), "screens/home/specs/screen.md");
  assert.equal(url.searchParams.get("view"), "spec");
  assert.equal(url.searchParams.get("linked"), "screens/home/workflows/checkout.mmd");
  assert.equal(url.searchParams.get("node"), "save");
  assert.equal(url.searchParams.has("placement"), false);
  assert.equal(
    new URLSearchParams(url.hash.slice(1)).get("specux"),
    options.canvasTarget
  );
  assert.equal(
    windowObject.history.calls[0].state.specuxEditor.context.canvasTarget,
    options.canvasTarget
  );
});

test("pushes history only when the displayed Screen changes", async () => {
  const windowObject = createWindow("http://localhost/");
  const options = {
    selection: {
      view: "workflow",
      screen: { id: "home", file: "screens/home/screen.yml" },
      workflow: { file: "screens/home/workflows/checkout.mmd" }
    },
    canvasTarget: "screen/home/screen.yml"
  };
  const controller = await createController(windowObject, options);
  controller.sync();
  options.canvasTarget = "screen/settings/screen.yml?placement=save";
  controller.sync();
  options.selection = {
    view: "spec",
    screen: { id: "home", file: "screens/home/screen.yml" },
    spec: { file: "screens/home/specs/screen.md", owner: "screen" }
  };
  controller.sync();

  assert.deepEqual(windowObject.history.calls.map(({ method }) => method), [
    "replace",
    "push",
    "replace"
  ]);
  assert.equal(
    new URLSearchParams(new URL(windowObject.history.calls[2].url).hash.slice(1))
      .get("specux"),
    "screen/settings/screen.yml?placement=save"
  );
});

/** Checks that history entries capture the selection without discarding unrelated state. */
test("writes browser history while retaining unrelated history state", async () => {
  const windowObject = createWindow("http://localhost/?instancePath=%5B0%5D");
  const options = {
    selection: {
      view: "screen",
      screen: { id: "home", file: "screens/home/screen.yml" },
      selectedPlacement: { instancePath: ["layout", "content", 0] }
    }
  };
  const controller = await createController(windowObject, options);
  controller.sync();
  assert.equal(windowObject.history.calls[0].method, "replace");
  assert.equal(new URL(windowObject.history.calls[0].url).searchParams.has("instancePath"), false);
  assert.equal(windowObject.history.calls[0].state.retained, true);
  assert.deepEqual(windowObject.history.calls[0].state.specuxEditor.selection.selectedPlacement, {
    instancePath: ["layout", "content", 0]
  });

  options.selection = {
    view: "screen",
    screen: { id: "sign-in", file: "screens/sign-in/screen.yml" }
  };
  controller.sync();
  assert.equal(windowObject.history.calls[1].method, "push");

  options.selection = {
    view: "theme",
    screen: { id: "sign-in", file: "screens/sign-in/screen.yml" },
    file: "theme.yml"
  };
  controller.sync();
  assert.equal(windowObject.history.calls[2].method, "replace");
});
