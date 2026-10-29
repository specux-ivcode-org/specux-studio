import { BASE_LAYER_ID } from "../../shared/ScreenLayers.mjs";
import { isScreenGroup } from "../../shared/ScreenGroups.mjs";

const LAYER_DRAG_TYPE = "application/x-specux-layer";
const MATERIAL_DRAG_TYPE = "application/x-specux-material";

export class InspectorRenderer {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.screenDetailsTab = "properties";
    this.selectedScreenFile = null;
    this.selectedScreenLayerId = BASE_LAYER_ID;
  }

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
    } else if (state.viewingAssetTemplate) {
      this.renderTemplateDetails(panel, state.assets.get(state.activeAssetId));
    } else if (state.viewingMaterialFile) {
      this.renderMaterialFileDetails(
        panel,
        state.materialFiles.get(state.activeMaterialFilePath)
      );
    } else {
      const screen = state.screens[state.activeScreenIndex]?.data;
      if (!screen) return;
      const instance = state.activeInstancePath.length
        ? services.getInstanceAtPath({ data: screen }, state.activeInstancePath)
        : null;
      const template = instance?.type === "template"
        ? services.getTemplateByPath(instance.src)
        : null;
      this.renderScreenEditorDetails(
        panel,
        screen,
        instance,
        template,
        state.viewingPreviewState
      );
    }
  }

  renderScreenEditorDetails(panel, screen, instance, template, viewingPreviewState) {
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
    } else if (viewingPreviewState) {
      this.renderPreviewStateDetails(content);
    } else if (instance) {
      this.renderInstanceDetails(content, instance, template);
    } else {
      this.renderScreenDetails(content, screen);
      this.renderReviewControls(content);
    }
  }

  renderLayersDetails(panel, screen) {
    const { state, services } = this;
    this.dropTargets = new Set();
    const layers = screen.layers || [];
    const activeScreenFile = state.screens[state.activeScreenIndex]?.file;
    if (this.selectedScreenFile !== activeScreenFile) {
      this.selectedScreenFile = activeScreenFile;
      this.selectedScreenLayerId = BASE_LAYER_ID;
    }
    if (!layers.some((layer) => layer.id === this.selectedScreenLayerId)) {
      this.selectedScreenLayerId = layers[0]?.id || null;
    }

    const layerBox = services.element("section", "screen-layer-box");
    const layerBoxHeader = services.element("div", "screen-editor-box-header");
    layerBoxHeader.append(services.element("h3", "screen-editor-box-title", "Layers"));
    const layerList = services.element("div", "screen-layer-list");
    layerList.setAttribute("role", "list");
    const addLayer = services.element("button", "spec-action-button", "Create layer");
    addLayer.type = "button";
    addLayer.addEventListener("click", () =>
      services.createLayer().then((layerId) => {
        this.selectedScreenLayerId = layerId;
        services.renderInspector();
      }).catch(services.showFatalError)
    );
    layerBoxHeader.append(addLayer);
    layerBox.append(layerBoxHeader, layerList);

    const placementBox = services.element("section", "screen-placement-box");
    const placementHeader = services.element("div", "screen-editor-box-header");
    placementHeader.append(services.element("h3", "screen-editor-box-title", "Placements"));
    const selectedLayerName = services.element("div", "screen-placement-layer-name");
    const placementList = services.element("div", "screen-placement-list");
    placementList.setAttribute("role", "list");
    placementBox.append(placementHeader, selectedLayerName, placementList);
    panel.append(layerBox, placementBox);

    const entries = layers.map((layer, index) => ({ layer, index }));
    for (const entry of entries) {
      const { layer, index } = entry;
      const visible = layer.visible !== false;
      const isSelected = layer.id === this.selectedScreenLayerId;
      const row = services.element(
        "div",
        `screen-layer-row${isSelected ? " selected" : ""}`
      );
      row.dataset.layerId = layer.id;
      row.setAttribute("role", "listitem");
      row.setAttribute("aria-current", String(isSelected));
      row.setAttribute("aria-label", `${layer.name} layer`);
      row.setAttribute("data-layer-id", layer.id);
      row.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        this.selectScreenLayer(
          layer.id,
          screen,
          layerList,
          selectedLayerName,
          placementList
        );
      });
      this.bindDropTarget(row, [
        {
          type: LAYER_DRAG_TYPE,
          insertPosition: true,
          drop: (sourceLayerId, insertAfter) =>
            services.reorderLayer(sourceLayerId, layer.id, insertAfter)
        },
        {
          type: MATERIAL_DRAG_TYPE,
          drop: (materialId) => {
            const path = this.parsePlacementPath(materialId);
            if (!path) {
              throw new Error(`Material placement "${materialId}" is no longer available.`);
            }
            if (services.assignPlacementLayer) {
              return services.assignPlacementLayer(path, layer.id);
            }
            if (path.length === 1) return services.assignMaterialLayer(path[0], layer.id);
            throw new Error("A placement inside a group inherits its layer from that group.");
          }
        }
      ]);

      row.append(this.createDragHandle(
        `Drag ${layer.name} layer to reorder or move placements into it`,
        LAYER_DRAG_TYPE,
        layer.id,
        row
      ));

      const visibility = services.element(
        "button",
        `layer-visibility-toggle${visible ? "" : " is-hidden"}`,
        visible ? "Visible" : "Hidden"
      );
      visibility.type = "button";
      visibility.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${layer.name} layer`);
      visibility.setAttribute("aria-pressed", String(visible));
      visibility.addEventListener("click", () =>
        services.setLayerVisibility(layer.id, !visible).catch(services.showFatalError)
      );
      row.append(visibility);

      const name = services.element("input", "layer-name-input");
      name.type = "text";
      name.value = layer.name;
      name.maxLength = 80;
      name.setAttribute("aria-label", `${layer.name} layer name`);
      name.addEventListener("focus", () =>
        this.selectScreenLayer(
          layer.id,
          screen,
          layerList,
          selectedLayerName,
          placementList
        )
      );
      name.addEventListener("change", () =>
        services.renameLayer(layer.id, name.value).catch(services.showFatalError)
      );
      row.append(name);
      const moveUp = services.element("button", "layer-order-button", "↑");
      moveUp.type = "button";
      moveUp.disabled = index === 0;
      moveUp.title = "Move layer up";
      moveUp.setAttribute("aria-label", `Move ${layer.name} layer up`);
      moveUp.addEventListener("click", () =>
        services.moveLayer(layer.id, -1).catch(services.showFatalError)
      );
      row.append(moveUp);
      const moveDown = services.element("button", "layer-order-button", "↓");
      moveDown.type = "button";
      moveDown.disabled = index === layers.length - 1;
      moveDown.title = "Move layer down";
      moveDown.setAttribute("aria-label", `Move ${layer.name} layer down`);
      moveDown.addEventListener("click", () =>
        services.moveLayer(layer.id, 1).catch(services.showFatalError)
      );
      row.append(moveDown);
      const remove = services.element("button", "layer-delete-button", "×");
      remove.type = "button";
      remove.disabled = layers.length === 1;
      remove.title = remove.disabled
        ? "At least one layer must remain"
        : "Delete layer";
      remove.setAttribute("aria-label", `Delete ${layer.name} layer`);
      remove.addEventListener("click", () => {
        const assignedCount = screen.materials.filter((material) => material.layer === layer.id).length;
        const message = assignedCount
          ? `Delete "${layer.name}" and its ${assignedCount} placement${assignedCount === 1 ? "" : "s"}?`
          : `Delete "${layer.name}"?`;
        if (services.confirm(message)) {
          services.deleteLayer(layer.id).catch(services.showFatalError);
        }
      });
      row.append(remove);
      layerList.append(row);
    }
    this.renderLayerPlacements(
      screen,
      this.selectedScreenLayerId,
      selectedLayerName,
      placementList
    );
  }

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

  renderLayerPlacements(screen, layerId, selectedLayerName, placementList) {
    const { state, services } = this;
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
    const selectedPaths = state.activeInstancePaths || [state.activeInstancePath || []];
    const renderRows = (placements, parentPath = [], depth = 0, rootRows = false) => {
      const visiblePlacements = rootRows
        ? placements
          .map((placement, index) => ({ placement, index }))
          .filter(({ placement }) => placement.layer === layerId)
        : placements.map((placement, index) => ({ placement, index }));
      for (const [orderIndex, { placement: material, index: materialIndex }] of
        visiblePlacements.entries()) {
        const path = [...parentPath, materialIndex];
        const group = isScreenGroup(material);
        const selected = selectedPaths.some((selectedPath) =>
          services.sameInstancePath
            ? services.sameInstancePath(selectedPath, path)
            : selectedPath.length === path.length &&
              selectedPath.every((part, partIndex) => part === path[partIndex])
        );
        const row = services.element(
          "div",
          `screen-placement-row${selected ? " selected" : ""}${depth ? " nested" : ""}${group ? " has-group-toggle" : ""}`
        );
        row.style?.setProperty("--placement-depth", `${depth * 14}px`);
        row.dataset.placementPath = JSON.stringify(path);
        if (depth === 0) row.dataset.materialIndex = String(materialIndex);
        row.setAttribute("role", "listitem");
        row.setAttribute("aria-label", `${group ? "Group" : "Placement"} ${material.id}`);
        row.tabIndex = 0;
        this.bindDropTarget(row, [{
          type: MATERIAL_DRAG_TYPE,
          insertPosition: true,
          drop: (sourcePathText, insertAfter) => {
            const sourcePath = this.parsePlacementPath(sourcePathText);
            if (!sourcePath) throw new Error("The dragged placement is no longer available.");
            if (services.reorderPlacement) {
              return services.reorderPlacement(sourcePath, path, insertAfter);
            }
            if (sourcePath.length === 1 && path.length === 1) {
              return services.reorderMaterial(sourcePath[0], material.id, insertAfter);
            }
            throw new Error("Placements can only be reordered among siblings.");
          }
        }]);
        this.placementDropTargets.add(row);
        row.append(this.createDragHandle(
          `Drag ${material.id} to reorder or move it to another layer`,
          MATERIAL_DRAG_TYPE,
          JSON.stringify(path),
          row
        ));
        if (group) {
          const expand = services.element(
            "button",
            "placement-expand-button",
            this.expandedGroups.has(material.id) ? "▾" : "▸"
          );
          expand.type = "button";
          expand.setAttribute(
            "aria-label",
            `${this.expandedGroups.has(material.id) ? "Collapse" : "Expand"} ${material.id}`
          );
          expand.setAttribute("aria-expanded", String(this.expandedGroups.has(material.id)));
          expand.addEventListener("click", () => {
            if (this.expandedGroups.has(material.id)) this.expandedGroups.delete(material.id);
            else this.expandedGroups.add(material.id);
            this.renderLayerPlacements(screen, layerId, selectedLayerName, placementList);
          });
          row.append(expand);
        }
        const selectPlacement = services.element(
          "button",
          `layer-placement-name${group ? " placement-group-name" : ""}`,
          material.id
        );
        selectPlacement.type = "button";
        selectPlacement.title = `Select ${material.id}`;
        selectPlacement.addEventListener("click", (event) =>
          services.selectInstance(path, material.src || null, { toggle: event.ctrlKey })
        );
        row.addEventListener("contextmenu", (event) =>
          services.openScreenPlacementContextMenu?.(event, path)
        );
        row.append(selectPlacement);

        const orderCount = visiblePlacements.length;
        for (const [direction, label, disabled] of [
          [-1, "↑", orderIndex === 0],
          [1, "↓", orderIndex === orderCount - 1]
        ]) {
          const move = services.element("button", "placement-order-button", label);
          move.type = "button";
          move.disabled = disabled;
          move.title = `Move ${material.id} ${direction < 0 ? "up" : "down"} in this group`;
          move.setAttribute(
            "aria-label",
            `Move ${material.id} ${direction < 0 ? "up" : "down"} in this group`
          );
          move.addEventListener("click", () =>
            services.movePlacement(path, direction).catch(services.showFatalError)
          );
          row.append(move);
        }
        placementList.append(row);
        if (group && this.expandedGroups.has(material.id)) {
          renderRows(material.children, path, depth + 1);
        }
      }
    };
    renderRows(screen.materials, [], 0, true);
  }

  parsePlacementPath(value) {
    try {
      const path = JSON.parse(value);
      return Array.isArray(path) && path.every(Number.isInteger) ? path : null;
    } catch {
      return null;
    }
  }

  createDragHandle(label, type, value, row) {
    const handle = this.services.element("button", "list-drag-handle", "⠿");
    handle.type = "button";
    handle.draggable = true;
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

  clearDropIndicators() {
    for (const target of this.dropTargets || []) {
      target.classList.toggle("drop-before", false);
      target.classList.toggle("drop-after", false);
      target.classList.toggle("drop-target", false);
    }
  }

  renderPreviewStateDetails(panel) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const stateId = services.getActivePreviewStateId(screen.data);
    const previewState = services.getScreenPreviewStates(screen.data)
      .find((candidate) => candidate.id === stateId);
    if (!previewState) return;
    this.appendSection(panel, "Preview state");
    services.appendEditableField(
      panel,
      "State name",
      previewState.name,
      (value) => services.renamePreviewState(stateId, value),
      { id: "preview-state-name-detail" }
    );
    if (stateId !== "default") {
      services.appendEditableField(
        panel,
        "Description (required)",
        previewState.description || "",
        (value) => services.describePreviewState(stateId, value),
        { id: "preview-state-description-detail", multiline: true, required: true }
      );
    }
    this.appendDetail(panel, "State ID", previewState.id);
    if (stateId !== "default") {
      const deleteButton = services.element("button", "spec-action-button", `Delete ${previewState.name}`);
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () =>
        services.deletePreviewState(stateId).catch(services.showFatalError)
      );
      panel.append(deleteButton);
    }
    this.appendSection(panel, "Material visibility");
    let visibleInstances = 0;
    const renderVisibility = (instance, instancePath, depth) => {
      const label = services.getElementLabel(instance);
      visibleInstances += 1;
      services.appendEditableField(
        panel,
        `${"— ".repeat(depth)}${label}`,
        services.isInstanceVisible(instance, stateId),
        (visible) => {
          instance.visibility ||= {};
          if (visible) delete instance.visibility[stateId];
          else instance.visibility[stateId] = false;
          if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
          services.markEdited(screen.file);
          services.renderScreen(state.activeScreenIndex, { previewStateSelected: true })
            .catch(services.showFatalError);
        },
        { checkbox: true }
      );
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (Array.isArray(children)) {
          children.forEach((child, index) =>
            renderVisibility(child, [...instancePath, slotId, index], depth + 1)
          );
        }
      }
    };
    (screen.data.materials || []).forEach((instance, index) =>
      renderVisibility(instance, [index], 0)
    );
    if (visibleInstances === 0) this.appendDetail(panel, "Materials", "This Screen has no materials.");
  }

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
    this.appendDetail(panel, "Theme", state.theme?.name || "Not configured");
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

  renderSpecDetails(panel) {
    const { state, services } = this;
    if (state.activeSpecOwner === "project") {
      this.appendSection(panel, "Project-wide behavior spec");
      this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
      this.appendDetail(panel, "Project", state.project.name || "Untitled project");
      this.appendDetail(panel, "Format", "OpenSpec behavior contract; not executable.");
      return;
    }
    const screen = state.screens[state.activeScreenIndex];
    if (state.activeSpecOwner === "screen") {
      this.appendSection(panel, "Screen behavior spec");
      this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
      this.appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
      this.appendDetail(
        panel,
        "Format",
        "OpenSpec behavior contract; use SHOW <state-id> after THEN for preview states."
      );
      return;
    }
    const instance = screen && services.getInstanceAtPath(screen, state.activeSpecInstancePath);
    this.appendSection(panel, "Behavior spec");
    this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
    this.appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
    this.appendDetail(panel, "Element", instance ? services.getElementLabel(instance) : "Unavailable");
    this.appendDetail(panel, "Format", "Markdown behavior guidance; not executable.");
  }

  renderScreenDetails(panel, screen) {
    const { state, services } = this;
    this.appendSection(panel, "Screen");
    services.appendEditableField(panel, "Name", screen.name, (value) => {
      screen.name = value;
      services.renderNavigation();
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    });
    services.appendEditableField(panel, "Description", screen.description, (value) => {
      screen.description = value;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: true });
    services.appendEditableField(panel, "AI note (optional)", screen.note || "", (value) => {
      if (value) screen.note = value;
      else delete screen.note;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: true });
    this.appendSection(panel, "Screen behavior spec");
    const pendingSpec = [...state.createdSpecDrafts.entries()].find(([, draft]) =>
      draft.owner === "screen" && draft.screenFile === state.screens[state.activeScreenIndex].file
    );
    const screenSpecPath = screen.spec || pendingSpec?.[0];
    if (screenSpecPath) {
      this.appendDetail(panel, "File", screenSpecPath);
      const openSpec = services.element(
        "button",
        "spec-action-button",
        screen.spec ? "Open Screen behavior spec" : "Open Screen behavior spec draft"
      );
      openSpec.type = "button";
      openSpec.addEventListener("click", () =>
        services.renderSpecEditor(screenSpecPath, [], "screen").catch((error) =>
          services.showEditorMessage("Could not open Screen behavior spec", error.message || String(error))
        )
      );
      panel.append(openSpec);
    } else {
      this.appendDetail(panel, "File", "No Screen behavior spec attached.");
      const createSpec = services.element("button", "spec-action-button", "Create Screen behavior spec");
      createSpec.type = "button";
      createSpec.addEventListener("click", () =>
        services.createSpecForScreen().catch((error) =>
          services.showEditorMessage("Could not create Screen behavior spec", error.message || String(error))
        )
      );
      panel.append(createSpec);
    }
    this.appendSection(panel, "Other preview states");
    const activeStateId = services.getActivePreviewStateId(screen);
    for (const previewState of services.getScreenPreviewStates(screen)) {
      if (previewState.id === "default" || previewState.id === activeStateId) continue;
      const deleteButton = services.element("button", "spec-action-button", `Delete ${previewState.name}`);
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () =>
        services.deletePreviewState(previewState.id).catch(services.showFatalError)
      );
      panel.append(deleteButton);
    }
    this.appendSection(panel, "Materials in Screen");
    services.renderScreenInstanceTree(panel, screen.materials || [], [], 0, activeStateId);
  }

  renderReviewControls(panel) {
    const { state, services } = this;
    const review = services.element("div", "readonly-label");
    const message = services.element(
      "div",
      "",
      state.reviewedInSession
        ? "Reviewed in this session; not saved."
        : "Review the rendered preview before accepting the design."
    );
    message.id = "review-message";
    review.append(message);
    const button = services.element(
      "button",
      "review-action",
      state.reviewedInSession ? "Clear review mark" : "Mark reviewed"
    );
    button.type = "button";
    button.id = "review-toggle";
    button.addEventListener("click", () => {
      state.reviewedInSession = !state.reviewedInSession;
      services.renderInspector();
    });
    review.append(button);
    panel.append(review);
  }

  renderInstanceDetails(panel, instance) {
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
    const contentProperty = instance.type === "text" ? "content" : "label";
    services.appendEditableField(panel, instance.type === "text" ? "Text" : "Label", instance[contentProperty], (value) => {
      instance[contentProperty] = value;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: instance.type === "text" });
    if (state.activeInstancePath.length > 0) {
      const screen = state.screens[state.activeScreenIndex];
      const stateId = services.getActivePreviewStateId(screen.data);
      const previewState = services.getScreenPreviewStates(screen.data)
        .find((candidate) => candidate.id === stateId);
      this.appendSection(panel, `Visibility · ${previewState?.name || "Default"}`);
      services.appendEditableField(
        panel,
        `Visible in ${previewState?.name || "Default"}`,
        services.isInstanceVisible(instance, stateId),
        (visible) => {
          instance.visibility ||= {};
          if (visible) delete instance.visibility[stateId];
          else instance.visibility[stateId] = false;
          if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
          services.markEdited(screen.file);
          services.refreshActiveView();
        },
        { checkbox: true }
      );
    }
    const deleteButton = services.element("button", "delete-instance-button", "Delete Material");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () =>
      services.deleteMaterial([...state.activeInstancePath]).catch(services.showFatalError)
    );
    panel.append(deleteButton);
  }

  renderGroupPlacementDetails(panel, group) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    this.appendSection(panel, "Placement group");
    this.appendDetail(panel, "Group ID", group.id);
    this.appendDetail(panel, "Children", String(group.children.length));
    if (state.activeInstancePath.length > 1) {
      this.appendSection(panel, "Group transform");
      this.appendDetail(
        panel,
        "Position",
        `${group.position?.x ?? 0}, ${group.position?.y ?? 0}`
      );
      this.appendDetail(
        panel,
        "Size",
        `${group.size?.width ?? "Auto"} × ${group.size?.height ?? "Auto"}`
      );
      this.appendDetail(panel, "Uniform scale", String(group.scale ?? 1));
      this.appendDetail(panel, "Rotation", `${group.rotation ?? 0}°`);
      this.appendDetail(
        panel,
        "Transform",
        "This group is controlled by its containing group. Ungroup it to edit its transform."
      );
      return;
    }
    this.appendSection(panel, "Group transform");
    for (const key of ["x", "y"]) {
      services.appendEditableField(
        panel,
        `Position ${key.toUpperCase()}`,
        group.position[key],
        (value) => {
          if (value === undefined) return;
          group.position[key] = value;
          services.markEdited(screen.file);
          services.refreshActiveView();
        },
        { numberFormat: "integer" }
      );
    }
    services.appendEditableField(
      panel,
      "Uniform scale",
      group.scale ?? 1,
      (value) => {
        if (value === undefined) return;
        if (value <= 0) {
          services.showEditorMessage("Invalid scale", "Uniform scale must be greater than zero.");
          return;
        }
        group.scale = value;
        services.markEdited(screen.file);
        services.refreshActiveView();
      },
      { numberFormat: "decimal" }
    );
    services.appendEditableField(
      panel,
      "Rotation",
      group.rotation ?? 0,
      (value) => {
        if (value === undefined) return;
        group.rotation = value;
        services.markEdited(screen.file);
        services.refreshActiveView();
      },
      { numberFormat: "decimal" }
    );
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

  renderMaterialPlacementDetails(panel, instance, material) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const isGroupedPlacement = state.activeInstancePath.length > 1;
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

    const attributes = Object.entries(material.data.attributes || {})
      .filter(([, definition]) => definition.overridable === true);
    if (attributes.length) {
      this.appendSection(panel, "Instance variables");
      for (const [name, definition] of attributes) {
        const value = Object.hasOwn(instance.attributes || {}, name)
          ? instance.attributes[name]
          : definition.default;
        if (isGroupedPlacement) {
          this.appendDetail(panel, name, value === undefined ? "Not set" : String(value));
        } else {
          services.appendEditableField(panel, name, value, (updated) => {
            instance.attributes ||= {};
            if (updated === undefined) delete instance.attributes[name];
            else instance.attributes[name] = updated;
            if (Object.keys(instance.attributes).length === 0) delete instance.attributes;
            services.markEdited(screen.file);
            services.refreshActiveView();
          }, this.attributeInputOptions(definition));
        }
      }
    }

    this.appendSection(panel, "Placement transform");
    if (isGroupedPlacement) {
      this.appendDetail(panel, "Position", `${instance.position?.x ?? 0}, ${instance.position?.y ?? 0}`);
      this.appendDetail(
        panel,
        "Size",
        `${instance.size?.width ?? "Auto"} × ${instance.size?.height ?? "Auto"}`
      );
      this.appendDetail(panel, "Rotation", `${instance.rotation ?? 0}°`);
      this.appendDetail(
        panel,
        "Transform",
        "This placement is controlled by its group. Ungroup it to edit its transform."
      );
      return;
    }
    const update = (property, key, value, minimum = null) => {
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
      services.markEdited(screen.file);
      services.refreshActiveView();
    };
    for (const key of ["x", "y"]) {
      services.appendEditableField(
        panel,
        `Position ${key.toUpperCase()}`,
        instance.position?.[key],
        (value) => update("position", key, value),
        { numberFormat: "integer" }
      );
    }
    for (const key of ["width", "height"]) {
      services.appendEditableField(
        panel,
        key === "width" ? "Width" : "Height",
        instance.size?.[key],
        (value) => update("size", key, value, 24),
        { numberFormat: "integer" }
      );
    }
    services.appendEditableField(
      panel,
      "Rotation",
      instance.rotation ?? 0,
      (value) => {
        if (value === undefined) return;
        instance.rotation = value;
        services.markEdited(screen.file);
        services.refreshActiveView();
      },
      { numberFormat: "integer" }
    );
    const deleteButton = services.element("button", "delete-instance-button", "Remove placement");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () =>
      services.deleteMaterial([...state.activeInstancePath]).catch(services.showFatalError)
    );
    panel.append(deleteButton);
  }

  renderTemplateDetails(panel, template) {
    const { services } = this;
    if (!template) return;
    this.appendSection(panel, "Asset template");
    services.appendEditableField(panel, "Name", template.data.name, (value) => {
      template.data.name = value;
      services.renderNavigation();
      services.markAssetTemplateEdited(template);
      services.refreshActiveView();
    });
    services.appendEditableField(panel, "Description", template.data.description, (value) => {
      template.data.description = value;
      services.markAssetTemplateEdited(template);
      services.refreshActiveView();
    }, { multiline: true });
    if (template.data.slots) {
      this.appendSection(panel, "Drop zones");
      for (const slot of template.data.slots) {
        this.appendDetail(panel, slot.name || slot.id, `Named slot: ${slot.id}`);
      }
    }
    for (const [name, definition] of Object.entries(template.data.attributes || {})) {
      services.appendEditableField(panel, `${name} type`, definition.type, (value) => {
        definition.type = value;
        delete definition.format;
        delete definition.options;
        if (value === "string") {
          if (definition.default !== undefined) definition.default = String(definition.default);
        } else if (value === "boolean") {
          if (typeof definition.default !== "boolean") definition.default = false;
        } else if (value === "number") {
          definition.format = "decimal";
          if (definition.default !== undefined) {
            const parsed = Number(definition.default);
            if (String(definition.default).trim() && Number.isFinite(parsed)) definition.default = parsed;
            else delete definition.default;
          }
        } else if (value === "list") {
          definition.options = [];
          if (definition.default !== undefined) delete definition.default;
        }
        services.markAssetTemplateEdited(template);
        services.refreshActiveView();
      }, { selectOptions: services.attributeTypes });
      services.appendEditableField(panel, `${name} default`, definition.default, (value) => {
        if (value === undefined) delete definition.default;
        else definition.default = value;
        services.markAssetTemplateEdited(template);
        services.refreshActiveView();
      }, this.attributeInputOptions(definition));
      if (definition.type === "number") {
        services.appendEditableField(panel, `${name} number format`, definition.format || "decimal", (value) => {
          definition.format = value;
          services.markAssetTemplateEdited(template);
          services.refreshActiveView();
        }, { selectOptions: services.numberFormats });
      }
      if (definition.type === "list") {
        services.appendEditableField(
          panel,
          `${name} options (one per line)`,
          (definition.options || []).join("\n"),
          (value) => {
            definition.options = [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))];
            if (definition.default !== undefined && !definition.options.includes(definition.default)) {
              delete definition.default;
            }
            services.markAssetTemplateEdited(template);
            services.refreshActiveView();
          },
          { multiline: true }
        );
      }
      services.appendEditableField(panel, `${name} overridable`, definition.overridable === true, (value) => {
        definition.overridable = value;
        services.markAssetTemplateEdited(template);
        services.refreshActiveView();
      }, { checkbox: true });
    }
    if (template.data.note) this.appendNote(panel, "Template note", template.data.note);
  }

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
    placeButton.disabled = this.state.screens.length === 0;
    placeButton.addEventListener("click", () =>
      this.services.placeMaterialFile(material.file).catch(this.services.showFatalError)
    );
    panel.append(placeButton);
  }

  appendSection(parent, title) {
    parent.append(this.services.element("div", "section-title", title));
  }

  appendDetail(parent, label, value) {
    if (value === undefined || value === null || value === "") return;
    parent.append(this.services.element("div", "detail-label", label));
    parent.append(this.services.element("div", "detail-value", String(value)));
  }

  appendNote(parent, label, text) {
    parent.append(this.services.element("div", "detail-label", label));
    parent.append(this.services.element("div", "note-box", text));
  }

  attributeInputOptions(definition) {
    if (definition.type === "boolean") return { checkbox: true };
    if (definition.type === "list") return { selectOptions: definition.options || [] };
    if (definition.type === "number") return { numberFormat: definition.format || "decimal" };
    return {};
  }
}
