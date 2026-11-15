const assert = require("node:assert/strict");
const test = require("node:test");

/** Creates the minimum persistence state and services for autosave tests. */
function createPersistenceHarness(overrides = {}) {
  const state = {
    project: { name: "Example" },
    screens: [],
    materialFiles: new Map(),
    theme: {},
    isSaving: false,
    dirtyFiles: new Map(),
    deletedFiles: new Map(),
    fileHashes: new Map(),
    externalWriteConflicts: new Map(),
    invalidYamlFiles: new Map(),
    invalidWorkflowFiles: new Map(),
    workflowSources: new Map(),
    editVersion: 0,
    hasEdits: false,
    specSources: new Map(),
    createdSpecFiles: new Set(),
    createdWorkflowFiles: new Set(),
    createdScreenFiles: new Set(),
    createdMaterialFiles: new Set(),
    createdScreenFiles: new Set(),
    createdSpecFiles: new Set(),
    createdWorkflowFiles: new Set(),
    createdSpecDrafts: new Map(),
    elementSpecOwners: new Map(),
    projectFilePaths: [],
    ...overrides.state
  };
  const timers = new Map();
  const calls = [];
  let nextTimerId = 0;
  const status = {
    dataset: {},
    attributes: {},
    textContent: "should be cleared",
    title: "",
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const services = {
    byId: (id) => id === "autosave-status" ? status
        : { disabled: false },
    showEditorMessage() {},
    renderNavigation() {},
    setScreenYamlStatus() {},
    fetcher: async () => ({ ok: true, json: async () => ({ saved: ["project.yml"] }) }),
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    now: () => 0,
    ...overrides.services
  };

  return import("../frontend/browser/ProjectPersistence.mjs").then(
    ({ ProjectPersistence }) => ({
      persistence: new ProjectPersistence({ state, services }),
      state,
      services,
      timers,
      calls,
      status
    })
  );
}

test("shows icon-only autosave states without manual save or reset controls", async () => {
  const harness = await createPersistenceHarness();
  harness.persistence.updateSaveControls();
  assert.equal(harness.status.dataset.state, "saved");
  assert.equal(harness.status.attributes["aria-label"], "All changes saved");
  assert.equal(harness.status.textContent, "");

  harness.persistence.setPersistenceStatus("pending", "Pending changes");
  assert.equal(harness.status.attributes["aria-busy"], "true");
  assert.equal(harness.status.attributes["aria-label"], "Changes queued for autosave");

  harness.persistence.setPersistenceStatus("saving", "Saving changes");
  assert.equal(harness.status.dataset.state, "saving");
  assert.equal(harness.status.attributes["aria-label"], "Saving changes");

  harness.persistence.setPersistenceStatus("error", "External file changes need review");
  assert.equal(
    harness.status.attributes["aria-label"],
    "Autosave needs attention: External file changes need review"
  );
  assert.equal(harness.status.attributes["aria-busy"], "false");
});

test("debounces autosave but enforces a maximum wait during continuous edits", async () => {
  let now = 100;
  const harness = await createPersistenceHarness({
    services: { now: () => now }
  });
  harness.persistence.save = async (options) => harness.calls.push(options);

  harness.persistence.markEdited("project.yml");
  assert.equal([...harness.timers.values()][0].delay, 500);
  now += 1900;
  harness.persistence.markEdited("project.yml");
  assert.equal(harness.timers.size, 1);
  assert.equal([...harness.timers.values()][0].delay, 100);
  assert.equal(harness.status.dataset.state, "pending");

  const timer = [...harness.timers.values()][0];
  timer.callback();
  await Promise.resolve();
  assert.deepEqual(harness.calls, [{ automatic: true }]);
});

test("keeps edits made during an in-flight save pending for a follow-up autosave", async () => {
  let acknowledge;
  const harness = await createPersistenceHarness({
    state: {
      editVersion: 1,
      dirtyFiles: new Map([["project.yml", 1]]),
      hasEdits: true
    },
    services: {
      fetcher: () => new Promise((resolve) => { acknowledge = resolve; })
    }
  });

  const saving = harness.persistence.save();
  assert.equal(harness.state.isSaving, true);
  harness.persistence.markEdited("project.yml");
  acknowledge({
    ok: true,
    json: async () => ({ saved: ["project.yml"] })
  });
  await saving;

  assert.equal(harness.state.dirtyFiles.get("project.yml"), 2);
  assert.equal(harness.state.hasEdits, true);
  assert.equal(harness.state.isSaving, false);
  assert.equal(harness.timers.size, 1);
  assert.equal([...harness.timers.values()][0].delay, 0);
});

test("reports autosave failures without clearing pending edits", async () => {
  const messages = [];
  const harness = await createPersistenceHarness({
    services: {
      fetcher: async () => { throw new Error("disk unavailable"); },
      showEditorMessage: (...args) => messages.push(args)
    }
  });

  harness.persistence.markEdited("project.yml");
  [...harness.timers.values()][0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.state.dirtyFiles.has("project.yml"), true);
  assert.equal(harness.status.dataset.state, "error");
  assert.match(harness.status.attributes["aria-label"], /disk unavailable/);
  assert.deepEqual(messages, [["Could not save changes", "disk unavailable"]]);
});

test("saves pending Workflow source after its editor closes", async () => {
  const workflowPath = "screens/home/workflows/cart.mmd";
  const workflowSource = "flowchart TD\n  A --> B";
  let requestBody;
  const harness = await createPersistenceHarness({
    state: {
      activeWorkflowPath: workflowPath,
      viewingWorkflow: true,
      workflowSources: new Map([[workflowPath, workflowSource]]),
      dirtyFiles: new Map([[workflowPath, 1]]),
      fileHashes: new Map([[workflowPath, "a".repeat(64)]]),
      hasEdits: true
    },
    services: {
      fetcher: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ saved: [workflowPath], hashes: {} })
        };
      }
    }
  });

  harness.state.activeWorkflowPath = null;
  harness.state.viewingWorkflow = false;
  await harness.persistence.save();

  assert.deepEqual(requestBody.files, [{
    path: workflowPath,
    content: workflowSource,
    expectedHash: "a".repeat(64)
  }]);
  assert.equal(harness.state.dirtyFiles.has(workflowPath), false);
  assert.equal(harness.state.hasEdits, false);
});

