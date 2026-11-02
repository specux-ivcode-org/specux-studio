const CANVAS_ZOOM_CONTROL_SETS = [
  ["screen-canvas-zoom-out", "screen-canvas-zoom-reset", "screen-canvas-zoom-in"],
  ["workflow-canvas-zoom-out", "workflow-canvas-zoom-reset", "workflow-canvas-zoom-in"]
];

export class EditorEventController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.canvasZoom = 1;
  }

  bind() {
    const { state, services } = this;
    services.byId("reset-project").addEventListener("click", async () => {
      if (state.hasEdits && !services.confirm("Discard unsaved changes and reload project files?")) return;
      const button = services.byId("reset-project");
      button.disabled = true;
      button.textContent = "Reloading...";
      await services.loadProject();
      button.disabled = false;
      button.textContent = "Reset from files";
    });
    services.byId("create-screen").addEventListener("click", () =>
      services.createScreen().catch((error) =>
        services.showEditorMessage("Could not create Screen", error.message || String(error))
      )
    );
    services.byId("screen-view-preview").addEventListener("click", () =>
      services.setScreenViewMode("preview")
    );
    services.byId("screen-view-yaml").addEventListener("click", () =>
      services.setScreenViewMode("yaml")
    );
    services.byId("screen-preview-new-tab").addEventListener("click", services.openScreenPreview);
    this.bindCanvasZoom();
    services.byId("screen-selector-toggle").addEventListener("click", () =>
      services.setScreenSelectorOpen(services.byId("screen-selector-panel").hidden)
    );
    services.byId("screen-selector-search").addEventListener("input", services.renderScreenSelector);
    services.byId("screen-selector-search").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        services.setScreenSelectorOpen(false, true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        services.byId("screen-selector-options").querySelector("button")?.focus();
      } else if (event.key === "Enter") {
        const firstOption = services.byId("screen-selector-options").querySelector("button");
        if (firstOption) {
          event.preventDefault();
          firstOption.click();
        }
      }
    });
    services.byId("screen-selector-options").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        services.setScreenSelectorOpen(false, true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const options = [...services.byId("screen-selector-options").querySelectorAll("button")];
      if (!options.length) return;
      const currentIndex = options.indexOf(services.document.activeElement);
      if (event.key === "ArrowUp" && currentIndex === 0) {
        services.byId("screen-selector-search").focus();
        return;
      }
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : Math.max(0, Math.min(
            options.length - 1,
            currentIndex + (event.key === "ArrowDown" ? 1 : -1)
          ));
      options[nextIndex]?.focus();
    });
    services.document.addEventListener("pointerdown", (event) => {
      if (!services.byId("screen-quick-selector").contains(event.target) &&
          !services.byId("screen-selector-panel").hidden) {
        services.setScreenSelectorOpen(false);
      }
    });
    services.byId("save-project").addEventListener("click", () => services.saveProjectChanges());
    this.bindBrowserHistory();
  }

  bindCanvasZoom() {
    const { services } = this;
    for (const [zoomOutId, zoomResetId, zoomInId] of CANVAS_ZOOM_CONTROL_SETS) {
      services.byId(zoomOutId).addEventListener("click", () =>
        this.setCanvasZoom(this.canvasZoom - 0.1)
      );
      services.byId(zoomInId).addEventListener("click", () =>
        this.setCanvasZoom(this.canvasZoom + 0.1)
      );
      services.byId(zoomResetId).addEventListener("click", () =>
        this.setCanvasZoom(1)
      );
    }
    this.setCanvasZoom(this.canvasZoom);
  }

  setCanvasZoom(zoom) {
    const minimum = 0.25;
    const maximum = 2;
    this.canvasZoom = Math.max(minimum, Math.min(maximum, Math.round(zoom * 100) / 100));
    this.services.byId("screen-preview").style.setProperty(
      "--screen-canvas-zoom",
      String(this.canvasZoom)
    );
    this.services.renderScreenRulers();
    for (const [zoomOutId, zoomResetId, zoomInId] of CANVAS_ZOOM_CONTROL_SETS) {
      this.services.byId(zoomResetId).textContent =
        `${Math.round(this.canvasZoom * 100)}%`;
      this.services.byId(zoomOutId).disabled = this.canvasZoom <= minimum;
      this.services.byId(zoomInId).disabled = this.canvasZoom >= maximum;
    }
  }

  bindBrowserHistory() {
    const { state, services } = this;
    services.window.addEventListener("popstate", (event) => {
      if (services.isRenderOnly) return;
      const savedSelection = event.state?.specuxEditor?.selection;
      const selection = savedSelection && typeof savedSelection === "object"
        ? savedSelection
        : services.selectionFromLocation();
      const wasHistoryUpdateSuppressed = state.historyUpdateSuppressed;
      state.historyUpdateSuppressed = true;
      const restore = selection ? services.restoreUiSelection(selection) : services.loadProject();
      Promise.resolve(restore)
        .catch((error) => services.showEditorMessage(
          "Could not restore browser history entry",
          error.message || String(error)
        ))
        .finally(() => {
          state.historyUpdateSuppressed = wasHistoryUpdateSuppressed;
          if (!wasHistoryUpdateSuppressed) services.syncBrowserHistory(true);
        });
    });
  }
}
