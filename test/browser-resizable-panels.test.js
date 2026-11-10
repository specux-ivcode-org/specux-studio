const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

/** Builds a resizer handle stub that records its pointer and accessibility state. */
function createHandle() {
  const classes = new Set();
  return {
    attributes: {},
    dataset: {},
    listeners: new Map(),
    capturedPointer: null,
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name)
    },
    children: new Set(),
    contains(node) {
      return this === node || this.children.has(node);
    },
    matches(selector) {
      return selector === ":hover" && Boolean(this.hovered);
    },
    querySelector() {
      return this.firstFocusable || null;
    },
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {
      this.focused = true;
    },
    setPointerCapture(pointerId) {
      this.capturedPointer = pointerId;
    },
    hasPointerCapture(pointerId) {
      return this.capturedPointer === pointerId;
    },
    releasePointerCapture(pointerId) {
      this.capturedPointer = null;
    }
  };
}

/** Builds the fake DOM, storage, and panel controls used by the controller tests. */
function createHarness(savedLayout) {
  const values = new Map(savedLayout ? [["specux-studio.layout.v1", savedLayout]] : []);
  const properties = new Map();
  const handles = new Map([
    ["sidebar-resizer", createHandle()],
    ["inspector-resizer", createHandle()],
    ["project-sidebar", createHandle()],
    ["details-inspector", createHandle()],
    ["sidebar-edge-trigger", createHandle()],
    ["inspector-edge-trigger", createHandle()],
    ["sidebar-mode", createHandle()],
    ["inspector-mode", createHandle()]
  ]);
  const bodyClasses = new Set();
  const messages = [];
  const timers = new Map();
  let now = 0;
  let nextTimerId = 1;
  const windowObject = {
    localStorage: {
      getItem(key) {
        return values.get(key) || null;
      },
      setItem(key, value) {
        values.set(key, value);
      }
    },
    addEventListener() {},
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advanceTime(delay) {
      now += delay;
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.due <= now)
        .sort((left, right) => left[1].due - right[1].due);
      for (const [id, timer] of dueTimers) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  const documentObject = {
    listeners: new Map(),
    hitTarget: null,
    body: { classList: {
      add: (name) => bodyClasses.add(name),
      remove: (name) => bodyClasses.delete(name)
    } },
    elementFromPoint() {
      return this.hitTarget;
    },
    addEventListener(type, handler, capture) {
      this.listeners.set(type, { handler, capture });
    },
    getElementById: (id) => handles.get(id) || null
  };
  const workspace = {
    dataset: {},
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      }
    }
  };
  return { windowObject, documentObject, workspace, handles, bodyClasses, properties, values, messages };
}