test("keeps a validation-blocked source dirty and does not send it to the save API", async () => {
  let requests = 0;
  const filePath = "screens/home/screen.yml";
  const harness = await createPersistenceHarness({
    state: {
      screens: [{
        id: "home",
        file: filePath,
        data: { name: "Home" },
        yamlSerializeVersion: 0
      }],
      dirtyFiles: new Map([[filePath, 1]]),
      invalidYamlFiles: new Map([[filePath, "Invalid YAML"]]),
      hasEdits: true
    },
    services: {
      fetcher: async () => {
        requests += 1;
        throw new Error("validation-blocked source was submitted");
      }
    }
  });

  await harness.persistence.save();

  assert.equal(requests, 0);
  assert.equal(harness.state.dirtyFiles.has(filePath), true);
  assert.equal(harness.status.dataset.state, "error");
  assert.match(harness.status.attributes["aria-label"], /Fix invalid source/);
});

test("restores invalid Screen source as a separate pending recovery draft", async () => {
  const stored = new Map();
  const screen = {
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlSource: "name: Home",
    yamlSourceMode: "data",
    yamlSerializeVersion: 0
  };
  const harness = await createPersistenceHarness({
    state: { screens: [screen] },
    services: {
      recoveryStorage: {
        getItem: (key) => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key)
      },
      recoveryStorageKey: "test-project-drafts"
    }
  });

  harness.persistence.saveRecoveryDraft(
    screen.file,
    "name: [",
    "Unexpected end of flow sequence",
    "screen"
  );
  harness.persistence.restoreRecoveryDrafts();

  assert.equal(screen.yamlSource, "name: [");
  assert.equal(screen.yamlSourceMode, "source");
  assert.equal(
    harness.state.invalidYamlFiles.get(screen.file),
    "Unexpected end of flow sequence"
  );
  assert.equal(harness.state.dirtyFiles.has(screen.file), true);
  assert.match(harness.status.attributes["aria-label"], /Fix invalid source/);
});

