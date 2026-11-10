/** Keeps editor selection state synchronized with the URL and browser history. */
export class BrowserHistory {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({
    windowObject,
    getCurrentSelection,
    getSelectionFilePath,
    isRenderOnly,
    isUpdatesSuppressed
  }) {
    this.window = windowObject;
    this.getCurrentSelection = getCurrentSelection;
    this.getSelectionFilePath = getSelectionFilePath;
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
    return {
      view: "url",
      file,
      requestedView: parameters.get("view"),
      screen: parameters.get("screen") ? { id: parameters.get("screen") } : null,
      owner: parameters.get("owner"),
      instancePath
    };
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
  }

  /** Creates browser history state containing a serializable editor-selection snapshot. */
  createHistoryState(selection, filePath) {
    const state = this.window.history.state && typeof this.window.history.state === "object"
      ? { ...this.window.history.state }
      : {};
    state.specuxEditor = {
      file: filePath,
      selection: this.createHistorySelection(selection)
    };
    return state;
  }

  /** Updates the URL and browser history entry for the current editor selection. */
  sync(forceReplace = false) {
    if (this.isRenderOnly() || this.isUpdatesSuppressed()) return;
    const selection = this.getCurrentSelection();
    const filePath = this.getSelectionFilePath(selection);
    if (!filePath) return;

    const url = new URL(this.window.location.href);
    this.updateUrlSelection(url, selection, filePath);
    const state = this.createHistoryState(selection, filePath);
    const previousFile = new URL(this.window.location.href).searchParams.get("file");
    if (!this.initialized || forceReplace || previousFile === filePath) {
      this.window.history.replaceState(state, "", url);
    } else {
      this.window.history.pushState(state, "", url);
    }
    this.initialized = true;
  }

  /** Copies the editor selection into the compact form stored in browser history. */
  createHistorySelection(selection) {
    const snapshot = { view: selection.view };
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
    if (selection.selectedPlacement?.instancePath) {
      snapshot.selectedPlacement = {
        instancePath: [...selection.selectedPlacement.instancePath]
      };
    }
    return snapshot;
  }
}
