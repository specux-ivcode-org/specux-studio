/** Keeps editor selection state synchronized with the URL and browser history. */
export class BrowserHistory {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({
    windowObject,
    getCurrentSelection,
    getSelectionFilePath,
    getWorkspaceContext,
    getCanvasSpecuxTarget,
    isRenderOnly,
    isUpdatesSuppressed
  }) {
    this.window = windowObject;
    this.getCurrentSelection = getCurrentSelection;
    this.getSelectionFilePath = getSelectionFilePath;
    this.getWorkspaceContext = getWorkspaceContext || (() => null);
    this.hasCanvasTargetProvider = typeof getCanvasSpecuxTarget === "function";
    this.getCanvasSpecuxTarget = getCanvasSpecuxTarget || (() => null);
    this.isRenderOnly = isRenderOnly;
    this.isUpdatesSuppressed = isUpdatesSuppressed;
    this.initialized = false;
  }

  /** Builds an editor selection from the URL file, view, owner, and nested-path parameters. */
  selectionFromLocation() {
    const parameters = new URLSearchParams(this.window.location.search);
    const file = parameters.get("file");
    if (!file) return null;

    let instancePath = null;
    const encodedInstancePath = parameters.get("instancePath");
    if (encodedInstancePath) {
      try {
        const parsed = JSON.parse(encodedInstancePath);
        if (Array.isArray(parsed) && parsed.every((part) =>
          typeof part === "string" || (Number.isInteger(part) && part >= 0)
        )) {
          instancePath = parsed;
        }
      } catch {
        instancePath = null;
      }
    }
    const selection = {
      view: "url",
      file,
      requestedView: parameters.get("view"),
      screen: parameters.get("screen") ? { id: parameters.get("screen") } : null,
      owner: parameters.get("owner"),
      instancePath
    };
    const linkedFile = parameters.get("linked");
    const nodeId = parameters.get("node");
    const canvasTarget = new URLSearchParams(this.window.location.hash.slice(1)).get("specux");
    if (linkedFile) selection.linkedFile = linkedFile;
    if (nodeId) selection.nodeId = nodeId;
    if (canvasTarget) selection.canvasTarget = canvasTarget;
    return selection;
  }

  /** Writes the selected file and view to the URL and removes parameters that no longer apply. */
  updateUrlSelection(url, selection, filePath) {
    url.searchParams.set("file", filePath);
    url.searchParams.set("view", selection.view);
    if (selection.screen?.id) url.searchParams.set("screen", selection.screen.id);
    else url.searchParams.delete("screen");
    if (selection.view === "spec" && selection.spec?.owner) {
      url.searchParams.set("owner", selection.spec.owner);
    } else {
      url.searchParams.delete("owner");
    }
    url.searchParams.delete("instancePath");
    const context = this.getWorkspaceContext();
    const linked = context?.dock?.linked?.at(-1);
    const linkedFile = selection.view === "spec" &&
      selection.spec?.owner === "workflow-node"
      ? selection.spec.workflowPath
      : linked?.file;
    if (linkedFile) url.searchParams.set("linked", linkedFile);
    else url.searchParams.delete("linked");
    const nodeId = this.getSelectedWorkflowNodeId(context, selection);
    if (nodeId) url.searchParams.set("node", nodeId);
    else url.searchParams.delete("node");
    this.updateUrlCanvasTarget(url, this.getCanvasSpecuxTarget());
  }

  /** Returns the selected node from the active linked or primary workflow. */
  getSelectedWorkflowNodeId(context, selection) {
    if (selection.view === "spec" && selection.spec?.owner === "workflow-node") {
      return selection.spec.nodeId || null;
    }
    const linkedWorkflow = [...(context?.dock?.linked || [])]
      .reverse()
      .find((document) => document.view === "workflow" && document.nodeId);
    if (linkedWorkflow) return linkedWorkflow.nodeId;
    if (selection.view !== "workflow") return null;
    return context?.dock?.primary?.nodeId || null;
  }

  /** Serializes the complete SpecUX canvas target into one hash parameter. */
  updateUrlCanvasTarget(url, target) {
    const parameters = new URLSearchParams(url.hash.slice(1));
    if (target) parameters.set("specux", target);
    else parameters.delete("specux");
    const serialized = parameters.toString();
    url.hash = serialized ? serialized : "";
  }

  /** Creates browser history state containing a serializable editor-selection snapshot. */
  createHistoryState(selection, filePath) {
    const state = this.window.history.state && typeof this.window.history.state === "object"
      ? { ...this.window.history.state }
      : {};
    state.specuxEditor = {
      file: filePath,
      selection: this.createHistorySelection(selection),
      context: this.createHistoryContext()
    };
    return state;
  }