test("restores invalid Material and Workflow source drafts", async () => {
  for (const draft of [
    {
      filePath: "materials/card.stml",
      content: "---\nid: [\n",
      type: "material",
      invalidMap: "invalidYamlFiles"
    },
    {
      filePath: "screens/home/workflows/cart.mmd",
      content: "flowchart TD\n  A -->",
      type: "workflow",
      invalidMap: "invalidWorkflowFiles"
    }
  ]) {
    const stored = new Map();
    const material = {
      file: draft.filePath,
      id: "card",
      documentSource: "---\nid: card\n---\n<div></div>"
    };
    const harness = await createPersistenceHarness({
      state: {
        materialFiles: draft.type === "material"
          ? new Map([[draft.filePath, material]])
          : new Map(),
        workflowSources: draft.type === "workflow"
          ? new Map([[draft.filePath, "flowchart TD"]])
          : new Map()
      },
      services: {
        recoveryStorage: {
          getItem: (key) => stored.get(key) || null,
          setItem: (key, value) => stored.set(key, value),
          removeItem: (key) => stored.delete(key)
        },
        recoveryStorageKey: `recovery-${draft.type}`
      }
    });

    harness.persistence.saveRecoveryDraft(
      draft.filePath,
      draft.content,
      "Invalid source",
      draft.type
    );
    harness.persistence.restoreRecoveryDrafts();

    const source = draft.type === "material"
      ? material.documentSource
      : harness.state.workflowSources.get(draft.filePath);
    assert.equal(source, draft.content);
    assert.equal(harness.state[draft.invalidMap].get(draft.filePath), "Invalid source");
    assert.equal(harness.state.dirtyFiles.has(draft.filePath), true);
  }
});

test("keeps local edits pending until an external-write conflict is resolved", async () => {
  const stored = new Map();
  const harness = await createPersistenceHarness({
    state: {
      dirtyFiles: new Map([["project.yml", 1]]),
      hasEdits: true
    },
    services: {
      externalConflictStorage: {
        getItem: (key) => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key)
      },
      externalConflictStorageKey: "test-project-conflicts"
    }
  });

  harness.persistence.recordExternalWriteConflicts(
    [{ path: "project.yml", data: { name: "Local" } }],
    [{
      path: "project.yml",
      expectedHash: "a".repeat(64),
      diskHash: "b".repeat(64),
      diskContent: "name: Disk\n"
    }]
  );
  assert.equal(harness.persistence.scheduleAutosave(true), undefined);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.state.dirtyFiles.has("project.yml"), true);
  assert.equal(harness.status.dataset.state, "error");
  assert.ok(stored.has("test-project-conflicts"));

  await harness.persistence.resolveExternalWriteConflict("project.yml", "keep");
  assert.equal(harness.state.fileHashes.get("project.yml"), "b".repeat(64));
  assert.equal(harness.state.externalWriteConflicts.size, 0);
  assert.equal(harness.timers.size, 1);
  assert.equal([...harness.timers.values()][0].delay, 0);
  assert.equal(stored.has("test-project-conflicts"), false);
});