/** Saved widths are clamped on restore; both keyboard and pointer adjustments are written back to storage. */
test("restores clamped panel sizes and persists keyboard and pointer resizing", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness('{"sidebar":999,"inspector":100}');
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  assert.equal(harness.properties.get("--sidebar-width"), "420px");
  assert.equal(harness.properties.get("--inspector-width"), "220px");
  assert.equal(harness.handles.get("sidebar-resizer").attributes["aria-valuenow"], "420");

  const inspector = harness.handles.get("inspector-resizer");
  let prevented = false;
  inspector.listeners.get("keydown")({
    key: "ArrowLeft",
    shiftKey: false,
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(harness.properties.get("--inspector-width"), "232px");
  assert.deepEqual(JSON.parse(harness.values.get("specux-studio.layout.v1")), {
    sidebar: 420,
    inspector: 232,
    sidebarMode: "show",
    inspectorMode: "show"
  });

  const sidebar = harness.handles.get("sidebar-resizer");
  sidebar.listeners.get("pointerdown")({
    button: 0,
    pointerId: 5,
    clientX: 100,
    preventDefault() {}
  });
  assert.equal(harness.bodyClasses.has("panel-resizing"), true);
  sidebar.listeners.get("pointermove")({ pointerId: 5, clientX: 80 });
  sidebar.listeners.get("pointerup")({ pointerId: 5 });
  assert.equal(harness.properties.get("--sidebar-width"), "400px");
  assert.deepEqual(JSON.parse(harness.values.get("specux-studio.layout.v1")), {
    sidebar: 400,
    inspector: 232,
    sidebarMode: "show",
    inspectorMode: "show"
  });
  assert.equal(harness.bodyClasses.has("panel-resizing"), false);
  assert.deepEqual(harness.messages, []);
});

/** The two sidebar toggles remain at opposite topbar edges and expose labels to assistive technology. */
test("places icon-only sidebar controls at opposite topbar edges with accessible labels", () => {
  const html = fs.readFileSync(path.join(__dirname, "../frontend/index.html"), "utf8");
  const sidebarButton = html.match(/<button(?=[^>]*id="sidebar-mode")[\s\S]*?<\/button>/)?.[0];
  const inspectorButton = html.match(/<button(?=[^>]*id="inspector-mode")[\s\S]*?<\/button>/)?.[0];
  assert.ok(sidebarButton);
  assert.ok(inspectorButton);
  assert.ok(html.indexOf('id="sidebar-mode"') < html.indexOf('<div class="brand"'));
  assert.ok(html.indexOf('id="inspector-mode"') > html.indexOf('id="reset-project"'));
  for (const button of [sidebarButton, inspectorButton]) {
    assert.match(button, /aria-controls="[^"]+"/);
    assert.match(button, /data-mode="show"/);
    assert.match(button, /<svg[^>]*aria-hidden="true"[^>]*>/);
    assert.doesNotMatch(button, /panel-mode-icon__pointer/);
    assert.equal(
      button.replace(/^[\s\S]*?>/, "").replace(/<\/button>\s*$/, "").replace(/<svg[\s\S]*?<\/svg>/, "").trim(),
      ""
    );
  }
  assert.match(sidebarButton, /data-side="left"/);
  assert.match(inspectorButton, /data-side="right"/);
  const styles = fs.readFileSync(path.join(__dirname, "../frontend/styles.css"), "utf8");
  assert.match(styles, /data-mode="hover"\]\s+\.panel-mode-icon__show\s*\{\s*display:\s*none/);
  assert.match(styles, /data-side="right"\]\s+\.panel-mode-icon\s*\{\s*transform:\s*scaleX\(-1\)/);
});

/** Each sidebar retains its own visibility mode when switching between persistent display and hover access. */
test("toggles independent visibility modes between Show and Hover to show", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  const sidebar = harness.handles.get("project-sidebar");
  const sidebarTrigger = harness.handles.get("sidebar-edge-trigger");
  const sidebarResizer = harness.handles.get("sidebar-resizer");
  const sidebarModeButton = harness.handles.get("sidebar-mode");
  assert.equal(sidebarModeButton.dataset.mode, "show");
  assert.equal(sidebarModeButton.attributes["aria-label"], "Project structure: Show. Activate to switch to Hover to show.");
  assert.equal(sidebarModeButton.attributes.title, sidebarModeButton.attributes["aria-label"]);
  sidebarModeButton.listeners.get("click")();
  assert.equal(harness.workspace.dataset.sidebarMode, "hover");
  assert.equal(sidebarModeButton.dataset.mode, "hover");
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebarTrigger.hidden, false);
  assert.equal(sidebarResizer.hidden, true);
  assert.equal(sidebarModeButton.attributes["aria-label"], "Project structure: Hover to show. Activate to switch to Show.");
  assert.doesNotMatch(sidebarModeButton.attributes["aria-label"], /Hide/);
  sidebarTrigger.listeners.get("pointerenter")();
  harness.windowObject.advanceTime(999);
  assert.equal(sidebar.hidden, true);
  harness.windowObject.advanceTime(1);
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebar.attributes["aria-hidden"], "false");
  assert.equal(sidebarTrigger.attributes["aria-expanded"], "true");

  sidebarTrigger.listeners.get("pointerleave")();
  sidebar.listeners.get("pointerenter")();
  harness.windowObject.advanceTime(2000);
  assert.equal(sidebar.hidden, false);
  sidebar.listeners.get("pointerleave")();
  harness.windowObject.advanceTime(999);
  assert.equal(sidebar.hidden, false);
  harness.windowObject.advanceTime(1);
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebarTrigger.attributes["aria-expanded"], "false");

  harness.handles.get("inspector-mode").listeners.get("click")();
  assert.equal(harness.workspace.dataset.inspectorMode, "hover");
  assert.equal(harness.handles.get("inspector-mode").dataset.mode, "hover");
  assert.equal(harness.handles.get("inspector-mode").attributes["aria-label"], "Properties: Hover to show. Activate to switch to Show.");
  assert.equal(harness.handles.get("inspector-edge-trigger").hidden, false);
  assert.equal(harness.handles.get("details-inspector").hidden, true);
  sidebarModeButton.listeners.get("click")();
  assert.equal(harness.workspace.dataset.sidebarMode, "show");
  assert.equal(sidebarModeButton.dataset.mode, "show");
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebarTrigger.hidden, true);
  assert.equal(sidebarResizer.hidden, false);
  assert.equal(sidebarModeButton.attributes["aria-label"], "Project structure: Show. Activate to switch to Hover to show.");
  sidebarModeButton.listeners.get("click")();
  assert.equal(harness.workspace.dataset.sidebarMode, "hover");
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebarTrigger.hidden, false);
  assert.equal(sidebarResizer.hidden, true);
  assert.equal(harness.workspace.dataset.inspectorMode, "hover");
  assert.equal(harness.handles.get("inspector-edge-trigger").hidden, false);
  assert.equal(harness.handles.get("details-inspector").hidden, true);
  assert.equal(harness.messages.length, 0);
});

