/** Connects editor controls to project, Screen, zoom, and history actions. */
export class EditorEventController {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  /** Attaches the configured event listeners to the editor controls. */
  bind() {
    // Connect project reload, Screen creation, and save actions.
    this.bindProjectActions();

    // Connect the Screen preview and its alternate YAML view.
    this.bindScreenViewControls();

    // Keep an explicit route back from Material authoring to the Screen workspace.
    this.bindMaterialReturn();

    // Keep contextual spec indicators available from the persistent toolbar.
    this.bindSpecIndicators();

    // Connect Screen selection, including its keyboard and dismissal behavior.
    this.bindScreenSelector();

    // Connect browser navigation to editor selection restoration.
    this.bindBrowserHistory();

    // Let local interactions consume Escape before workspace navigation does.
    this.bindWorkspaceEscape();

    // Delete selected placements only while the Screen workspace is active.
    this.bindDeleteShortcut();
  }

  /** Binds project reload, Screen creation, and save controls. */
  bindProjectActions() {
    const { state, services } = this;

    // Confirm before discarding edits, then reload the project's files.
    services.byId("reset-project").addEventListener("click", async () => {
      if (state.hasEdits && !services.confirm("Discard unsaved changes and reload project files?")) return;

      const button = services.byId("reset-project");
      button.disabled = true;
      button.textContent = "Reloading...";

      // Fetch the latest project files before restoring the reset control.
      await services.loadProject();

      button.disabled = false;
      button.textContent = "Reset from files";
    });

    // Create a Screen and report creation failures in the editor.
    services.byId("create-screen").addEventListener("click", () =>
      services.createScreen().catch((error) =>
        services.showEditorMessage("Could not create Screen", error.message || String(error))
      )
    );

    // Save all pending project edits.
    services.byId("save-project").addEventListener("click", () => services.saveProjectChanges());

    services.byId("theme-mode-exit").addEventListener("click", () =>
      services.exitTheme().catch(services.showFatalError)
    );
  }

  /** Binds controls that switch or open the Screen preview. */
  bindScreenViewControls() {
    const { services } = this;

    // Show the rendered Screen preview.
    services.byId("screen-view-preview").addEventListener("click", () =>
      services.setScreenViewMode("preview")
    );

    // Show the Screen YAML source.
    services.byId("screen-view-yaml").addEventListener("click", () =>
      services.setScreenViewMode("yaml")
    );

    // Open the current Screen preview in a separate tab.
    services.byId("screen-preview-new-tab").addEventListener("click", services.openScreenPreview);

  }

  /** Binds the persistent toggle for contextual spec indicators. */
  bindSpecIndicators() {
    const { state, services } = this;
    services.byId("spec-indicators-toggle").addEventListener("click", () =>
      services.setSpecIndicatorsEnabled(!state.specIndicatorsEnabled)
    );
  }

  /** Binds the Material workspace return action. */
  bindMaterialReturn() {
    this.services.byId("material-return-to-screen").addEventListener(
      "click",
      this.services.returnToScreen
    );
  }

  /** Binds Screen selector activation, search, keyboard navigation, and dismissal. */
  bindScreenSelector() {
    const { services } = this;

    // Toggle the selector panel from its toolbar button.
    services.byId("screen-selector-toggle").addEventListener("click", () =>
      services.setScreenSelectorOpen(services.byId("screen-selector-panel").hidden)
    );

    // Refresh matching options as the user types.
    services.byId("screen-selector-search").addEventListener("input", services.renderScreenSelector);

    // Let keyboard users close search, enter the option list, or activate its first result.
    services.byId("screen-selector-search").addEventListener(
      "keydown",
      (event) => this.handleScreenSelectorSearchKeydown(event)
    );

    // Keep keyboard focus usable while navigating the option list.
    services.byId("screen-selector-options").addEventListener(
      "keydown",
      (event) => this.handleScreenSelectorOptionsKeydown(event)
    );

    // Close the selector when the pointer interaction occurs outside it.
    services.document.addEventListener("pointerdown", (event) => {
      if (!services.byId("screen-quick-selector").contains(event.target) &&
          !services.byId("screen-selector-panel").hidden) {
        services.setScreenSelectorOpen(false);
      }
    });
  }