test("keeps a guarded local deletion when an external version is accepted as its baseline", async () => {
  const filePath = "screens/home/workflows/cart.mmd";
  const stored = new Map();
  let requestBody;
  const harness = await createPersistenceHarness({
    state: {
      dirtyFiles: new Map([[filePath, 1]]),
      deletedFiles: new Map([[filePath, 1]]),
      fileHashes: new Map([[filePath, "a".repeat(64)]])
    },
    services: {
      externalConflictStorage: {
        getItem: (key) => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key)
      },
      externalConflictStorageKey: "test-deletion-conflicts",
      fetcher: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ saved: [], deleted: [filePath], hashes: {} })
        };
      }
    }
  });

  harness.persistence.recordExternalWriteConflicts(
    [],
    [{
      path: filePath,
      expectedHash: "a".repeat(64),
      diskHash: "b".repeat(64),
      diskContent: "flowchart TD\n  external"
    }],
    [{ path: filePath, version: 1 }]
  );
  const conflict = JSON.parse(stored.get("test-deletion-conflicts"))[filePath];
  assert.equal(conflict.localDeleted, true);
  assert.equal(conflict.localContent, null);

  await harness.persistence.resolveExternalWriteConflict(filePath, "keep");
  assert.equal(harness.state.fileHashes.get(filePath), "b".repeat(64));
  assert.equal(harness.state.deletedFiles.has(filePath), true);

  await harness.persistence.save();
  assert.deepEqual(requestBody.deletes, [{
    path: filePath,
    expectedHash: "b".repeat(64)
  }]);
  assert.equal(harness.state.deletedFiles.has(filePath), false);
});

test("applies a merged external version against the new disk baseline", async () => {
  const applied = [];
  const harness = await createPersistenceHarness({
    state: {
      editVersion: 1,
      dirtyFiles: new Map([["workflow.mmd", 1]]),
      hasEdits: true
    },
    services: {
      applyExternalFileContent: async (...args) => applied.push(args)
    }
  });
  harness.state.externalWriteConflicts.set("workflow.mmd", {
    path: "workflow.mmd",
    diskHash: "c".repeat(64),
    diskContent: "flowchart TD\n  disk",
    localContent: "flowchart TD\n  local"
  });

  await harness.persistence.resolveExternalWriteConflict(
    "workflow.mmd",
    "merge",
    "flowchart TD\n  merged"
  );

  assert.deepEqual(applied, [[
    "workflow.mmd",
    "flowchart TD\n  merged",
    { merged: true }
  ]]);
  assert.equal(harness.state.fileHashes.get("workflow.mmd"), "c".repeat(64));
  assert.equal(harness.state.externalWriteConflicts.size, 0);
  assert.equal(harness.state.dirtyFiles.get("workflow.mmd"), 2);
  assert.equal([...harness.timers.values()][0].delay, 0);
});

test("coalesces project edits and restores snapshots through undo and redo", async () => {
  const project = { name: "Original" };
  const harness = await createPersistenceHarness({
    state: {
      project,
      fileHashes: new Map([["project.yml", "a".repeat(64)]])
    },
    services: {
      captureEditSnapshot: () => ({
        files: { "project.yml": { data: { ...project } } },
        project: { ...project }
      }),
      applyEditSnapshot: async (snapshot) => {
        Object.assign(project, snapshot.project);
      }
    }
  });
  harness.persistence.initializeEditHistory();

  project.name = "Edited";
  harness.persistence.markEdited("project.yml", { coalesce: true });
  project.name = "Edited again";
  harness.persistence.markEdited("project.yml", { coalesce: true });

  assert.equal(harness.persistence.undoStack.length, 1);
  await harness.persistence.undo();
  assert.equal(project.name, "Original");
  assert.equal(harness.state.dirtyFiles.has("project.yml"), true);
  await harness.persistence.redo();
  assert.equal(project.name, "Edited again");
  assert.equal(harness.state.dirtyFiles.has("project.yml"), true);

  project.name = "A later typing group";
  harness.persistence.markEdited("project.yml", { coalesce: true });
  assert.equal(harness.persistence.undoStack.length, 2);
  harness.persistence.closeEditHistoryGroup();
  project.name = "A different edit action";
  harness.persistence.markEdited("project.yml");
  assert.equal(harness.persistence.undoStack.length, 3);
});