/** Exercises preview resizing and checks the updated dimensions and saved source. */
test("resizes open hover overlays from their inner edges without dismissing them", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  for (const [panelName, modeButtonId, triggerId, panelId, handleId, startX, endX, key] of [
    ["sidebar", "sidebar-mode", "sidebar-edge-trigger", "project-sidebar", "sidebar-resizer", 100, 130, "ArrowRight"],
    ["inspector", "inspector-mode", "inspector-edge-trigger", "details-inspector", "inspector-resizer", 100, 70, "ArrowLeft"]
  ]) {
    const modeButton = harness.handles.get(modeButtonId);
    const trigger = harness.handles.get(triggerId);
    const panel = harness.handles.get(panelId);
    const handle = harness.handles.get(handleId);
    modeButton.listeners.get("click")();
    trigger.listeners.get("pointerenter")();
    harness.windowObject.advanceTime(1000);

    const initialWidth = controller.widths[panelName];
    assert.equal(panel.hidden, false);
    assert.equal(handle.hidden, false);
    harness.documentObject.listeners.get("pointerdown").handler({ target: handle });
    assert.equal(panel.hidden, false);

    handle.listeners.get("pointerdown")({
      button: 0,
      pointerId: 20,
      clientX: startX,
      preventDefault() {}
    });
    panel.listeners.get("pointerleave")();
    harness.windowObject.advanceTime(1500);
    assert.equal(panel.hidden, false);

    handle.listeners.get("pointermove")({ pointerId: 20, clientX: endX });
    handle.listeners.get("pointerup")({ pointerId: 20 });
    assert.equal(controller.widths[panelName], initialWidth + 30);
    assert.equal(panel.hidden, false);
    assert.equal(JSON.parse(harness.values.get("specux-studio.layout.v1"))[panelName], initialWidth + 30);

    let prevented = false;
    handle.listeners.get("keydown")({
      key,
      shiftKey: false,
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true);
    assert.equal(controller.widths[panelName], initialWidth + 42);
    assert.equal(JSON.parse(harness.values.get("specux-studio.layout.v1"))[panelName], initialWidth + 42);
  }

  const styles = fs.readFileSync(path.join(__dirname, "../frontend/styles.css"), "utf8");
  assert.match(styles, /data-sidebar-mode="hover"\]\s+\.sidebar-resizer:not\(\[hidden\]\)\s*\{\s*position:\s*absolute/);
  assert.match(styles, /data-inspector-mode="hover"\]\s+\.inspector-resizer:not\(\[hidden\]\)\s*\{\s*position:\s*absolute/);
});

/** A resized panel closes only after the outside-pointer delay, not immediately on release. */
test("closes resized hover overlays one second after pointer release outside", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  for (const [modeButtonId, triggerId, panelId, handleId, panelName] of [
    ["sidebar-mode", "sidebar-edge-trigger", "project-sidebar", "sidebar-resizer", "sidebar"],
    ["inspector-mode", "inspector-edge-trigger", "details-inspector", "inspector-resizer", "inspector"]
  ]) {
    const modeButton = harness.handles.get(modeButtonId);
    const trigger = harness.handles.get(triggerId);
    const panel = harness.handles.get(panelId);
    const handle = harness.handles.get(handleId);
    modeButton.listeners.get("click")();
    trigger.listeners.get("pointerenter")();
    harness.windowObject.advanceTime(1000);
    assert.equal(panel.hidden, false);

    const initialWidth = controller.widths[panelName];
    handle.hovered = true;
    handle.listeners.get("pointerdown")({
      button: 0,
      pointerId: 31,
      clientX: 100,
      preventDefault() {}
    });
    harness.documentObject.activeElement = handle;
    handle.listeners.get("pointermove")({ pointerId: 31, clientX: panelName === "sidebar" ? 120 : 80 });
    assert.equal(controller.widths[panelName], initialWidth + 20);

    // Pointer capture can suppress pointerleave while dragging; release outside both targets.
    trigger.hovered = false;
    panel.hovered = false;
    handle.hovered = false;
    handle.listeners.get("pointerup")({ pointerId: 31, clientX: 600, clientY: 400 });
    assert.equal(JSON.parse(harness.values.get("specux-studio.layout.v1"))[panelName], initialWidth + 20);
    harness.windowObject.advanceTime(999);
    assert.equal(panel.hidden, false);
    harness.windowObject.advanceTime(1);
    assert.equal(panel.hidden, true);
    assert.equal(trigger.attributes["aria-expanded"], "false");
  }
});

