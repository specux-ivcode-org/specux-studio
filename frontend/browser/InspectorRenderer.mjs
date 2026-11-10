import { BASE_LAYER_ID } from "../../shared/ScreenLayers.mjs";
import {
  getScaleComponents,
  isScreenGroup,
  serializeScale
} from "../../shared/ScreenGroups.mjs";

const LAYER_DRAG_TYPE = "application/x-specux-layer";
const MATERIAL_DRAG_TYPE = "application/x-specux-material";

/** Builds the inspector panel for the active project or editor selection. */
export class InspectorRenderer {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.screenDetailsTab = "properties";
    this.selectedScreenFile = null;
    this.selectedScreenLayerId = BASE_LAYER_ID;
    this.selectedPreviewStateOverrideKey = null;
    this.selectedPreviewStateOverrideStateId = null;
    this.selectedPreviewStateOverrideScreenFile = null;
  }

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  render() {
    const { state, services } = this;
    const panel = services.byId("inspector-content");
    panel.parentElement?.classList?.toggle("layers-details-open", false);
    panel.replaceChildren(services.element("h2", "panel-heading", "Details"));
    if (state.viewingProject) {
      this.renderProjectDetails(panel);
    } else if (state.viewingTheme) {
      services.themeEditor.renderDetails(panel);
    } else if (state.viewingSpec) {
      this.renderSpecDetails(panel);
    } else if (state.viewingMaterialFile) {
      this.renderMaterialFileDetails(
        panel,
        state.materialFiles.get(state.activeMaterialFilePath)
      );
    } else if (state.viewingWorkflow) {
      this.renderWorkflowPreviewDetails(panel);
    } else {
      const screen = state.screens[state.activeScreenIndex]?.data;
      if (!screen) return;
      const baseInstance = state.activeInstancePath.length
        ? services.getInstanceAtPath({ data: screen }, state.activeInstancePath)
        : null;
      const stateId = services.getActivePreviewStateId(screen);
      const instance = baseInstance
        ? services.resolvePlacementForState(baseInstance, stateId, screen)
        : null;
      const material = instance ? state.materialFiles.get(instance.src) : null;
      this.renderScreenEditorDetails(
        panel,
        screen,
        instance,
        material,
        state.viewingPreviewState
      );
    }
  }

  /** Renders the workflow preview details from the current editor data. */
  renderWorkflowPreviewDetails(panel) {
    const { state, services } = this;
    const screenEntry = state.screens[state.activeScreenIndex];
    if (!screenEntry?.data) return;
    this.appendSection(panel, "Workflow preview");
    panel.append(services.element(
      "p",
      "readonly-label",
      "This Screen preview is read-only. The highlighted placement is the target of the selected workflow node."
    ));
    this.appendDetail(panel, "Screen", screenEntry.data.name || screenEntry.data.id);
    if (state.activeInstancePath.length) {
      const instance = services.getInstanceAtPath(
        { data: screenEntry.data },
        state.activeInstancePath
      );
      if (instance) this.appendDetail(panel, "Placement", instance.id);
    }
  }

  /** Renders the screen editor details from the current editor data. */
  renderScreenEditorDetails(panel, screen, instance, material, viewingPreviewState) {
    const { services } = this;
    const tabList = services.element("div", "inspector-tabs");
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "Screen details");
    const content = services.element("div", "inspector-tab-panel");
    content.id = "screen-details-panel";
    content.setAttribute("role", "tabpanel");
    content.setAttribute("aria-labelledby", `screen-details-tab-${this.screenDetailsTab}`);

    for (const [tabId, label] of [["properties", "Properties"], ["layers", "Layers"]]) {
      const tab = services.element(
        "button",
        `inspector-tab${this.screenDetailsTab === tabId ? " selected" : ""}`,
        label
      );
      tab.type = "button";
      tab.id = `screen-details-tab-${tabId}`;
      tab.dataset.inspectorTab = tabId;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(this.screenDetailsTab === tabId));
      tab.setAttribute("aria-controls", content.id);
      tab.tabIndex = this.screenDetailsTab === tabId ? 0 : -1;
      tab.addEventListener("click", () => {
        this.screenDetailsTab = tabId;
        services.renderInspector();
        services.byId("inspector-content").parentElement.scrollTop = 0;
      });
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextTab = event.key === "Home"
          ? "properties"
          : event.key === "End"
            ? "layers"
            : this.screenDetailsTab === "properties" ? "layers" : "properties";
        this.screenDetailsTab = nextTab;
        services.renderInspector();
        services.byId("inspector-content")
          .querySelector(`[data-inspector-tab="${nextTab}"]`)?.focus();
        services.byId("inspector-content").parentElement.scrollTop = 0;
      });
      tabList.append(tab);
    }
    panel.append(tabList, content);

    if (this.screenDetailsTab === "layers") {
      panel.parentElement?.classList?.toggle("layers-details-open", true);
      this.renderLayersDetails(content, screen);
    } else if (viewingPreviewState || !instance) {
      this.renderScreenProperties(content, screen);
    } else {
      this.renderInstanceDetails(content, instance, material);
    }
  }

  /** Renders the layers details from the current editor data. */
  renderLayersDetails(panel, screen) {
    const context = this.getLayerContext(screen);
    const { layerBox, layerList } = this.createLayerBox(context);
    const { placementBox, selectedLayerName, placementList } = this.createPlacementBox();
    panel.append(layerBox, placementBox);
    this.renderLayerRows(layerList, context, selectedLayerName, placementList);
    this.renderLayerPlacements(
      screen,
      this.selectedScreenLayerId,
      selectedLayerName,
      placementList
    );
  }

  /** Returns the layer context. */
  getLayerContext(screen) {
    const { state, services } = this;
    this.dropTargets = new Set();
    const activeStateId = services.getActivePreviewStateId?.(screen) || "default";
    const structureEditable = activeStateId === "default";
    const layers = screen.layers || [];
    const activeScreenFile = state.screens[state.activeScreenIndex]?.file;
    this.syncSelectedLayer(activeScreenFile, layers);
    return { screen, activeStateId, structureEditable, layers };
  }

  /** Synchronizes the selected layer with the current editor state. */
  syncSelectedLayer(activeScreenFile, layers) {
    if (this.selectedScreenFile !== activeScreenFile) {
      this.selectedScreenFile = activeScreenFile;
      this.selectedScreenLayerId = BASE_LAYER_ID;
    }
    if (!layers.some((layer) => layer.id === this.selectedScreenLayerId)) {
      this.selectedScreenLayerId = layers[0]?.id || null;
    }
  }

  /** Builds the inspector section that contains Screen layers and their controls. */
  createLayerBox(context) {
    const { services } = this;
    const { structureEditable } = context;
    const layerBox = services.element("section", "screen-layer-box");
    const layerBoxHeader = services.element("div", "screen-editor-box-header");
    layerBoxHeader.append(services.element("h3", "screen-editor-box-title", "Layers"));
    const layerList = services.element("div", "screen-layer-list");
    layerList.setAttribute("role", "list");
    layerBoxHeader.append(this.createAddLayerButton(structureEditable));
    layerBox.append(layerBoxHeader, layerList);
    if (!structureEditable) {
      layerBox.append(services.element(
        "div",
        "readonly-label",
        "Layer and placement structure can only be edited in the Default state."
      ));
    }
    return { layerBox, layerList };
  }

  /** Creates the control that adds a new Screen layer. */
  createAddLayerButton(structureEditable) {
    const { services } = this;
    const button = services.element("button", "spec-action-button", "Create layer");
    button.type = "button";
    button.disabled = !structureEditable;
    button.addEventListener("click", () =>
      services.createLayer().then((layerId) => {
        this.selectedScreenLayerId = layerId;
        services.renderInspector();
      }).catch(services.showFatalError)
    );
    return button;
  }

  /** Builds the inspector section that lists Screen placements. */
  createPlacementBox() {
    const { services } = this;
    const placementBox = services.element("section", "screen-placement-box");
    const placementHeader = services.element("div", "screen-editor-box-header");
    placementHeader.append(services.element("h3", "screen-editor-box-title", "Placements"));
    const selectedLayerName = services.element("div", "screen-placement-layer-name");
    const placementList = services.element("div", "screen-placement-list");
    placementList.setAttribute("role", "list");
    placementBox.append(placementHeader, selectedLayerName, placementList);
    return { placementBox, selectedLayerName, placementList };
  }

  /** Renders the layer rows from the current editor data. */
  renderLayerRows(layerList, context, selectedLayerName, placementList) {
    context.layers.forEach((layer, index) => {
      layerList.append(this.createLayerRow(layer, index, context, layerList, selectedLayerName, placementList));
    });
  }

  /** Creates a layer row with its name, visibility, ordering, and deletion controls. */
  createLayerRow(layer, index, context, layerList, selectedLayerName, placementList) {
    const { services } = this;
    const { screen, activeStateId, structureEditable } = context;
    const visible = services.isLayerVisible?.(layer, activeStateId, screen) ?? true;
    const selected = layer.id === this.selectedScreenLayerId;
    const row = services.element("div", `screen-layer-row${selected ? " selected" : ""}`);
    row.dataset.layerId = layer.id;
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-current", String(selected));
    row.setAttribute("aria-label", `${layer.name} layer`);
    row.setAttribute("data-layer-id", layer.id);
    row.addEventListener("click", (event) => {
      if (!event.target.closest("button")) {
        this.selectScreenLayer(layer.id, screen, layerList, selectedLayerName, placementList);
      }
    });
    if (structureEditable) this.bindLayerDropTargets(row, layer, screen);
    row.append(this.createDragHandle(
      `Drag ${layer.name} layer to reorder or move placements into it`,
      LAYER_DRAG_TYPE,
      layer.id,
      row,
      !structureEditable
    ));
    row.append(this.createLayerVisibilityButton(layer, visible));
    row.append(this.createLayerNameInput(layer, structureEditable, context, layerList, selectedLayerName, placementList));
    row.append(this.createLayerOrderButton(layer, index, "up", structureEditable));
    row.append(this.createLayerOrderButton(layer, index, "down", structureEditable, context.layers.length));
    row.append(this.createLayerDeleteButton(layer, context));
    return row;
  }

  /** Registers event listeners for layer drop targets interactions. */
  bindLayerDropTargets(row, layer, screen) {
    const { services } = this;
    this.bindDropTarget(row, [
      {
        type: LAYER_DRAG_TYPE,
        insertPosition: true,
        drop: (sourceLayerId, insertAfter) =>
          services.reorderLayer(sourceLayerId, layer.id, insertAfter)
      },
      {
        type: MATERIAL_DRAG_TYPE,
        drop: (materialId) => this.assignDroppedPlacementLayer(materialId, layer)
      }
    ]);
  }

  /** Updates the dropped placement layer for the current editor state. */
  assignDroppedPlacementLayer(materialId, layer) {
    const { services } = this;
    const path = this.parsePlacementPath(materialId);
    if (!path) throw new Error(`Material placement "${materialId}" is no longer available.`);
    if (services.assignPlacementLayer) return services.assignPlacementLayer(path, layer.id);
    if (path.length === 1) return services.assignMaterialLayer(path[0], layer.id);
    throw new Error("A placement inside a group inherits its layer from that group.");
  }

  /** Creates a control that toggles visibility for this layer in the active state. */
  createLayerVisibilityButton(layer, visible) {
    const { services } = this;
    const button = services.element(
      "button",
      `layer-visibility-toggle${visible ? "" : " is-hidden"}`,
      visible ? "Visible" : "Hidden"
    );
    button.type = "button";
    button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${layer.name} layer`);
    button.setAttribute("aria-pressed", String(visible));
    button.addEventListener("click", () =>
      services.setLayerVisibility(layer.id, !visible).catch(services.showFatalError)
    );
    return button;
  }

  /** Creates the editable field used to rename this layer. */
  createLayerNameInput(layer, structureEditable, context, layerList, selectedLayerName, placementList) {
    const { services } = this;
    const input = services.element("input", "layer-name-input");
    input.type = "text";
    input.value = layer.name;
    input.maxLength = 80;
    input.disabled = !structureEditable;
    input.setAttribute("aria-label", `${layer.name} layer name`);
    input.addEventListener("focus", () =>
      this.selectScreenLayer(layer.id, context.screen, layerList, selectedLayerName, placementList)
    );
    input.addEventListener("change", () =>
      services.renameLayer(layer.id, input.value).catch(services.showFatalError)
    );
    return input;
  }

  /** Creates a control that moves this layer in stacking order. */
  createLayerOrderButton(layer, index, direction, structureEditable, layerCount = 0) {
    const { services } = this;
    const isUp = direction === "up";
    const button = services.element("button", "layer-order-button", isUp ? "↑" : "↓");
    button.type = "button";
    button.disabled = !structureEditable || (isUp ? index === 0 : index === layerCount - 1);
    button.title = `Move layer ${direction}`;
    button.setAttribute("aria-label", `Move ${layer.name} layer ${direction}`);
    button.addEventListener("click", () =>
      services.moveLayer(layer.id, isUp ? -1 : 1).catch(services.showFatalError)
    );
    return button;
  }

  /** Creates a guarded action for deleting this layer and its placements. */
  createLayerDeleteButton(layer, context) {
    const { services } = this;
    const button = services.element("button", "layer-delete-button", "×");
    button.type = "button";
    button.disabled = !context.structureEditable || context.layers.length === 1;
    button.title = button.disabled ? "At least one layer must remain" : "Delete layer";
    button.setAttribute("aria-label", `Delete ${layer.name} layer`);
    button.addEventListener("click", () => this.confirmLayerDeletion(layer, context.screen));
    return button;
  }

  /** Updates the layer deletion for the current editor state. */
  confirmLayerDeletion(layer, screen) {
    const { services } = this;
    const assignedCount = screen.materials.filter((material) => material.layer === layer.id).length;
    const message = assignedCount
      ? `Delete "${layer.name}" and its ${assignedCount} placement${assignedCount === 1 ? "" : "s"}?`
      : `Delete "${layer.name}"?`;
    if (services.confirm(message)) services.deleteLayer(layer.id).catch(services.showFatalError);
  }

  /** Selects the screen layer and updates the related editor state. */
  selectScreenLayer(layerId, screen, layerList, selectedLayerName, placementList) {
    this.selectedScreenLayerId = layerId;
    for (const row of layerList.children) {
      const selected = row.dataset.layerId === layerId;
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-current", String(selected));
    }
    this.renderLayerPlacements(
      screen,
      layerId,
      selectedLayerName,
      placementList
    );
  }

  /** Renders the layer placements from the current editor data. */
  renderLayerPlacements(screen, layerId, selectedLayerName, placementList) {
    const { state, services } = this;
    const activeStateId = services.getActivePreviewStateId?.(screen) || "default";
    const structureEditable = activeStateId === "default";
    const layer = screen.layers.find((candidate) => candidate.id === layerId);
    selectedLayerName.textContent = layer ? layer.name : "";
    for (const target of this.placementDropTargets || []) this.dropTargets.delete(target);
    this.placementDropTargets = new Set();
    placementList.replaceChildren();
    const assignedPlacements = screen.materials
      .map((placement, placementIndex) => ({ placement, placementIndex }))
      .filter(({ placement }) => placement.layer === layerId);
    if (assignedPlacements.length === 0) {
      placementList.append(services.element("div", "layer-empty-message", "No placements"));
      return;
    }
    this.expandedGroups ||= new Set();
    const context = {
      screen,
      layerId,
      activeStateId,
      structureEditable,
      selectedPaths: state.activeInstancePaths || [state.activeInstancePath || []],
      selectedLayerName,
      placementList
    };
    this.renderPlacementRows(screen.materials, [], 0, true, context);
  }

  /** Renders the placement rows from the current editor data. */
  renderPlacementRows(placements, parentPath, depth, rootRows, context) {
    const visiblePlacements = this.getVisiblePlacements(placements, rootRows, context.layerId);
    visiblePlacements.forEach(({ placement, index }, orderIndex) => {
      const path = [...parentPath, index];
      const row = this.createPlacementRow(
        placement,
        path,
        depth,
        orderIndex,
        visiblePlacements.length,
        context
      );
      context.placementList.append(row);
      if (isScreenGroup(placement) && this.expandedGroups.has(placement.id)) {
        this.renderPlacementRows(placement.children, path, depth + 1, false, context);
      }
    });
  }

  /** Collects visible root placements in canvas stacking order. */
  getVisiblePlacements(placements, rootRows, layerId) {
    const indexed = placements.map((placement, index) => ({ placement, index }));
    return rootRows ? indexed.filter(({ placement }) => placement.layer === layerId) : indexed;
  }

  /** Builds an inspector row for one placement, including selection and group controls. */
  createPlacementRow(material, path, depth, orderIndex, orderCount, context) {
    const { services } = this;
    const group = isScreenGroup(material);
    const selected = this.isPlacementSelected(path, context.selectedPaths);
    const row = services.element(
      "div",
      `screen-placement-row${selected ? " selected" : ""}${depth ? " nested" : ""}${group ? " has-group-toggle" : ""}`
    );
    row.style?.setProperty("--placement-depth", `${depth * 14}px`);
    row.dataset.placementPath = JSON.stringify(path);
    if (depth === 0) row.dataset.materialIndex = String(path[0]);
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", `${group ? "Group" : "Placement"} ${material.id}`);
    row.tabIndex = 0;
    this.bindPlacementRowDrop(row, material, path, context);
    row.append(this.createDragHandle(
      `Drag ${material.id} to reorder or move it to another layer`,
      MATERIAL_DRAG_TYPE,
      JSON.stringify(path),
      row,
      !context.structureEditable
    ));
    if (group) row.append(this.createPlacementExpandButton(material, context));
    row.append(this.createPlacementSelectButton(material, path, group, row));
    row.append(this.createPlacementVisibilityButton(material, context));
    row.append(...this.createPlacementOrderButtons(material, path, orderIndex, orderCount, context));
    return row;
  }

  /** Checks whether the supplied instance path is in the current selection. */
  isPlacementSelected(path, selectedPaths) {
    return selectedPaths.some((selectedPath) =>
      this.services.sameInstancePath
        ? this.services.sameInstancePath(selectedPath, path)
        : selectedPath.length === path.length &&
          selectedPath.every((part, partIndex) => part === path[partIndex])
    );
  }

  /** Registers event listeners for placement row drop interactions. */
  bindPlacementRowDrop(row, material, path, context) {
    if (!context.structureEditable) return;
    this.bindDropTarget(row, [{
      type: MATERIAL_DRAG_TYPE,
      insertPosition: true,
      drop: (sourcePathText, insertAfter) =>
        this.reorderDroppedPlacement(sourcePathText, material, path, insertAfter)
    }]);
    this.placementDropTargets.add(row);
  }

  /** Updates the dropped placement for the current editor state. */
  reorderDroppedPlacement(sourcePathText, material, path, insertAfter) {
    const { services } = this;
    const sourcePath = this.parsePlacementPath(sourcePathText);
    if (!sourcePath) throw new Error("The dragged placement is no longer available.");
    if (services.reorderPlacement) return services.reorderPlacement(sourcePath, path, insertAfter);
    if (sourcePath.length === 1 && path.length === 1) {
      return services.reorderMaterial(sourcePath[0], material.id, insertAfter);
    }
    throw new Error("Placements can only be reordered among siblings.");
  }

  /** Creates a control that expands or collapses a group placement. */
  createPlacementExpandButton(material, context) {
    const { services } = this;
    const expanded = this.expandedGroups.has(material.id);
    const button = services.element("button", "placement-expand-button", expanded ? "▾" : "▸");
    button.type = "button";
    button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${material.id}`);
    button.setAttribute("aria-expanded", String(expanded));
    button.addEventListener("click", () => {
      if (expanded) this.expandedGroups.delete(material.id);
      else this.expandedGroups.add(material.id);
      this.renderLayerPlacements(
        context.screen,
        context.layerId,
        context.selectedLayerName,
        context.placementList
      );
    });
    return button;
  }

  /** Creates the control that selects this placement path on the canvas. */
  createPlacementSelectButton(material, path, group, row) {
    const { services } = this;
    const button = services.element(
      "button",
      `layer-placement-name${group ? " placement-group-name" : ""}`,
      material.id
    );
    button.type = "button";
    button.title = `Select ${material.id}`;
    button.addEventListener("click", (event) =>
      services.selectInstance(path, material.src || null, { toggle: event.ctrlKey })
    );
    row.addEventListener("contextmenu", (event) =>
      services.openScreenPlacementContextMenu?.(event, path)
    );
    return button;
  }

  /** Creates a control that toggles this placement in the active preview state. */
  createPlacementVisibilityButton(material, context) {
    const { state, services } = this;
    const visible = services.isInstanceVisible(material, context.activeStateId, context.screen);
    const button = services.element(
      "button",
      `placement-visibility-toggle${visible ? "" : " is-hidden"}`,
      visible ? "Visible" : "Hidden"
    );
    button.type = "button";
    button.title = `${visible ? "Hide" : "Show"} ${material.id}`;
    button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${material.id} placement`);
    button.setAttribute("aria-pressed", String(visible));
    button.addEventListener("click", () => {
      const activeScreen = state.screens[state.activeScreenIndex];
      services.setInstanceVisible(activeScreen, material, !visible, context.activeStateId);
      services.markEdited(activeScreen.file);
      services.renderScreen(state.activeScreenIndex, { previewStateSelected: true })
        .catch(services.showFatalError);
    });
    return button;
  }

  /** Creates controls for moving this placement within its layer. */
  createPlacementOrderButtons(material, path, orderIndex, orderCount, context) {
    return [
      this.createPlacementOrderButton(material, path, -1, "↑", orderIndex === 0, context),
      this.createPlacementOrderButton(
        material,
        path,
        1,
        "↓",
        orderIndex === orderCount - 1,
        context
      )
    ];
  }

  /** Creates a control that reorders this placement relative to its neighbors. */
  createPlacementOrderButton(material, path, direction, label, atEdge, context) {
    const { services } = this;
    const movement = direction < 0 ? "up" : "down";
    const button = services.element("button", "placement-order-button", label);
    button.type = "button";
    button.disabled = !context.structureEditable || atEdge;
    button.title = `Move ${material.id} ${movement} in this group`;
    button.setAttribute("aria-label", `Move ${material.id} ${movement} in this group`);
    button.addEventListener("click", () =>
      services.movePlacement(path, direction).catch(services.showFatalError)
    );
    return button;
  }

  /** Parses the placement path into structured editor data. */
  parsePlacementPath(value) {
    try {
      const path = JSON.parse(value);
      return Array.isArray(path) && path.every(Number.isInteger) ? path : null;
    } catch {
      return null;
    }
  }

  /** Creates the pointer handle used to reorder this inspector row. */
  createDragHandle(label, type, value, row, disabled = false) {
    const handle = this.services.element("button", "list-drag-handle", "⠿");
    handle.type = "button";
    handle.disabled = disabled;
    handle.draggable = !disabled;
    handle.title = label;
    handle.setAttribute("aria-label", label);
    handle.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(type, value);
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", () => {
      row.classList.toggle("is-dragging", false);
      this.clearDropIndicators();
    });
    return handle;
  }

  /** Registers event listeners for drop target interactions. */
  bindDropTarget(target, handlers) {
    this.dropTargets.add(target);
    target.addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      const handler = handlers.find((candidate) => types.includes(candidate.type));
      if (!handler) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      this.clearDropIndicators();
      if (handler.insertPosition) {
        const bounds = target.getBoundingClientRect();
        const insertAfter = event.clientY >= bounds.top + bounds.height / 2;
        target.dataset.dropPosition = insertAfter ? "after" : "before";
        target.classList.toggle("drop-before", !insertAfter);
        target.classList.toggle("drop-after", insertAfter);
      } else {
        target.classList.toggle("drop-target", true);
      }
    });
    target.addEventListener("drop", (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      const handler = handlers.find((candidate) => types.includes(candidate.type));
      if (!handler) return;
      event.preventDefault();
      const value = event.dataTransfer.getData(handler.type);
      const insertAfter = target.dataset.dropPosition === "after";
      this.clearDropIndicators();
      if (!value) return;
      try {
        Promise.resolve(handler.drop(value, insertAfter))
          .catch(this.services.showFatalError);
      } catch (error) {
        this.services.showFatalError(error);
      }
    });
  }

  /** Clears the drop indicators and resets its associated state. */
  clearDropIndicators() {
    for (const target of this.dropTargets || []) {
      target.classList.toggle("drop-before", false);
      target.classList.toggle("drop-after", false);
      target.classList.toggle("drop-target", false);
    }
  }

  /** Renders the screen properties from the current editor data. */
  renderScreenProperties(panel, screen) {
    const { state, services } = this;
    const screenEntry = state.screens[state.activeScreenIndex];
    const stateId = services.getActivePreviewStateId(screen);
    const screenStates = this.getSortedScreenStates(screen);
    const selectedState = screenStates.find((candidate) => candidate.id === stateId);
    if (!selectedState) return;
    const isDefault = selectedState.id === "default";
    this.renderScreenEditableProperties(panel, screen, screenEntry, selectedState, stateId, isDefault);
    this.renderScreenStateList(panel, screenStates, stateId, isDefault);
    this.renderScreenStateChanges(panel, screen, screenEntry, stateId, isDefault);
  }

  /** Returns the sorted screen states. */
  getSortedScreenStates(screen) {
    return [...this.services.getScreenPreviewStates(screen)]
      .sort((left, right) => Number(right.id === "default") - Number(left.id === "default"));
  }

  /** Renders the screen editable properties from the current editor data. */
  renderScreenEditableProperties(panel, screen, screenEntry, selectedState, stateId, isDefault) {
    const { services } = this;
    const name = isDefault ? screen.name : selectedState.name;
    const description = isDefault ? screen.description : selectedState.description || "";
    this.appendSection(panel, "Properties");
    services.appendEditableField(
      panel,
      "Name",
      name,
      (value) => this.updateScreenName(screen, screenEntry, stateId, isDefault, value),
      { id: "preview-state-name-detail" }
    );
    services.appendEditableField(
      panel,
      "Description",
      description,
      (value) => this.updateScreenDescription(screen, screenEntry, stateId, isDefault, value),
      {
        id: "preview-state-description-detail",
        multiline: true,
        required: !isDefault
      }
    );
  }

  /** Updates the screen name to reflect the latest editor state. */
  updateScreenName(screen, screenEntry, stateId, isDefault, value) {
    const { services } = this;
    if (!isDefault) return services.renamePreviewState(stateId, value);
    screen.name = value;
    services.renderNavigation();
    services.markEdited(screenEntry.file);
    services.refreshActiveView();
  }

  /** Updates the screen description to reflect the latest editor state. */
  updateScreenDescription(screen, screenEntry, stateId, isDefault, value) {
    const { services } = this;
    if (!isDefault) return services.describePreviewState(stateId, value);
    screen.description = value;
    services.markEdited(screenEntry.file);
    services.refreshActiveView();
  }

  /** Renders the screen state list from the current editor data. */
  renderScreenStateList(panel, screenStates, stateId, isDefault) {
    const { services } = this;
    const screenStatesBox = services.element("section", "screen-property-box");
    const screenStatesHeader = services.element("div", "screen-editor-box-header");
    screenStatesHeader.append(services.element("h3", "screen-editor-box-title", "Screen States"));
    const actions = services.element("div", "screen-editor-box-actions");
    actions.append(this.createAddScreenStateButton());
    actions.append(this.createDeleteScreenStateButton(stateId, isDefault));
    screenStatesHeader.append(actions);
    const stateList = this.createScreenStateRows(screenStates, stateId);
    screenStatesBox.append(screenStatesHeader, stateList);
    panel.append(screenStatesBox);
  }

  /** Creates the action for adding a named Screen preview state. */
  createAddScreenStateButton() {
    const { services } = this;
    const button = services.element("button", "spec-action-button", "Create");
    button.type = "button";
    button.setAttribute("aria-label", "Create Screen State");
    button.addEventListener("click", () =>
      services.addPreviewState().catch(services.showFatalError)
    );
    return button;
  }

  /** Creates the action for deleting the selected named Screen state. */
  createDeleteScreenStateButton(stateId, isDefault) {
    const { services } = this;
    const button = services.element("button", "spec-action-button screen-state-delete", "Delete");
    button.type = "button";
    button.setAttribute("aria-label", "Delete selected Screen State");
    button.disabled = isDefault;
    button.title = isDefault ? "The Default Screen State cannot be deleted." : "";
    button.addEventListener("click", () => {
      if (!isDefault) services.deletePreviewState(stateId).catch(services.showFatalError);
    });
    return button;
  }

  /** Renders the available Screen states and their selection controls. */
  createScreenStateRows(screenStates, stateId) {
    const { services } = this;
    const stateList = services.element("div", "screen-state-list");
    stateList.setAttribute("role", "list");
    stateList.setAttribute("aria-label", "Screen States");
    for (const screenState of screenStates) {
      const stateLabel = screenState.id === "default" ? "Default" : screenState.name;
      const row = services.element(
        "div",
        `screen-state-row${screenState.id === stateId ? " selected" : ""}`
      );
      row.setAttribute("role", "listitem");
      const select = services.element("button", "screen-state-select", stateLabel);
      select.type = "button";
      select.setAttribute("aria-pressed", String(screenState.id === stateId));
      select.addEventListener("click", () =>
        services.switchPreviewState(screenState.id).catch(services.showFatalError)
      );
      row.append(select);
      stateList.append(row);
    }
    return stateList;
  }

  /** Renders the screen state changes from the current editor data. */
  renderScreenStateChanges(panel, screen, screenEntry, stateId, isDefault) {
    const { services } = this;
    const overrides = services.listPreviewStateOverrides(screen, stateId);
    this.syncSelectedOverride(screenEntry, stateId, overrides);
    const selectedOverride = overrides.find((override) =>
      override.key === this.selectedPreviewStateOverrideKey
    );
    const box = services.element("section", "screen-property-box");
    const header = services.element("div", "screen-editor-box-header");
    header.append(services.element("h3", "screen-editor-box-title", "State Changes"));
    if (!isDefault) header.append(this.createResetOverrideButton(screenEntry, stateId, selectedOverride));
    box.append(header);
    if (overrides.length === 0) this.appendEmptyOverrideMessage(box, isDefault);
    else box.append(this.createOverrideList(overrides, screen, stateId));
    panel.append(box);
  }

  /** Synchronizes the selected override with the current editor state. */
  syncSelectedOverride(screenEntry, stateId, overrides) {
    if (this.selectedPreviewStateOverrideStateId !== stateId ||
        this.selectedPreviewStateOverrideScreenFile !== screenEntry.file) {
      this.selectedPreviewStateOverrideKey = null;
      this.selectedPreviewStateOverrideStateId = stateId;
      this.selectedPreviewStateOverrideScreenFile = screenEntry.file;
    }
    if (!overrides.some((override) => override.key === this.selectedPreviewStateOverrideKey)) {
      this.selectedPreviewStateOverrideKey = null;
    }
  }

  /** Creates an action that removes the selected state override. */
  createResetOverrideButton(screenEntry, stateId, selectedOverride) {
    const { state, services } = this;
    const button = services.element("button", "spec-action-button", "Reset");
    button.type = "button";
    button.setAttribute("aria-label", "Reset selected change");
    button.title = "Reset selected change";
    button.disabled = !selectedOverride;
    button.addEventListener("click", () => {
      if (!selectedOverride) return;
      try {
        services.resetPreviewStateOverride(screenEntry, stateId, selectedOverride);
        services.markEdited(screenEntry.file);
        this.selectedPreviewStateOverrideKey = null;
        this.selectedPreviewStateOverrideStateId = null;
        services.renderScreen(state.activeScreenIndex, { previewStateSelected: true })
          .catch(services.showFatalError);
      } catch (error) {
        services.showFatalError(error);
      }
    });
    return button;
  }

  /** Adds the empty override message for the current editor state. */
  appendEmptyOverrideMessage(box, isDefault) {
    box.append(this.services.element(
      "div",
      "readonly-label",
      isDefault
        ? "Default is the base Screen; it has no state changes."
        : "No changes. This Screen State inherits the Default values."
    ));
  }

  /** Builds the list of properties overridden by the selected state. */
  createOverrideList(overrides, screen, stateId) {
    const { services } = this;
    const list = services.element("div", "preview-state-override-list");
    list.setAttribute("role", "list");
    for (const override of overrides) {
      list.append(this.createOverrideRow(override, screen, stateId));
    }
    return list;
  }

  /** Renders one state override with its value and reset action. */
  createOverrideRow(override, screen, stateId) {
    const { services } = this;
    const targetLabel = this.getOverrideTargetLabel(override, screen);
    const valueLabel = this.getOverrideValueLabel(override);
    const selected = override.key === this.selectedPreviewStateOverrideKey;
    const row = services.element(
      "div",
      `preview-state-override-row${selected ? " selected" : ""}`
    );
    row.setAttribute("role", "listitem");
    const select = services.element(
      "button",
      "preview-state-override-select",
      `${targetLabel} · ${this.getOverridePropertyLabel(override)}`
    );
    select.type = "button";
    select.setAttribute("aria-pressed", String(selected));
    select.addEventListener("click", () => {
      this.selectedPreviewStateOverrideKey = override.key;
      this.selectedPreviewStateOverrideStateId = stateId;
      services.renderInspector();
    });
    const value = services.element("span", "preview-state-override-value", valueLabel);
    value.title = valueLabel;
    row.append(select, value);
    return row;
  }

  /** Returns the override target label. */
  getOverrideTargetLabel(override, screen) {
    if (override.kind === "layer") {
      const layerName = screen.layers.find((layer) => layer.id === override.layerId)?.name;
      return `Layer · ${layerName || override.layerId}`;
    }
    const placement = override.kind === "placement"
      ? this.findPlacementById(screen.materials, override.placementId)
      : null;
    const label = placement ? this.services.getElementLabel(placement) : override.placementId;
    return `Placement · ${label}`;
  }

  /** Finds the Screen placement with the supplied ID. */
  findPlacementById(placements, placementId) {
    for (const placement of placements || []) {
      if (placement.id === placementId) return placement;
      const child = this.findPlacementById(placement.children, placementId);
      if (child) return child;
    }
    return null;
  }

  /** Returns the override property label. */
  getOverridePropertyLabel(override) {
    const propertyLabels = {
      visible: "Visibility",
      position: "Position",
      size: "Size",
      rotation: "Rotation",
      scale: "Transform scale",
      affine: "Affine transform",
      attributes: `Attribute · ${override.attributeName}`
    };
    return propertyLabels[override.property] || override.property;
  }

  /** Returns the override value label. */
  getOverrideValueLabel(override) {
    if (override.property === "visible") return override.value ? "Visible" : "Hidden";
    if (override.value === null) return "Clears inherited value";
    if (typeof override.value === "object") return JSON.stringify(override.value);
    return String(override.value);
  }

  /** Renders the project details from the current editor data. */
  renderProjectDetails(panel) {
    const { state, services } = this;
    this.appendSection(panel, "Project");
    this.appendDetail(panel, "Name", state.project.name || "Untitled project");
    this.appendDetail(
      panel,
      "Description",
      state.project.description || "No project description has been provided."
    );
    this.appendDetail(panel, "Screens", state.screens.length);
    this.appendDetail(panel, "Materials", state.screens.reduce(
      (total, screen) => total + (screen.data.materials?.length || 0),
      0
    ));
    this.appendDetail(panel, "Behavior specs", state.specSources.size);
    this.appendDetail(panel, "Theme", state.project.theme || "Not configured");
    this.appendDetail(panel, "Project manifest", "specux/project.yml");
    this.appendSection(panel, "Project-wide behavior spec");
    const pendingDraft = [...state.createdSpecDrafts.entries()]
      .find(([, draft]) => draft.owner === "project");
    const filePath = state.project.spec || pendingDraft?.[0];
    if (filePath) {
      this.appendDetail(panel, "File", filePath);
      const openSpec = services.element(
        "button",
        "spec-action-button",
        state.project.spec ? "Open project-wide behavior spec" : "Open project-wide behavior spec draft"
      );
      openSpec.type = "button";
      openSpec.addEventListener("click", () =>
        services.renderSpecEditor(filePath, [], "project").catch((error) =>
          services.showEditorMessage("Could not open project behavior spec", error.message || String(error))
        )
      );
      panel.append(openSpec);
    } else {
      this.appendDetail(panel, "File", "No project-wide behavior spec attached.");
      const createSpec = services.element("button", "spec-action-button", "Create project-wide behavior spec");
      createSpec.type = "button";
      createSpec.addEventListener("click", () =>
        services.createProjectSpec().catch((error) =>
          services.showEditorMessage("Could not create project behavior spec", error.message || String(error))
        )
      );
      panel.append(createSpec);
    }
  }

  /** Renders the spec details from the current editor data. */
  renderSpecDetails(panel) {
    const { state, services } = this;
    if (state.activeSpecOwner === "project") {
      this.renderProjectSpecDetails(panel);
      return;
    }
    const screen = state.screens.find((entry) =>
      entry.file === state.activeSpecScreenFile
    ) || state.screens[state.activeScreenIndex];
    if (state.activeSpecOwner === "screen") {
      this.renderScreenSpecDetails(panel, screen);
      return;
    }
    const instance = screen && services.getInstanceAtPath(screen, state.activeSpecInstancePath);
    this.renderElementSpecDetails(panel, screen, instance);
  }

  /** Renders the project spec details from the current editor data. */
  renderProjectSpecDetails(panel) {
    const { state } = this;
    this.appendSection(panel, "Project-wide behavior spec");
    this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
    this.appendDetail(panel, "Project", state.project.name || "Untitled project");
    this.appendDetail(panel, "Format", "OpenSpec behavior contract; not executable.");
  }

  /** Renders the screen spec details from the current editor data. */
  renderScreenSpecDetails(panel, screen) {
    const { state } = this;
    this.appendSection(panel, "Screen behavior spec");
    this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
    this.appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
    this.appendDetail(
      panel,
      "Format",
      "OpenSpec behavior contract; use SHOW <state-id> after THEN for Screen States."
    );
  }

  /** Renders the element spec details from the current editor data. */
  renderElementSpecDetails(panel, screen, instance) {
    const { state } = this;
    this.appendSection(panel, "Behavior spec");
    this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
    this.appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
    this.appendDetail(
      panel,
      "Element",
      instance ? this.services.getElementLabel(instance) : "Unavailable"
    );
    this.appendDetail(panel, "Format", "Markdown behavior guidance; not executable.");
  }

  /** Renders the instance details from the current editor data. */
  renderInstanceDetails(panel, instance, _material) {
    const { state, services } = this;
    if (isScreenGroup(instance)) {
      this.renderGroupPlacementDetails(panel, instance);
      return;
    }
    const material = state.materialFiles?.get(instance.src);
    if (material) {
      this.renderMaterialPlacementDetails(panel, instance, material);
      return;
    }
    this.appendSection(panel, "Selected Material");
    this.appendDetail(panel, "Material ID", instance.id);
    this.appendDetail(panel, "Type", instance.type);
    const screen = state.screens[state.activeScreenIndex];
    const stateId = services.getActivePreviewStateId?.(screen.data) || "default";
    const contentProperty = instance.type === "text" ? "content" : "label";
    services.appendEditableField(panel, instance.type === "text" ? "Text" : "Label", instance[contentProperty], (value) => {
      instance[contentProperty] = value;
      services.persistPlacementState(instance);
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: instance.type === "text" });
    const deleteButton = services.element("button", "delete-instance-button", "Delete Material");
    deleteButton.type = "button";
    deleteButton.disabled = stateId !== "default";
    deleteButton.addEventListener("click", () =>
      services.deleteMaterial([...state.activeInstancePath]).catch(services.showFatalError)
    );
    panel.append(deleteButton);
  }

  /** Renders the group placement details from the current editor data. */
  renderGroupPlacementDetails(panel, group) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const stateId = services.getActivePreviewStateId(screen.data);
    this.appendSection(panel, "Placement group");
    this.appendDetail(panel, "Group ID", group.id);
    this.appendDetail(panel, "Children", String(group.children.length));
    if (state.activeInstancePath.length > 1) {
      this.renderNestedGroupTransform(panel, group);
      return;
    }
    this.renderEditableGroupTransform(panel, group, screen);
    this.renderGroupActions(panel, state, services, stateId);
  }

  /** Renders the nested group transform from the current editor data. */
  renderNestedGroupTransform(panel, group) {
    this.appendSection(panel, "Group transform");
    this.appendDetail(panel, "Position", `${group.position?.x ?? 0}, ${group.position?.y ?? 0}`);
    this.appendDetail(panel, "Size", `${group.size?.width ?? "Auto"} × ${group.size?.height ?? "Auto"}`);
    const groupScale = getScaleComponents(group.scale ?? 1);
    this.appendDetail(panel, "Transform scale", `${groupScale.x} × ${groupScale.y}`);
    this.appendDetail(panel, "Rotation", `${group.rotation ?? 0}°`);
    this.appendDetail(
      panel,
      "Transform",
      "This group is controlled by its containing group. Ungroup it to edit its transform."
    );
  }

  /** Renders the editable group transform from the current editor data. */
  renderEditableGroupTransform(panel, group, screen) {
    const { services } = this;
    this.appendSection(panel, "Group transform");
    for (const key of ["x", "y"]) {
      services.appendEditableField(
        panel,
        `Position ${key.toUpperCase()}`,
        group.position[key],
        (value) => {
          if (value === undefined) return;
          group.position[key] = value;
          services.persistPlacementState(group);
          services.markEdited(screen.file);
          services.refreshActiveView();
        },
        { numberFormat: "integer" }
      );
    }
    for (const key of ["width", "height"]) {
      services.appendEditableField(
        panel,
        key === "width" ? "Width" : "Height",
        group.size[key],
        (value) => {
          if (value === undefined) return;
          if (value < 24) {
            services.showEditorMessage("Invalid group size", "Group dimensions must be at least 24 pixels.");
            return;
          }
          const ratio = value / group.size[key];
          const axis = key === "width" ? "x" : "y";
          if (!this.canScaleGroupGeometry(group, axis, ratio)) {
            services.showEditorMessage(
              "Invalid group size",
              "Group dimensions cannot scale a child below 24 pixels."
            );
            return;
          }
          this.scaleGroupGeometry(group, axis, ratio);
          group.size[key] = value;
          services.persistPlacementState(group);
          services.markEdited(screen.file);
          services.refreshActiveView();
        },
        { numberFormat: "integer" }
      );
    }
    this.appendTransformScaleFields(panel, group, screen);
    services.appendEditableField(
      panel,
      "Rotation",
      group.rotation ?? 0,
      (value) => {
        if (value === undefined) return;
        group.rotation = value;
        services.persistPlacementState(group);
        services.markEdited(screen.file);
        services.refreshActiveView();
      },
      { numberFormat: "decimal" }
    );
  }

  /** Renders the group actions from the current editor data. */
  renderGroupActions(panel, state, services, stateId) {
    if (stateId !== "default") return;
    const ungroupButton = services.element("button", "spec-action-button", "Ungroup");
    ungroupButton.type = "button";
    ungroupButton.addEventListener("click", () =>
      services.ungroupPlacement([...state.activeInstancePath]).catch(services.showFatalError)
    );
    panel.append(ungroupButton);
    const deleteButton = services.element(
      "button",
      "delete-instance-button",
      "Delete group and contents"
    );
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => {
      if (!services.confirm("Delete this group and all of its placements?")) return;
      services.deleteMaterial([...state.activeInstancePath]).catch(services.showFatalError);
    });
    panel.append(deleteButton);
  }

  /** Checks whether the current editor state allows scale group geometry. */
  canScaleGroupGeometry(group, axis, ratio) {
    const dimension = axis === "x" ? "width" : "height";
    return group.children.every((child) =>
      child.size[dimension] * ratio >= 24 &&
      (!isScreenGroup(child) || this.canScaleGroupGeometry(child, axis, ratio))
    );
  }

  /** Updates the group geometry for the current editor state. */
  scaleGroupGeometry(group, axis, ratio) {
    for (const child of group.children) {
      const positionAxis = axis;
      const sizeAxis = axis === "x" ? "width" : "height";
      child.position[positionAxis] *= ratio;
      child.size[sizeAxis] *= ratio;
      if (isScreenGroup(child)) this.scaleGroupGeometry(child, axis, ratio);
    }
  }

  /** Renders the material placement details from the current editor data. */
  renderMaterialPlacementDetails(panel, instance, material) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const stateId = services.getActivePreviewStateId(screen.data);
    const isGroupedPlacement = state.activeInstancePath.length > 1;
    this.renderMaterialPlacementHeader(panel, instance, material);
    this.renderInstanceVariables(panel, instance, material, screen, isGroupedPlacement);
    this.renderMaterialPlacementTransform(panel, instance, screen, stateId, isGroupedPlacement);
  }

  /** Renders the material placement header from the current editor data. */
  renderMaterialPlacementHeader(panel, instance, material) {
    const { services } = this;
    this.appendSection(panel, "Material placement");
    this.appendDetail(panel, "Placement ID", instance.id);
    this.appendDetail(panel, "Material", material.data.name || material.id);
    this.appendDetail(panel, "Type", material.data.type);
    this.appendDetail(panel, "File", material.file);
    const openMaterial = services.element("button", "spec-action-button", "Edit shared Material");
    openMaterial.type = "button";
    openMaterial.addEventListener("click", () =>
      services.renderMaterialFile(material.file).catch((error) =>
        services.showEditorMessage("Could not open Material", error.message || String(error))
      )
    );
    panel.append(openMaterial);
  }

  /** Renders the instance variables from the current editor data. */
  renderInstanceVariables(panel, instance, material, screen, isGroupedPlacement) {
    const { services } = this;
    const attributes = Object.entries(material.data.attributes || {})
      .filter(([, definition]) => definition.overridable === true);
    if (!attributes.length) return;
    this.appendSection(panel, "Instance variables");
    for (const [name, definition] of attributes) {
      const value = Object.hasOwn(instance.attributes || {}, name)
        ? instance.attributes[name]
        : definition.default;
      if (isGroupedPlacement) {
        this.appendDetail(panel, name, value === undefined ? "Not set" : String(value));
      } else {
        services.appendEditableField(panel, name, value, (updated) =>
          this.updateInstanceAttribute(instance, name, updated, screen), this.attributeInputOptions(definition));
      }
    }
  }

  /** Updates the instance attribute to reflect the latest editor state. */
  updateInstanceAttribute(instance, name, updated, screen) {
    const { services } = this;
    instance.attributes ||= {};
    if (updated === undefined) delete instance.attributes[name];
    else instance.attributes[name] = updated;
    if (Object.keys(instance.attributes).length === 0) delete instance.attributes;
    services.persistPlacementState(instance);
    services.markEdited(screen.file);
    services.refreshActiveView();
  }

  /** Renders the material placement transform from the current editor data. */
  renderMaterialPlacementTransform(panel, instance, screen, stateId, isGroupedPlacement) {
    this.appendSection(panel, "Placement transform");
    if (isGroupedPlacement) {
      this.renderGroupedPlacementTransform(panel, instance);
      return;
    }
    this.renderEditablePlacementTransform(panel, instance, screen);
    if (stateId === "default") this.renderRemovePlacementButton(panel, instance);
  }

  /** Renders the grouped placement transform from the current editor data. */
  renderGroupedPlacementTransform(panel, instance) {
    this.appendDetail(panel, "Position", `${instance.position?.x ?? 0}, ${instance.position?.y ?? 0}`);
    this.appendDetail(panel, "Size", `${instance.size?.width ?? "Auto"} × ${instance.size?.height ?? "Auto"}`);
    const instanceScale = getScaleComponents(instance.scale ?? 1);
    this.appendDetail(panel, "Transform scale", `${instanceScale.x} × ${instanceScale.y}`);
    this.appendDetail(panel, "Rotation", `${instance.rotation ?? 0}°`);
    this.appendDetail(
      panel,
      "Transform",
      "This placement is controlled by its group. Ungroup it to edit its transform."
    );
  }

  /** Renders the editable placement transform from the current editor data. */
  renderEditablePlacementTransform(panel, instance, screen) {
    const { services } = this;
    this.appendPositionFields(panel, instance, screen);
    this.appendSizeFields(panel, instance, screen);
    this.appendTransformScaleFields(panel, instance, screen);
    this.appendPlacementRotationField(panel, instance, screen);
  }

  /** Adds the position fields for the current editor state. */
  appendPositionFields(panel, instance, screen) {
    const { services } = this;
    for (const key of ["x", "y"]) {
      services.appendEditableField(
        panel,
        `Position ${key.toUpperCase()}`,
        instance.position?.[key],
        (value) => this.updateMaterialTransform(instance, "position", key, value, screen),
        { numberFormat: "integer" }
      );
    }
  }

  /** Adds the size fields for the current editor state. */
  appendSizeFields(panel, instance, screen) {
    const { services } = this;
    for (const key of ["width", "height"]) {
      services.appendEditableField(
        panel,
        key === "width" ? "Width" : "Height",
        instance.size?.[key],
        (value) => this.updateMaterialTransform(instance, "size", key, value, screen, 24),
        { numberFormat: "integer" }
      );
    }
  }

  /** Updates the material transform to reflect the latest editor state. */
  updateMaterialTransform(instance, property, key, value, screen, minimum = null) {
    const { services } = this;
    if (value === undefined) return;
    if (minimum !== null && value < minimum) {
      services.showEditorMessage(
        "Invalid Material size",
        `Material ${key} must be at least ${minimum} pixels.`
      );
      return;
    }
    instance[property] ||= {};
    instance[property][key] = value;
    services.persistPlacementState(instance);
    services.markEdited(screen.file);
    services.refreshActiveView();
  }

  /** Adds the placement rotation field for the current editor state. */
  appendPlacementRotationField(panel, instance, screen) {
    const { services } = this;
    services.appendEditableField(
      panel,
      "Rotation",
      instance.rotation ?? 0,
      (value) => {
        if (value === undefined) return;
        instance.rotation = value;
        services.persistPlacementState(instance);
        services.markEdited(screen.file);
        services.refreshActiveView();
      },
      { numberFormat: "integer" }
    );
  }

  /** Renders the remove placement button from the current editor data. */
  renderRemovePlacementButton(panel, instance) {
    const { state, services } = this;
    const deleteButton = services.element("button", "delete-instance-button", "Remove placement");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () =>
      services.deleteMaterial([...state.activeInstancePath]).catch(services.showFatalError)
    );
    panel.append(deleteButton);
  }

  /** Adds the transform scale fields for the current editor state. */
  appendTransformScaleFields(panel, placement, screen) {
    const { services } = this;
    const scale = getScaleComponents(placement.scale ?? 1);
    for (const axis of ["x", "y"]) {
      services.appendEditableField(
        panel,
        `Transform scale ${axis.toUpperCase()}`,
        scale[axis],
        (value) => {
          if (value === undefined) return;
          if (value <= 0) {
            services.showEditorMessage(
              "Invalid scale",
              "Transform scale factors must be greater than zero."
            );
            return;
          }

          const updated = getScaleComponents(placement.scale ?? 1);
          updated[axis] = value;
          placement.scale = serializeScale(updated);
          services.persistPlacementState(placement);
          services.markEdited(screen.file);
          services.refreshActiveView();
        },
        { numberFormat: "decimal" }
      );
    }
  }

  /** Renders the material file details from the current editor data. */
  renderMaterialFileDetails(panel, material) {
    if (!material) return;
    this.appendSection(panel, "Reusable Material");
    this.appendDetail(panel, "Name", material.data.name);
    this.appendDetail(panel, "Material ID", material.id);
    this.appendDetail(panel, "Type", material.data.type);
    this.appendDetail(panel, "File", material.file);
    if (material.data.description) {
      this.appendDetail(panel, "Description", material.data.description);
    }
    for (const [name, definition] of Object.entries(material.data.attributes || {})) {
      this.appendDetail(panel, `${name} variable`, `${definition.type}${definition.overridable ? " (overridable)" : ""}`);
    }
    panel.append(this.services.element(
      "div",
      "readonly-label",
      "Changes to this file update every Screen placement that references it."
    ));
    const placeButton = this.services.element(
      "button",
      "spec-action-button",
      "Place on current Screen"
    );
    placeButton.type = "button";
    placeButton.disabled = this.state.screens.length === 0 ||
      this.services.getActivePreviewStateId(
        this.state.screens[this.state.activeScreenIndex]?.data
      ) !== "default";
    if (placeButton.disabled && this.state.screens.length > 0) {
      placeButton.title = "Switch to the Default state to add placements.";
    }
    placeButton.addEventListener("click", () =>
      this.services.placeMaterialFile(material.file).catch(this.services.showFatalError)
    );
    panel.append(placeButton);
  }

  /** Adds the section for the current editor state. */
  appendSection(parent, title) {
    parent.append(this.services.element("div", "section-title", title));
  }

  /** Adds the detail for the current editor state. */
  appendDetail(parent, label, value) {
    if (value === undefined || value === null || value === "") return;
    parent.append(this.services.element("div", "detail-label", label));
    parent.append(this.services.element("div", "detail-value", String(value)));
  }

  /** Adds the note for the current editor state. */
  appendNote(parent, label, text) {
    parent.append(this.services.element("div", "detail-label", label));
    parent.append(this.services.element("div", "note-box", text));
  }

  /** Updates the input options for the current editor state. */
  attributeInputOptions(definition) {
    if (definition.type === "boolean") return { checkbox: true };
    if (definition.type === "list") return { selectOptions: definition.options || [] };
    if (definition.type === "number") return { numberFormat: definition.format || "decimal" };
    return {};
  }
}