  /** Copies linked-document and canvas-target context into browser history state. */
  createHistoryContext() {
    const context = this.getWorkspaceContext();
    const linked = context?.dock?.linked?.at(-1);
    return {
      ...(linked ? { linked: { ...linked } } : {}),
      ...(this.getCanvasSpecuxTarget()
        ? { canvasTarget: this.getCanvasSpecuxTarget() }
        : {})
    };
  }

  /** Updates the URL and browser history entry for the current editor selection. */
  sync(forceReplace = false) {
    if (this.isRenderOnly() || this.isUpdatesSuppressed()) return;
    const selection = this.getCurrentSelection();
    const filePath = this.getSelectionFilePath(selection);
    if (!filePath) return;

    const previousUrl = new URL(this.window.location.href);
    const url = new URL(previousUrl.href);
    this.updateUrlSelection(url, selection, filePath);
    const state = this.createHistoryState(selection, filePath);
    const previousScreenId = this.getUrlScreenId(previousUrl);
    const currentScreenId = this.getCurrentScreenId(selection);
    const switchedScreens = previousScreenId && currentScreenId &&
      previousScreenId !== currentScreenId;
    if (!this.initialized || forceReplace || !switchedScreens) {
      this.window.history.replaceState(state, "", url);
    } else {
      this.window.history.pushState(state, "", url);
    }
    this.initialized = true;
  }

  /** Returns the displayed Screen ID represented by a URL. */
  getUrlScreenId(url) {
    const target = new URLSearchParams(url.hash.slice(1)).get("specux");
    const view = url.searchParams.get("view");
    if (view && !["screen", "spec", "workflow", "theme"].includes(view)) return null;
    return this.getTargetScreenId(target) || url.searchParams.get("screen");
  }

  /** Returns the displayed Screen ID for the current editor state. */
  getCurrentScreenId(selection) {
    const target = this.getCanvasSpecuxTarget();
    if (this.hasCanvasTargetProvider) return this.getTargetScreenId(target);
    return selection.screen?.id || null;
  }

  /** Extracts a Screen ID from a serialized SpecUX canvas target. */
  getTargetScreenId(target) {
    if (!target) return null;
    try {
      const url = new URL(`specux://${target}`);
      if (url.protocol !== "specux:" || url.hostname !== "screen") return null;
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.length === 2 && segments[1] === "screen.yml"
        ? decodeURIComponent(segments[0])
        : null;
    } catch {
      return null;
    }
  }

  /** Copies the editor selection into the compact form stored in browser history. */
  createHistorySelection(selection) {
    const snapshot = { view: selection.view };
    this.addDocumentHistorySelection(snapshot, selection);
    this.addPlacementHistorySelection(snapshot, selection);
    this.addWorkspaceHistorySelection(snapshot, selection);
    return snapshot;
  }

  /** Copies the owning document fields into a history snapshot. */
  addDocumentHistorySelection(snapshot, selection) {
    if (selection.screen?.id) snapshot.screen = { id: selection.screen.id };
    if (selection.view === "theme") snapshot.file = selection.file;
    if (selection.view === "workflow" && selection.workflow) {
      snapshot.workflow = { file: selection.workflow.file };
    }
    if (selection.view === "spec" && selection.spec) {
      snapshot.spec = {
        file: selection.spec.file,
        owner: selection.spec.owner,
        ...(Array.isArray(selection.spec.instancePath)
          ? { instancePath: [...selection.spec.instancePath] }
          : {})
      };
    }
  }

  /** Copies placement focus into a history snapshot. */
  addPlacementHistorySelection(snapshot, selection) {
    if (selection.selectedPlacement?.instancePath) {
      snapshot.selectedPlacement = {
        instancePath: [...selection.selectedPlacement.instancePath]
      };
    }
  }

  /** Copies linked-document and canvas fields into a history snapshot. */
  addWorkspaceHistorySelection(snapshot, selection) {
    const context = this.getWorkspaceContext();
    const linked = context?.dock?.linked?.at(-1);
    if (linked?.file) snapshot.linkedFile = linked.file;
    const nodeId = this.getSelectedWorkflowNodeId(context, selection);
    if (nodeId) snapshot.nodeId = nodeId;
    const canvasTarget = this.getCanvasSpecuxTarget();
    if (canvasTarget) snapshot.canvasTarget = canvasTarget;
  }
}