/** Checks that selection and preview state remain consistent through the interaction. */
test("keeps Details hover available after inspector rerenders and closes only outside both targets", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  const modeButton = harness.handles.get("inspector-mode");
  const trigger = harness.handles.get("inspector-edge-trigger");
  const panel = harness.handles.get("details-inspector");
  modeButton.listeners.get("click")();
  trigger.listeners.get("pointerenter")();
  harness.windowObject.advanceTime(1000);
  assert.equal(panel.hidden, false);

  panel.classList.toggle("layers-details-open", true);
  trigger.hovered = false;
  panel.hovered = true;
  trigger.listeners.get("pointerleave")();
  harness.documentObject.listeners.get("pointerdown").handler({ target: panel });
  assert.equal(panel.hidden, false);
  harness.windowObject.advanceTime(150);
  assert.equal(panel.hidden, false);

  panel.hovered = false;
  trigger.hovered = true;
  panel.listeners.get("pointerleave")();
  harness.windowObject.advanceTime(2000);
  assert.equal(panel.hidden, false);

  trigger.hovered = false;
  trigger.listeners.get("pointerleave")();
  harness.windowObject.advanceTime(999);
  assert.equal(panel.hidden, false);
  harness.windowObject.advanceTime(1);
  assert.equal(panel.hidden, true);

  const styles = fs.readFileSync(path.join(__dirname, "../frontend/styles.css"), "utf8");
  assert.match(styles, /\.workspace \.inspector\[hidden\]\s*\{\s*display:\s*none\s*;\s*\}/);

  trigger.listeners.get("pointerenter")();
  harness.windowObject.advanceTime(1000);
  assert.equal(panel.hidden, false);
  assert.equal(trigger.attributes["aria-expanded"], "true");
  assert.equal(harness.messages.length, 0);
});

/** Leaving either sidebar starts a timer, and entering its panel or trigger cancels the pending close. */
test("delays pointer-leave dismissal for one second and cancels it on either target for both sidebars", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  for (const [modeButtonId, triggerId, panelId] of [
    ["sidebar-mode", "sidebar-edge-trigger", "project-sidebar"],
    ["inspector-mode", "inspector-edge-trigger", "details-inspector"]
  ]) {
    const modeButton = harness.handles.get(modeButtonId);
    const trigger = harness.handles.get(triggerId);
    const panel = harness.handles.get(panelId);
    modeButton.listeners.get("click")();
    trigger.listeners.get("pointerenter")();
    harness.windowObject.advanceTime(1000);
    assert.equal(panel.hidden, false);

    panel.listeners.get("pointerleave")();
    harness.windowObject.advanceTime(999);
    assert.equal(panel.hidden, false);
    panel.listeners.get("pointerenter")();
    harness.windowObject.advanceTime(2000);
    assert.equal(panel.hidden, false);

    panel.listeners.get("pointerleave")();
    harness.windowObject.advanceTime(999);
    trigger.listeners.get("pointerenter")();
    harness.windowObject.advanceTime(2000);
    assert.equal(panel.hidden, false);

    trigger.listeners.get("pointerleave")();
    harness.windowObject.advanceTime(999);
    assert.equal(panel.hidden, false);
    harness.windowObject.advanceTime(1);
    assert.equal(panel.hidden, true);
  }
});