  /** Handles keyboard shortcuts while focus is in the Screen selector search field. */
  handleScreenSelectorSearchKeydown(event) {
    const { services } = this;

    // Escape closes the list and returns focus to its toggle.
    if (event.key === "Escape") {
      event.preventDefault();
      services.setScreenSelectorOpen(false, true);
    } else if (event.key === "ArrowDown") {
      // Move from the search field to the first matching Screen.
      event.preventDefault();
      services.byId("screen-selector-options").querySelector("button")?.focus();
    } else if (event.key === "Enter") {
      // Enter opens the first matching Screen, when one exists.
      const firstOption = services.byId("screen-selector-options").querySelector("button");
      if (firstOption) {
        event.preventDefault();
        firstOption.click();
      }
    }
  }

  /** Handles keyboard navigation among Screen selector options. */
  handleScreenSelectorOptionsKeydown(event) {
    const { services } = this;

    // Escape closes the list and restores focus to its toggle.
    if (event.key === "Escape") {
      event.preventDefault();
      services.setScreenSelectorOpen(false, true);
      return;
    }

    // Ignore keys that do not navigate the option list.
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    // Read the available options and current focus to calculate the next target.
    const options = [...services.byId("screen-selector-options").querySelectorAll("button")];
    if (!options.length) return;
    const currentIndex = options.indexOf(services.document.activeElement);

    // ArrowUp from the first option returns focus to the search field.
    if (event.key === "ArrowUp" && currentIndex === 0) {
      services.byId("screen-selector-search").focus();
      return;
    }

    // Home and End jump to the list bounds; arrows move one option at a time.
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : Math.max(0, Math.min(
          options.length - 1,
          currentIndex + (event.key === "ArrowDown" ? 1 : -1)
        ));
    options[nextIndex]?.focus();
  }

  /** Registers event listeners for browser history interactions. */
  bindBrowserHistory() {
    const { state, services } = this;

    // Restore the editor selection or project view when browser history changes.
    services.window.addEventListener("popstate", (event) => {
      if (services.isRenderOnly) return;

      // Prefer the saved editor selection and fall back to the current URL.
      const savedSelection = event.state?.specuxEditor?.selection;
      const selection = services.selectionFromLocation() ||
        (savedSelection && typeof savedSelection === "object" ? savedSelection : null);
      const wasHistoryUpdateSuppressed = state.historyUpdateSuppressed;
      state.historyUpdateSuppressed = true;

      // Restore the selected view, or reload the project when no selection is available.
      const restore = selection ? services.restoreUiSelection(selection) : services.loadProject();

      // Report failures and update browser history after the restored view settles.
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

  /** Binds workspace Escape after dialogs, text fields, and local menus. */
  bindWorkspaceEscape() {
    const { services } = this;
    services.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (services.document.querySelector("dialog[open]")) return;

      const activeElement = services.document.activeElement;
      if (this.isTransientTextEditor(activeElement)) {
        event.preventDefault();
        activeElement.blur();
        return;
      }

      if (services.handleLocalEscape()) {
        event.preventDefault();
        return;
      }
      if (!services.hasWorkspaceEscapeView()) return;
      event.preventDefault();
      services.handleWorkspaceEscape().catch(services.showFatalError);
    });
  }

  /** Deletes selected placements from the active Screen with the Delete key. */
  bindDeleteShortcut() {
    const { services } = this;
    services.document.addEventListener("keydown", (event) => {
      if (event.key !== "Delete" || event.defaultPrevented ||
          event.altKey || event.ctrlKey || event.metaKey ||
          services.document.querySelector("dialog[open]") ||
          this.isTransientTextEditor(services.document.activeElement) ||
          this.isInteractiveDeleteTarget(event.target) ||
          !services.canDeleteSelectedPlacements()) return;
      event.preventDefault();
      services.deleteSelectedPlacements().catch((error) =>
        services.showEditorMessage("Could not delete placements", error.message || String(error))
      );
    });
  }

  /** Keeps focused controls and links from triggering the placement shortcut. */
  isInteractiveDeleteTarget(target) {
    return Boolean(target?.closest?.("a, button, input, select, textarea, [contenteditable=true]"));
  }

  /** Determines whether Escape should end a focused transient text edit first. */
  isTransientTextEditor(target) {
    if (target?.isContentEditable || target?.tagName === "TEXTAREA") return true;
    if (target?.tagName !== "INPUT") return false;
    return !["button", "checkbox", "color", "file", "hidden", "radio", "range", "reset", "submit"]
      .includes(target.type);
  }
}