test("undo and redo of a persisted workflow deletion retain a guarded delete", async () => {
  const workflowPath = "screens/home/workflows/cart.mmd";
  const workflowSources = new Map([[workflowPath, "flowchart TD"]]);
  const harness = await createPersistenceHarness({
    state: {
      workflowSources,
      fileHashes: new Map([[workflowPath, "b".repeat(64)]])
    },
    services: {
      captureEditSnapshot: () => ({
        files: Object.fromEntries([...workflowSources].map(([path, content]) => [
          path,
          { content }
        ])),
        workflowSources: [...workflowSources]
      }),
      applyEditSnapshot: async (snapshot) => {
        workflowSources.clear();
        for (const [path, content] of snapshot.workflowSources) {
          workflowSources.set(path, content);
        }
      }
    }
  });
  harness.persistence.initializeEditHistory();

  workflowSources.delete(workflowPath);
  harness.persistence.markDeleted(workflowPath);
  assert.equal(harness.state.deletedFiles.get(workflowPath), 1);

  await harness.persistence.undo();
  assert.equal(workflowSources.get(workflowPath), "flowchart TD");
  assert.equal(harness.state.deletedFiles.has(workflowPath), false);
  assert.equal(harness.state.dirtyFiles.has(workflowPath), true);

  await harness.persistence.redo();
  assert.equal(workflowSources.has(workflowPath), false);
  assert.equal(harness.state.deletedFiles.has(workflowPath), true);
});

test("autosaves a guarded file deletion and clears only its acknowledged version", async () => {
  const workflowPath = "screens/home/workflows/cart.mmd";
  let requestBody;
  const harness = await createPersistenceHarness({
    state: {
      dirtyFiles: new Map([[workflowPath, 1]]),
      deletedFiles: new Map([[workflowPath, 1]]),
      fileHashes: new Map([[workflowPath, "e".repeat(64)]])
    },
    services: {
      fetcher: async (url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ saved: [], deleted: [workflowPath], hashes: {} })
        };
      }
    }
  });

  await harness.persistence.save();

  assert.deepEqual(requestBody.files, []);
  assert.deepEqual(requestBody.deletes, [{
    path: workflowPath,
    expectedHash: "e".repeat(64)
  }]);
  assert.equal(harness.state.dirtyFiles.has(workflowPath), false);
  assert.equal(harness.state.deletedFiles.has(workflowPath), false);
  assert.equal(harness.state.fileHashes.has(workflowPath), false);
});

test("undo restores placement and dependent workflow edits as one transaction", async () => {
  const screenPath = "screens/home/screen.yml";
  const workflowPath = "screens/home/workflows/cart.mmd";
  const screen = {
    file: screenPath,
    data: { materials: [{ id: "button", spec: "specs/button.md" }] },
    yamlSerializeVersion: 0
  };
  const workflowSources = new Map([[workflowPath, "flowchart TD\n  node[Button]"]]);
  const capture = () => ({
    files: {
      [screenPath]: { data: JSON.parse(JSON.stringify(screen.data)) },
      [workflowPath]: { content: workflowSources.get(workflowPath) }
    },
    screenData: JSON.parse(JSON.stringify(screen.data)),
    workflowSources: [...workflowSources]
  });
  const harness = await createPersistenceHarness({
    state: {
      screens: [screen],
      workflowSources,
      fileHashes: new Map([
        [screenPath, "c".repeat(64)],
        [workflowPath, "d".repeat(64)]
      ])
    },
    services: {
      captureEditSnapshot: capture,
      applyEditSnapshot: async (snapshot) => {
        screen.data = JSON.parse(JSON.stringify(snapshot.screenData));
        workflowSources.clear();
        for (const [filePath, source] of snapshot.workflowSources) {
          workflowSources.set(filePath, source);
        }
      }
    }
  });
  harness.persistence.initializeEditHistory();

  screen.data.materials[0].id = "primary-button";
  workflowSources.set(workflowPath, "flowchart TD\n  primary[Primary button]");
  harness.persistence.beginEditTransaction();
  harness.persistence.markEdited(screenPath);
  harness.persistence.markEdited(workflowPath);
  harness.persistence.endEditTransaction();
  assert.equal(harness.persistence.undoStack.length, 1);

  await harness.persistence.undo();
  assert.equal(screen.data.materials[0].id, "button");
  assert.equal(workflowSources.get(workflowPath), "flowchart TD\n  node[Button]");
  assert.equal(harness.state.dirtyFiles.has(screenPath), true);
  assert.equal(harness.state.dirtyFiles.has(workflowPath), true);
});
