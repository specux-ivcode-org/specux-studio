const STORAGE_KEY = "specux-studio.layout.v1";
const PANEL_LIMITS = {
  sidebar: { min: 180, max: 420, default: 238, label: "Project structure" },
  inspector: { min: 220, max: 480, default: 292, label: "Properties" }
};
const VISIBILITY_MODES = ["show", "hover"];
const DESKTOP_BREAKPOINT = 1120;

/** Manages panel sizing, visibility modes, and keyboard and pointer resizing. */
export class ResizablePanels {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ windowObject, documentObject, workspace, showMessage }) {
    this.window = windowObject;
    this.document = documentObject;
    this.workspace = workspace;
    this.showMessage = showMessage;
    const saved = this.readSavedLayout();
    this.widths = saved.widths;
    this.modes = saved.modes;
    this.migratedLegacyMode = saved.migratedLegacyMode;
    this.activeDrag = null;
    this.openOverlays = { sidebar: false, inspector: false };
    this.hoverTimers = { sidebar: null, inspector: null };
    this.closeTimers = { sidebar: null, inspector: null };
  }

  /** Attaches the configured event listeners to the editor controls. */
  bind() {
    this.bindHandle("sidebar-resizer", "sidebar");
    this.bindHandle("inspector-resizer", "inspector");
    this.bindModeButton("sidebar-mode", "sidebar");
    this.bindModeButton("inspector-mode", "inspector");
    this.bindEdgeTrigger("sidebar", "project-sidebar", "sidebar-edge-trigger");
    this.bindEdgeTrigger("inspector", "details-inspector", "inspector-edge-trigger");
    this.document.addEventListener("pointerdown", (event) => this.handleDocumentPointerDown(event), true);
    this.window.addEventListener("resize", () => this.applyLayout());
    this.applyLayout();
    if (this.migratedLegacyMode) {
      this.saveWidths();
      this.migratedLegacyMode = false;
    }
  }

  /** Reads the saved layout and returns its editor representation. */
  readSavedLayout() {
    const defaults = this.defaultLayout();
    try {
      const saved = this.window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Saved panel layout must be an object.");
      }
      return this.parseSavedLayout(parsed, defaults);
    } catch (error) {
      this.showMessage("Could not load saved layout", error.message || String(error));
      return defaults;
    }
  }

  /** Returns the default widths and visibility modes for the resizable panels. */
  defaultLayout() {
    return {
      widths: {
        sidebar: PANEL_LIMITS.sidebar.default,
        inspector: PANEL_LIMITS.inspector.default
      },
      modes: { sidebar: "show", inspector: "show" }
    };
  }

  /** Parses the saved layout into structured editor data. */
  parseSavedLayout(parsed, defaults) {
    return {
      widths: {
        sidebar: this.clamp("sidebar", parsed.sidebar ?? defaults.widths.sidebar),
        inspector: this.clamp("inspector", parsed.inspector ?? defaults.widths.inspector)
      },
      modes: {
        sidebar: this.parseSavedMode(parsed.sidebarMode),
        inspector: this.parseSavedMode(parsed.inspectorMode)
      },
      migratedLegacyMode: parsed.sidebarMode === "hide" || parsed.inspectorMode === "hide"
    };
  }

  /** Parses the saved mode into structured editor data. */
  parseSavedMode(mode) {
    if (mode === "hide") return "hover";
    return VISIBILITY_MODES.includes(mode) ? mode : "show";
  }

  /** Constrains a panel size to its configured minimum and maximum. */
  clamp(panel, value) {
    const limits = PANEL_LIMITS[panel];
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return limits.default;
    return Math.round(Math.min(limits.max, Math.max(limits.min, numericValue)));
  }

  /** Registers event listeners for handle interactions. */
  bindHandle(elementId, panel) {
    const handle = this.document.getElementById(elementId);
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => this.startDrag(event, panel, handle));
    handle.addEventListener("pointermove", (event) => this.moveDrag(event));
    handle.addEventListener("pointerup", (event) => this.endDrag(event, handle));
    handle.addEventListener("pointercancel", (event) => this.endDrag(event, handle));
    handle.addEventListener("lostpointercapture", (event) => this.endDrag(event, handle));
    handle.addEventListener("keydown", (event) => this.resizeFromKeyboard(event, panel));
    handle.addEventListener("pointerenter", () => this.cancelClose(panel));
    handle.addEventListener("pointerleave", () => this.scheduleClose(panel, true));
    handle.addEventListener("focusin", () => this.cancelClose(panel));
    handle.addEventListener("focusout", () => this.scheduleClose(panel));
  }

  /** Registers event listeners for mode button interactions. */
  bindModeButton(elementId, panel) {
    const button = this.document.getElementById(elementId);
    if (!button) return;
    button.addEventListener("click", () => {
      const currentIndex = VISIBILITY_MODES.indexOf(this.modes[panel]);
      this.setMode(panel, VISIBILITY_MODES[(currentIndex + 1) % VISIBILITY_MODES.length]);
    });
  }

  /** Registers event listeners for edge trigger interactions. */
  bindEdgeTrigger(panel, panelId, triggerId) {
    const element = this.document.getElementById(panelId);
    const trigger = this.document.getElementById(triggerId);
    if (!element || !trigger) return;

    trigger.addEventListener("pointerenter", () => {
      this.cancelClose(panel);
      this.scheduleOpen(panel);
    });
    trigger.addEventListener("pointerleave", () => {
      this.cancelOpen(panel);
      this.scheduleClose(panel, true);
    });
    trigger.addEventListener("blur", () => this.scheduleClose(panel));
    trigger.addEventListener("click", () => {
      this.setOverlayOpen(panel, !this.openOverlays[panel]);
    });
    trigger.addEventListener("keydown", (event) => this.handleOverlayKeydown(event, panel, trigger));

    element.addEventListener("pointerenter", () => this.cancelClose(panel));
    element.addEventListener("pointerleave", () => this.scheduleClose(panel, true));
    element.addEventListener("focusin", () => {
      this.cancelClose(panel);
      this.setOverlayOpen(panel, true);
    });
    element.addEventListener("focusout", () => this.scheduleClose(panel));
    element.addEventListener("keydown", (event) => this.handleOverlayKeydown(event, panel, trigger));
  }

  /** Updates the open for the current editor state. */
  scheduleOpen(panel) {
    this.cancelOpen(panel);
    if (this.modes[panel] !== "hover") return;
    this.hoverTimers[panel] = this.window.setTimeout(() => {
      this.hoverTimers[panel] = null;
      this.setOverlayOpen(panel, true);
    }, 1000);
  }

  /** Cancels the open for the current editor state. */
  cancelOpen(panel) {
    if (this.hoverTimers[panel] !== null) {
      this.window.clearTimeout(this.hoverTimers[panel]);
      this.hoverTimers[panel] = null;
    }
  }

  /** Updates the close for the current editor state. */
  scheduleClose(panel, pointerLeft = false) {
    this.cancelClose(panel);
    if (this.modes[panel] !== "hover") return;
    this.closeTimers[panel] = this.window.setTimeout(() => {
      this.closeIfIdle(panel, pointerLeft);
    }, 1000);
  }

  /** Closes the if idle and restores the related editor state. */
  closeIfIdle(panel, pointerLeft) {
    this.closeTimers[panel] = null;
    const element = this.document.getElementById(
      panel === "sidebar" ? "project-sidebar" : "details-inspector"
    );
    const trigger = this.document.getElementById(
      panel === "sidebar" ? "sidebar-edge-trigger" : "inspector-edge-trigger"
    );
    const handle = this.document.getElementById(
      panel === "sidebar" ? "sidebar-resizer" : "inspector-resizer"
    );
    if (this.activeDrag?.panel === panel) {
      this.scheduleClose(panel, pointerLeft);
      return;
    }
    if (this.isPointerOver(element, trigger, handle)) return;
    if (this.hasPanelFocus(element, handle, pointerLeft)) return;
    this.setOverlayOpen(panel, false);
  }

  /** Checks whether the pointer is over either the panel or its trigger. */
  isPointerOver(element, trigger, handle) {
    return element?.matches?.(":hover") || trigger?.matches?.(":hover") || handle?.matches?.(":hover");
  }

  /** Checks whether the current editor state contains panel focus. */
  hasPanelFocus(element, handle, pointerLeft) {
    return !pointerLeft && (
      element?.contains?.(this.document.activeElement) ||
      handle?.contains?.(this.document.activeElement)
    );
  }

  /** Cancels the close for the current editor state. */
  cancelClose(panel) {
    if (this.closeTimers[panel] !== null) {
      this.window.clearTimeout(this.closeTimers[panel]);
      this.closeTimers[panel] = null;
    }
  }

  /** Handles document pointer down events and applies the corresponding editor action. */
  handleDocumentPointerDown(event) {
    const hitTarget = this.getPointerHitTarget(event);
    const target = hitTarget || event.target;
    const path = hitTarget ? [] : event.composedPath?.() || [];
    for (const [panel, elementId, triggerId] of [
      ["sidebar", "project-sidebar", "sidebar-edge-trigger"],
      ["inspector", "details-inspector", "inspector-edge-trigger"]
    ]) {
      this.handlePanelDocumentPointerDown(panel, elementId, triggerId, target, path);
    }
  }

  /** Finds the nearest interactive target beneath a pointer event. */
  getPointerHitTarget(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return this.document.elementFromPoint?.(event.clientX, event.clientY) || null;
  }

  /** Handles panel document pointer down events and applies the corresponding editor action. */
  handlePanelDocumentPointerDown(panel, elementId, triggerId, target, path) {
    if (this.modes[panel] !== "hover" || !this.openOverlays[panel]) return;
    const element = this.document.getElementById(elementId);
    const trigger = this.document.getElementById(triggerId);
    const handleId = panel === "sidebar" ? "sidebar-resizer" : "inspector-resizer";
    const handle = this.document.getElementById(handleId);

    /** Checks whether the point falls within the supplied rectangle. */
    const isInside = (node) => node && (path.includes(node) || node.contains?.(target));
    if (isInside(element) || isInside(trigger) || isInside(handle)) {
      this.cancelClose(panel);
      return;
    }
    this.setOverlayOpen(panel, false);
  }

  /** Handles overlay keydown events and applies the corresponding editor action. */
  handleOverlayKeydown(event, panel, trigger) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.setOverlayOpen(panel, false);
      trigger.focus();
    } else if (event.key === "Tab" && this.openOverlays[panel] && event.currentTarget === trigger) {
      const element = this.document.getElementById(
        panel === "sidebar" ? "project-sidebar" : "details-inspector"
      );
      const firstControl = element?.querySelector?.(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (firstControl) {
        event.preventDefault();
        firstControl.focus();
      }
    }
  }

  /** Sets the overlay open from the supplied data. */
  setOverlayOpen(panel, open) {
    this.cancelOpen(panel);
    this.cancelClose(panel);
    this.openOverlays[panel] = open && this.modes[panel] === "hover";
    this.syncPanel(panel);
  }

  /** Sets the mode from the supplied data. */
  setMode(panel, mode) {
    if (!VISIBILITY_MODES.includes(mode)) return;
    this.modes[panel] = mode;
    this.openOverlays[panel] = false;
    this.cancelOpen(panel);
    this.cancelClose(panel);
    this.applyLayout();
    this.saveWidths();
  }

  /** Starts the drag for the current editor state. */
  startDrag(event, panel, handle) {
    if (
      event.button !== 0 ||
      this.activeDrag ||
      (this.modes[panel] !== "show" && !(this.modes[panel] === "hover" && this.openOverlays[panel]))
    ) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    this.activeDrag = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.widths[panel]
    };
    this.document.body.classList.add("panel-resizing");
  }

  /** Moves the drag for the current editor state. */
  moveDrag(event) {
    const drag = this.activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const direction = drag.panel === "sidebar" ? 1 : -1;
    this.widths[drag.panel] = this.clamp(
      drag.panel,
      drag.startWidth + direction * (event.clientX - drag.startX)
    );
    this.applyLayout();
  }

  /** Ends the drag for the current editor state. */
  endDrag(event, handle) {
    if (!this.activeDrag || event.pointerId !== this.activeDrag.pointerId) return;
    const panel = this.activeDrag.panel;
    this.activeDrag = null;
    this.document.body.classList.remove("panel-resizing");
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    this.saveWidths();
    this.scheduleClose(panel, true);
  }

  /** Resizes the from keyboard within its configured bounds. */
  resizeFromKeyboard(event, panel) {
    if (this.modes[panel] !== "show" && !(this.modes[panel] === "hover" && this.openOverlays[panel])) return;
    const limits = PANEL_LIMITS[panel];
    const step = event.shiftKey ? 32 : 12;
    const nextWidth = this.getKeyboardWidth(event, panel, limits, step);
    if (nextWidth === null) return;
    event.preventDefault();
    this.widths[panel] = this.clamp(panel, nextWidth);
    this.applyLayout();
    this.saveWidths();
  }

  /** Returns the keyboard width. */
  getKeyboardWidth(event, panel, limits, step) {
    if (event.key === "Home") return limits.min;
    if (event.key === "End") return limits.max;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
    const physicalDirection = event.key === "ArrowRight" ? 1 : -1;
    const panelDirection = panel === "sidebar" ? physicalDirection : -physicalDirection;
    return this.widths[panel] + panelDirection * step;
  }

  /** Applies the layout to the current editor state. */
  applyLayout() {
    this.workspace.style.setProperty("--sidebar-width", `${this.widths.sidebar}px`);
    this.workspace.style.setProperty("--inspector-width", `${this.widths.inspector}px`);
    this.workspace.dataset.sidebarMode = this.modes.sidebar;
    this.workspace.dataset.inspectorMode = this.modes.inspector;
    for (const [panel, elementId, handleId, triggerId, buttonId] of [
      ["sidebar", "project-sidebar", "sidebar-resizer", "sidebar-edge-trigger", "sidebar-mode"],
      ["inspector", "details-inspector", "inspector-resizer", "inspector-edge-trigger", "inspector-mode"]
    ]) {
      const handle = this.document.getElementById(handleId);
      handle?.setAttribute("aria-valuenow", String(this.widths[panel]));
      this.syncPanel(panel, elementId, triggerId, buttonId, handleId);
    }
  }

  /** Synchronizes the panel with the current editor state. */
  syncPanel(panel, elementId, triggerId, buttonId, handleId) {
    const elements = this.getPanelElements(panel, elementId, triggerId, buttonId, handleId);
    const mode = this.modes[panel];
    const isOpen = mode === "show" || (mode === "hover" && this.openOverlays[panel]);
    this.syncPanelVisibility(elements, mode, isOpen, panel);
    this.syncModeButton(elements.button, panel, mode);
  }

  /** Returns the panel elements. */
  getPanelElements(panel, elementId, triggerId, buttonId, handleId) {
    const ids = panel === "sidebar"
      ? ["project-sidebar", "sidebar-edge-trigger", "sidebar-mode", "sidebar-resizer"]
      : ["details-inspector", "inspector-edge-trigger", "inspector-mode", "inspector-resizer"];
    return {
      element: this.document.getElementById(elementId || ids[0]),
      trigger: this.document.getElementById(triggerId || ids[1]),
      button: this.document.getElementById(buttonId || ids[2]),
      handle: this.document.getElementById(handleId || ids[3])
    };
  }

  /** Synchronizes the panel visibility with the current editor state. */
  syncPanelVisibility({ element, trigger, handle }, mode, isOpen, panel) {
    if (element) {
      element.hidden = !isOpen;
      element.classList?.toggle("panel-overlay-open", mode === "hover" && this.openOverlays[panel]);
      element.setAttribute("aria-hidden", String(!isOpen));
    }
    if (trigger) {
      trigger.hidden = mode !== "hover";
      trigger.setAttribute("aria-expanded", String(mode === "hover" && this.openOverlays[panel]));
    }
    if (handle) handle.hidden = mode !== "show" && !(mode === "hover" && this.openOverlays[panel]);
  }

  /** Synchronizes the mode button with the current editor state. */
  syncModeButton(button, panel, mode) {
    if (!button) return;
    const config = PANEL_LIMITS[panel];
    const currentMode = this.modeLabel(mode);
    const nextMode = mode === "hover" ? "Show" : "Hover to show";
    const label = `${config.label}: ${currentMode}. Activate to switch to ${nextMode}.`;
    if (button.dataset) button.dataset.mode = mode;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  /** Returns the label shown for the selected panel mode. */
  modeLabel(mode) {
    return mode === "hover" ? "Hover to show" : mode[0].toUpperCase() + mode.slice(1);
  }

  /** Persists the widths to the project. */
  saveWidths() {
    try {
      this.window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...this.widths,
        sidebarMode: this.modes.sidebar,
        inspectorMode: this.modes.inspector
      }));
    } catch (error) {
      this.showMessage("Could not save layout", error.message || String(error));
    }
  }
}