/** An outside selection closes the hover panel even if an inner control retains focus or pointer capture. */
test("dismisses hover overlays on outside selection despite focus and pointer capture", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  const modeButton = harness.handles.get("inspector-mode");
  const trigger = harness.handles.get("inspector-edge-trigger");
  const panel = harness.handles.get("details-inspector");
  modeButton.listeners.get("click")();
  trigger.listeners.get("pointerenter")();
  harness.windowObject.advanceTime(1000);
  assert.equal(panel.hidden, false);

  const focusedControl = createHandle();
  panel.children.add(focusedControl);
  harness.documentObject.activeElement = focusedControl;
  assert.equal(panel.contains(harness.documentObject.activeElement), true);

  const screenItem = createHandle();
  harness.documentObject.hitTarget = screenItem;
  harness.documentObject.listeners.get("pointerdown").handler({
    target: focusedControl,
    clientX: 500,
    clientY: 300,
    composedPath: () => [focusedControl, panel, harness.documentObject]
  });

  assert.equal(harness.documentObject.activeElement, focusedControl);
  assert.equal(panel.hidden, true);
  assert.equal(trigger.attributes["aria-expanded"], "false");

  trigger.listeners.get("click")();
  assert.equal(panel.hidden, false);
  harness.documentObject.hitTarget = panel;
  harness.documentObject.listeners.get("pointerdown").handler({
    target: screenItem,
    clientX: 500,
    clientY: 300,
    composedPath: () => [screenItem, harness.documentObject]
  });
  assert.equal(panel.hidden, false);

  harness.documentObject.hitTarget = trigger;
  harness.documentObject.listeners.get("pointerdown").handler({
    target: screenItem,
    clientX: 500,
    clientY: 300,
    composedPath: () => [screenItem, harness.documentObject]
  });
  assert.equal(panel.hidden, false);

  const sidebarModeButton = harness.handles.get("sidebar-mode");
  const sidebarTrigger = harness.handles.get("sidebar-edge-trigger");
  const sidebar = harness.handles.get("project-sidebar");
  sidebarModeButton.listeners.get("click")();
  sidebarTrigger.listeners.get("pointerenter")();
  harness.windowObject.advanceTime(1000);
  assert.equal(sidebar.hidden, false);
  harness.documentObject.hitTarget = screenItem;
  harness.documentObject.listeners.get("pointerdown").handler({
    target: screenItem,
    clientX: 500,
    clientY: 300
  });
  assert.equal(sidebar.hidden, true);
});

/** Exercises the relevant input paths and checks their resulting editor state. */
test("supports keyboard access to and dismissal of a hover panel", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness();
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  const modeButton = harness.handles.get("sidebar-mode");
  const trigger = harness.handles.get("sidebar-edge-trigger");
  const panel = harness.handles.get("project-sidebar");
  const firstControl = createHandle();
  panel.firstFocusable = firstControl;

  modeButton.listeners.get("click")();
  trigger.listeners.get("click")();
  assert.equal(panel.hidden, false);

  let tabPrevented = false;
  trigger.listeners.get("keydown")({
    key: "Tab",
    currentTarget: trigger,
    preventDefault() { tabPrevented = true; }
  });
  assert.equal(tabPrevented, true);
  assert.equal(firstControl.focused, true);

  let escapePrevented = false;
  panel.listeners.get("keydown")({
    key: "Escape",
    currentTarget: panel,
    preventDefault() { escapePrevented = true; }
  });
  assert.equal(escapePrevented, true);
  assert.equal(panel.hidden, true);
  assert.equal(trigger.focused, true);
});

/** Legacy Hide preferences are converted during load and leave an edge trigger for reopening the panel. */
test("migrates saved Hide modes to Hover to show and keeps the edge trigger available", async () => {
  const { ResizablePanels } = await import("../frontend/browser/ResizablePanels.mjs");
  const harness = createHarness('{"sidebar":300,"inspector":310,"sidebarMode":"hide","inspectorMode":"hover"}');
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  assert.equal(harness.handles.get("project-sidebar").hidden, true);
  assert.equal(harness.handles.get("sidebar-edge-trigger").hidden, false);
  assert.equal(harness.handles.get("details-inspector").hidden, true);
  assert.equal(harness.handles.get("inspector-edge-trigger").hidden, false);
  assert.equal(harness.handles.get("sidebar-mode").attributes.title, "Project structure: Hover to show. Activate to switch to Show.");
  assert.equal(harness.handles.get("inspector-mode").attributes.title, "Properties: Hover to show. Activate to switch to Show.");
  assert.deepEqual(JSON.parse(harness.values.get("specux-studio.layout.v1")), {
    sidebar: 300,
    inspector: 310,
    sidebarMode: "hover",
    inspectorMode: "hover"
  });
  assert.equal(harness.messages.length, 0);
});

/** Checks that selection and preview state remain consistent through the interaction. */
test("keeps hover sidebars above editor annotation overlays", () => {
  const styles = fs.readFileSync(path.join(__dirname, "../frontend/styles.css"), "utf8");
  const canvasRule = styles.match(/\.canvas\s*\{\s*position:\s*relative;([\s\S]*?)\}/)?.[1];
  assert.ok(canvasRule);
  assert.match(canvasRule, /isolation:\s*isolate/);
});
