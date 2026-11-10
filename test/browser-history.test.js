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
      getSelectionFilePath: (selection) => selection.screen?.file || null,
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
});
