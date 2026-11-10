import {
  getScreenPlacementAtPath,
  getScreenPlacementPathById
} from "../../shared/ScreenGroups.mjs";

/** Resolves and persists Screen preview-state overrides. */
export class PreviewStateController {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  /** Returns the active preview-state ID, defaulting when no named state is selected. */
  getActiveId(screen = this.state.screens[this.state.activeScreenIndex]?.data) {
    if (!screen) return "default";
    const states = this.services.getScreenPreviewStates(screen);
    const activeId = this.state.activePreviewStateIds
      .get(this.state.screens[this.state.activeScreenIndex]?.id);
    return states.some((entry) => entry.id === activeId) ? activeId : "default";
  }

  /** Returns the requested Screen state record, if one exists. */
  getState(screen, stateId) {
    if (!screen) return null;
    return this.services.getScreenPreviewStates(screen)
      .find((entry) => entry.id === stateId) || null;
  }

  /** Checks whether the instance is visible in the selected preview state. */
  isInstanceVisible(instance, stateId = this.getActiveId(), screen = this.getActiveScreenData()) {
    const stateVisibility = this.getState(screen, stateId)?.placements?.[instance.id]?.visible;
    if (typeof stateVisibility === "boolean") return stateVisibility;
    if (stateId === "default" && typeof instance.visible === "boolean") {
      return instance.visible;
    }
    if (typeof instance.visibility?.[stateId] === "boolean") {
      return instance.visibility[stateId];
    }
    if (stateId !== "default" && typeof instance.visible === "boolean") {
      return instance.visible;
    }
    if (stateId !== "default" && typeof instance.visibility?.default === "boolean") {
      return instance.visibility.default;
    }
    return true;
  }

  /** Checks whether the layer is visible in the selected preview state. */
  isLayerVisible(layer, stateId = this.getActiveId(), screen = this.getActiveScreenData()) {
    if (!layer) return true;
    const stateVisibility = this.getState(screen, stateId)?.layers?.[layer.id]?.visible;
    return typeof stateVisibility === "boolean"
      ? stateVisibility
      : layer.visible !== false;
  }

  /** Combines Default placement data with overrides from the selected state. */
  resolvePlacement(instance, stateId = this.getActiveId(), screen = this.getActiveScreenData()) {
    if (stateId === "default" || !screen) return instance;
    const override = this.getState(screen, stateId)?.placements?.[instance.id];
    const resolved = { ...instance };
    this.copyPlacementObjects(instance, resolved);
    this.applyPlacementOverride(instance, resolved, override);
    if (Array.isArray(instance.children)) {
      resolved.children = instance.children.map((child) => this.resolvePlacement(child, stateId, screen));
    }
    return resolved;
  }

  /** Copies placement and override objects before mutation. */
  copyPlacementObjects(instance, resolved) {
    for (const property of ["attributes", "position", "size", "scale", "affine"]) {
      if (instance[property] && typeof instance[property] === "object") {
        resolved[property] = this.copyValue(instance[property]);
      }
    }
  }

  /** Applies a complete placement override to the selected state. */
  applyPlacementOverride(instance, resolved, override) {
    if (!override) return;
    this.applyPlacementTransformOverride(instance, resolved, override);
    if (override.rotation !== undefined) resolved.rotation = override.rotation;
    this.applyPlacementAttributeOverride(instance, resolved, override.attributes);
  }

  /** Applies the placement transform fields represented by an override. */
  applyPlacementTransformOverride(instance, resolved, override) {
    for (const property of ["position", "size", "scale", "affine"]) {
      if (override[property] === undefined) continue;
      const baseValue = instance[property];
      resolved[property] = baseValue && typeof baseValue === "object" &&
          typeof override[property] === "object"
        ? { ...baseValue, ...override[property] }
        : override[property];
    }
  }

  /** Applies the selected placement attribute overrides. */
  applyPlacementAttributeOverride(instance, resolved, attributes) {
    if (!attributes) return;
    resolved.attributes = { ...(instance.attributes || {}) };
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null) delete resolved.attributes[name];
      else resolved.attributes[name] = value;
    }
    if (Object.keys(resolved.attributes).length === 0) delete resolved.attributes;
  }

  /** Persists the placement to the project. */
  savePlacement(screen, instance, stateId = this.getActiveId(screen.data)) {
    const path = getScreenPlacementPathById(screen.data.materials, instance.id);
    const basePlacement = path && getScreenPlacementAtPath(screen.data.materials, path);
    if (!basePlacement) {
      throw new Error(`Placement "${instance.id}" is no longer available on this Screen.`);
    }
    if (stateId === "default") {
      this.copyPlacementValues(basePlacement, instance);
      return;
    }
    const previewState = this.getState(screen.data, stateId);
    if (!previewState) throw new Error(`Unknown Screen State "${stateId}".`);
    previewState.placements ||= {};
    this.savePlacementOverrides(previewState.placements, basePlacement, instance);
    if (Object.keys(previewState.placements).length === 0) delete previewState.placements;
  }

  /** Copies the placement values for the current editor state. */
  copyPlacementValues(target, source) {
    for (const property of ["attributes", "position", "size", "rotation", "scale", "affine"]) {
      if (source[property] === undefined) delete target[property];
      else target[property] = this.copyValue(source[property]);
    }
    if (Array.isArray(target.children) && Array.isArray(source.children)) {
      const sourceById = new Map(source.children.map((child) => [child.id, child]));
      for (const child of target.children) {
        const resolvedChild = sourceById.get(child.id);
        if (resolvedChild) this.copyPlacementValues(child, resolvedChild);
      }
    }
  }

  /** Persists the placement overrides to the project. */
  savePlacementOverrides(overrides, base, resolved) {
    const current = { ...(overrides[base.id] || {}) };
    this.saveTransformOverrides(current, base, resolved);
    this.saveAttributeOverrides(current, base.attributes || {}, resolved.attributes || {});
    this.saveChildPlacementOverrides(overrides, base, resolved);
    if (Object.keys(current).length) overrides[base.id] = current;
    else delete overrides[base.id];
  }

  /** Persists the transform overrides to the project. */
  saveTransformOverrides(current, base, resolved) {
    for (const property of ["position", "size", "rotation", "scale", "affine"]) {
      if (this.valuesEqual(base[property], resolved[property])) delete current[property];
      else if (resolved[property] === undefined) delete current[property];
      else current[property] = this.copyValue(resolved[property]);
    }
  }

  /** Persists the attribute overrides to the project. */
  saveAttributeOverrides(current, baseAttributes, resolvedAttributes) {
    const attributeOverrides = { ...(current.attributes || {}) };
    for (const name of new Set([
      ...Object.keys(baseAttributes),
      ...Object.keys(resolvedAttributes),
      ...Object.keys(attributeOverrides)
    ])) {
      if (this.valuesEqual(baseAttributes[name], resolvedAttributes[name]) &&
          Object.hasOwn(baseAttributes, name) === Object.hasOwn(resolvedAttributes, name)) {
        delete attributeOverrides[name];
      } else if (Object.hasOwn(resolvedAttributes, name)) {
        attributeOverrides[name] = this.copyValue(resolvedAttributes[name]);
      } else {
        attributeOverrides[name] = null;
      }
    }
    if (Object.keys(attributeOverrides).length) current.attributes = attributeOverrides;
    else delete current.attributes;
  }

  /** Persists the child placement overrides to the project. */
  saveChildPlacementOverrides(overrides, base, resolved) {
    if (Array.isArray(base.children) && Array.isArray(resolved.children)) {
      const resolvedById = new Map(resolved.children.map((child) => [child.id, child]));
      for (const child of base.children) {
        const resolvedChild = resolvedById.get(child.id);
        if (resolvedChild) this.savePlacementOverrides(overrides, child, resolvedChild);
      }
    }
  }

  /** Sets the instance visible from the supplied data. */
  setInstanceVisible(screen, instance, visible, stateId = this.getActiveId(screen.data)) {
    if (stateId === "default") {
      this.setDefaultInstanceVisibility(instance, visible);
      return;
    }
    const previewState = this.getState(screen.data, stateId);
    if (!previewState) throw new Error(`Unknown Screen State "${stateId}".`);
    const baseVisible = this.isInstanceVisible(instance, "default", screen.data);
    if (visible === baseVisible) {
      this.clearInstanceVisibilityOverride(instance, previewState, stateId);
      return;
    }
    previewState.placements ||= {};
    previewState.placements[instance.id] ||= {};
    previewState.placements[instance.id].visible = visible;
    this.clearLegacyVisibility(instance, stateId);
  }

  /** Sets the default instance visibility from the supplied data. */
  setDefaultInstanceVisibility(instance, visible) {
    if (visible) delete instance.visible;
    else instance.visible = false;
    if (instance.visibility) {
      delete instance.visibility.default;
      if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
    }
  }

  /** Clears the instance visibility override and resets its associated state. */
  clearInstanceVisibilityOverride(instance, previewState, stateId) {
    this.clearLegacyVisibility(instance, stateId);
    const override = previewState.placements?.[instance.id];
    if (override) delete override.visible;
    this.pruneStateEntry(previewState.placements, instance.id);
    if (previewState.placements && Object.keys(previewState.placements).length === 0) {
      delete previewState.placements;
    }
  }

  /** Clears the legacy visibility and resets its associated state. */
  clearLegacyVisibility(instance, stateId) {
    if (!instance.visibility) return;
    delete instance.visibility[stateId];
    if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
  }

  /** Sets the layer visible from the supplied data. */
  setLayerVisible(screen, layer, visible, stateId = this.getActiveId(screen.data)) {
    if (stateId === "default") {
      if (visible) delete layer.visible;
      else layer.visible = false;
      return;
    }
    const previewState = this.getState(screen.data, stateId);
    if (!previewState) throw new Error(`Unknown Screen State "${stateId}".`);
    if (visible === this.isLayerVisible(layer, "default", screen.data)) {
      if (previewState.layers) {
        delete previewState.layers[layer.id];
        if (Object.keys(previewState.layers).length === 0) delete previewState.layers;
      }
      return;
    }
    previewState.layers ||= {};
    previewState.layers[layer.id] = { visible };
  }

  /** Updates the state overrides for the current editor state. */
  listStateOverrides(screen, stateId) {
    const previewState = this.getState(screen, stateId);
    if (!previewState || stateId === "default") return [];
    const overrides = [];
    const placements = this.collectPlacements(screen.materials);
    for (const placement of placements) {
      this.addPlacementStateOverrides(overrides, placement, stateId, previewState);
    }
    this.addLayerStateOverrides(overrides, previewState);
    return overrides;
  }

  /** Collects the placements for the current editor state. */
  collectPlacements(items, placements = []) {
    for (const placement of items || []) {
      placements.push(placement);
      this.collectPlacements(placement.children, placements);
    }
    return placements;
  }

  /** Adds the placement state overrides for the current editor state. */
  addPlacementStateOverrides(overrides, placement, stateId, previewState) {
    const placementOverride = previewState.placements?.[placement.id] || {};
    for (const property of ["visible", "position", "size", "rotation", "scale", "affine"]) {
      this.addPlacementPropertyOverride(overrides, placement, placementOverride, stateId, property);
    }
    for (const [attributeName, value] of Object.entries(placementOverride.attributes || {})) {
      overrides.push(this.createPlacementOverride(placement, "attributes", value, attributeName));
    }
  }

  /** Adds the placement property override for the current editor state. */
  addPlacementPropertyOverride(overrides, placement, placementOverride, stateId, property) {
    if (placementOverride[property] !== undefined) {
      overrides.push(this.createPlacementOverride(placement, property, placementOverride[property]));
      return;
    }
    if (property === "visible" && typeof placement.visibility?.[stateId] === "boolean") {
      overrides.push(this.createPlacementOverride(
        placement, property, placement.visibility[stateId], null, true
      ));
    }
  }

  /** Builds a sparse placement override from the selected state changes. */
  createPlacementOverride(placement, property, value, attributeName = null, legacy = false) {
    return {
      key: `placement:${placement.id}:${property}${attributeName === null ? "" : `:${attributeName}`}`,
      kind: "placement",
      placementId: placement.id,
      property,
      ...(attributeName === null ? {} : { attributeName }),
      ...(legacy ? { legacy: true } : {}),
      value: this.copyValue(value)
    };
  }

  /** Adds the layer state overrides for the current editor state. */
  addLayerStateOverrides(overrides, previewState) {
    for (const [layerId, layerOverride] of Object.entries(previewState.layers || {})) {
      if (layerOverride?.visible === undefined) continue;
      overrides.push({
        key: `layer:${layerId}:visible`,
        kind: "layer",
        layerId,
        property: "visible",
        value: layerOverride.visible
      });
    }
  }

  /** Removes the selected property override and prunes empty state containers. */
  resetStateOverride(screen, stateId, selectedOverride) {
    const previewState = this.getPreviewStateForReset(screen, stateId, selectedOverride);
    if (selectedOverride?.kind === "layer") {
      this.resetLayerOverride(previewState, selectedOverride);
      return;
    }
    if (selectedOverride?.kind !== "placement") {
      throw new Error("Select a valid state override to reset.");
    }
    if (selectedOverride.property === "visible" && selectedOverride.legacy) {
      this.resetLegacyVisibilityOverride(screen, stateId, selectedOverride);
      return;
    }
    const placementOverride = previewState.placements?.[selectedOverride.placementId];
    if (!placementOverride) throw new Error("The selected placement override is no longer available.");
    if (selectedOverride.property === "attributes") {
      this.resetAttributeOverride(placementOverride, selectedOverride);
    } else {
      this.resetPlacementPropertyOverride(screen, stateId, placementOverride, selectedOverride);
    }
    this.pruneStateEntry(previewState.placements, selectedOverride.placementId);
    if (previewState.placements && Object.keys(previewState.placements).length === 0) {
      delete previewState.placements;
    }
  }

  /** Returns the preview state for reset. */
  getPreviewStateForReset(screen, stateId, selectedOverride) {
    if (stateId === "default") {
      throw new Error("The Default state cannot contain overrides.");
    }
    const previewState = this.getState(screen.data, stateId);
    if (!previewState) throw new Error(`Unknown Screen State "${stateId}".`);
    if (!["layer", "placement"].includes(selectedOverride?.kind)) {
      throw new Error("Select a valid state override to reset.");
    }
    return previewState;
  }

  /** Removes a layer visibility override from the selected state. */
  resetLayerOverride(previewState, selectedOverride) {
    const layerOverride = previewState.layers?.[selectedOverride.layerId];
    if (!layerOverride || !Object.hasOwn(layerOverride, selectedOverride.property)) {
      throw new Error("The selected layer override is no longer available.");
    }
    delete previewState.layers[selectedOverride.layerId];
    if (Object.keys(previewState.layers).length === 0) delete previewState.layers;
  }

  /** Resets the legacy visibility override for the current editor state. */
  resetLegacyVisibilityOverride(screen, stateId, selectedOverride) {
    const path = getScreenPlacementPathById(screen.data.materials, selectedOverride.placementId);
    const placement = path && getScreenPlacementAtPath(screen.data.materials, path);
    if (!placement?.visibility || !Object.hasOwn(placement.visibility, stateId)) {
      throw new Error("The selected legacy visibility override is no longer available.");
    }
    delete placement.visibility[stateId];
    if (Object.keys(placement.visibility).length === 0) delete placement.visibility;
  }

  /** Removes the selected attribute override from the state data. */
  resetAttributeOverride(placementOverride, selectedOverride) {
    const attributes = placementOverride.attributes;
    if (!attributes || !Object.hasOwn(attributes, selectedOverride.attributeName)) {
      throw new Error("The selected attribute override is no longer available.");
    }
    delete attributes[selectedOverride.attributeName];
    if (Object.keys(attributes).length === 0) delete placementOverride.attributes;
  }

  /** Removes one placement property override and prunes empty entries. */
  resetPlacementPropertyOverride(screen, stateId, placementOverride, selectedOverride) {
    const supportedProperties = ["visible", "position", "size", "rotation", "scale", "affine"];
    if (!supportedProperties.includes(selectedOverride.property) ||
        !Object.hasOwn(placementOverride, selectedOverride.property)) {
      throw new Error("The selected placement override is no longer available.");
    }
    delete placementOverride[selectedOverride.property];
    if (selectedOverride.property === "visible") {
      this.clearLegacyPlacementVisibility(screen, stateId, selectedOverride.placementId);
    }
  }

  /** Clears the legacy placement visibility and resets its associated state. */
  clearLegacyPlacementVisibility(screen, stateId, placementId) {
    const path = getScreenPlacementPathById(screen.data.materials, placementId);
    const placement = path && getScreenPlacementAtPath(screen.data.materials, path);
    if (!placement?.visibility) return;
    delete placement.visibility[stateId];
    if (Object.keys(placement.visibility).length === 0) delete placement.visibility;
  }

  /** Removes state overrides that no longer refer to existing placements or layers. */
  removeStructuralOverrides(screen, placementIds = [], layerIds = []) {
    const placements = new Set(placementIds);
    const layers = new Set(layerIds);
    for (const previewState of this.services.getScreenPreviewStates(screen)) {
      for (const id of placements) {
        if (previewState.placements) delete previewState.placements[id];
      }
      for (const id of layers) {
        if (previewState.layers) delete previewState.layers[id];
      }
      if (previewState.placements && Object.keys(previewState.placements).length === 0) {
        delete previewState.placements;
      }
      if (previewState.layers && Object.keys(previewState.layers).length === 0) {
        delete previewState.layers;
      }
    }
  }

  /** Removes unused entries from the state entry. */
  pruneStateEntry(entries, id) {
    if (!entries || Object.keys(entries[id] || {}).length > 0) return;
    delete entries[id];
  }

  /** Returns the active screen data. */
  getActiveScreenData() {
    return this.state.screens[this.state.activeScreenIndex]?.data || null;
  }

  /** Copies the value for the current editor state. */
  copyValue(value) {
    return value && typeof value === "object"
      ? structuredClone(value)
      : value;
  }

  /** Compares two override values, including their nested data. */
  valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  /** Renders the controls from the current editor data. */
  renderControls(screen) {
    const { state, services } = this;
    const toolbar = services.byId("preview-state-toolbar");
    const select = services.byId("preview-state-select");
    const states = [
      ...services.getScreenPreviewStates(screen)
    ].sort((left, right) => Number(right.id === "default") - Number(left.id === "default"));
    const activeStateId = this.getActiveId(screen);
    state.activePreviewStateIds.set(state.screens[state.activeScreenIndex].id, activeStateId);
    toolbar.hidden = state.isRenderOnly;
    select.replaceChildren();
    for (const item of states) {
      const option = services.element("option", "", item.name);
      option.value = item.id;
      select.append(option);
    }
    select.value = activeStateId;
    select.onchange = () => services.switchPreviewState(select.value).catch(services.showFatalError);
  }

  /** Renames the selected entry and updates references to its old name. */
  rename(stateId, name) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const normalizedName = name.trim();
    if (!normalizedName) {
      services.showEditorMessage("Screen State needs a name", "Enter a name before leaving this field.");
      this.renderControls(screen.data);
      return;
    }
    const states = services.getScreenPreviewStates(screen.data);
    if (!screen.data["preview-states"]) {
      screen.data["preview-states"] = states.map((item) => ({ ...item }));
    }
    const item = screen.data["preview-states"].find((candidate) => candidate.id === stateId);
    if (!item || item.name === normalizedName) return;
    item.name = normalizedName;
    services.markEdited(screen.file);
    this.renderControls(screen.data);
    services.renderInspector();
  }

  /** Updates the description of the selected preview state. */
  describe(stateId, description) {
    const screen = this.state.screens[this.state.activeScreenIndex];
    const item = screen.data["preview-states"]?.find((candidate) => candidate.id === stateId);
    if (!item || item.description === description) return;
    item.description = description;
    this.services.markEdited(screen.file);
  }

  /** Changes the active preview state and refreshes the Screen and inspector. */
  async switchTo(stateId) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const states = services.getScreenPreviewStates(screen.data);
    if (!states.some((item) => item.id === stateId)) {
      throw new Error(`Unknown Screen State "${stateId}".`);
    }
    const screenIndex = state.activeScreenIndex;
    state.activePreviewStateIds.set(screen.id, stateId);
    await services.renderScreen(screenIndex, { previewStateSelected: true });
  }

  /** Adds the requested placement or preview-state entry to the project data. */
  async add() {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const screenIndex = state.activeScreenIndex;
    const states = services.getScreenPreviewStates(screen.data);
    let number = 2;
    while (states.some((item) => item.id === `state-${number}`)) number += 1;
    if (!screen.data["preview-states"]) {
      screen.data["preview-states"] = states.map((item) => ({ ...item }));
    }
    const newState = { id: `state-${number}`, name: `State ${number}`, description: "" };
    screen.data["preview-states"].push(newState);
    state.activePreviewStateIds.set(screen.id, newState.id);
    services.markEdited(screen.file);
    await services.renderScreen(screenIndex, { previewStateSelected: true });
    services.byId("preview-state-description-detail")?.focus();
  }

  /** Removes the selected placement or layer visibility override. */
  removeVisibility(instance, stateId) {
    if (instance.visibility) {
      delete instance.visibility[stateId];
      if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
    }
    for (const children of Object.values(instance.slots || {})) {
      if (Array.isArray(children)) children.forEach((child) => this.removeVisibility(child, stateId));
    }
    for (const child of instance.children || []) this.removeVisibility(child, stateId);
  }

  /** Renders the instance tree from the current editor data. */
  renderInstanceTree(panel, instances, parentPath = [], depth = 0, stateId = "default") {
    if (!Array.isArray(instances)) return;
    instances.forEach((instance, index) => {
      const path = parentPath.length ? [...parentPath, index] : [index];
      const label = this.services.getElementLabel(instance);
      const visible = this.isInstanceVisible(instance, stateId);
      const button = this.services.element(
        "button",
        "instance-tree-button",
        `${label} · ${visible ? "Visible" : "Hidden"}`
      );
      button.type = "button";
      button.style.paddingLeft = `${10 + depth * 14}px`;
      button.setAttribute("aria-label", `Select ${label}; ${visible ? "visible" : "hidden"} in this Screen State`);
      button.addEventListener("click", () => this.services.selectInstance(path, instance.src || null));
      panel.append(button);
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (Array.isArray(children)) {
          this.renderInstanceTree(panel, children, [...path, slotId], depth + 1, stateId);
        }
      }
    });
  }

  /** Deletes the selected entry and updates dependent editor state. */
  async delete(stateId) {
    const { state, services } = this;
    if (stateId === "default") return;
    const screen = state.screens[state.activeScreenIndex];
    const states = services.getScreenPreviewStates(screen.data);
    const item = states.find((candidate) => candidate.id === stateId);
    if (!item || !services.confirm(`Delete the "${item.name}" Screen State and its overrides?`)) {
      return;
    }
    const instancePath = [...state.activeInstancePath];
    const keepPreviewStateSelected = state.viewingPreviewState;
    const wasActive = state.activePreviewStateIds.get(screen.id) === stateId;
    screen.data["preview-states"] = states.filter((candidate) => candidate.id !== stateId);
    screen.data.materials.forEach((material) => this.removeVisibility(material, stateId));
    if (wasActive) state.activePreviewStateIds.set(screen.id, "default");
    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex, {
      previewStateSelected: keepPreviewStateSelected
    });
    if (keepPreviewStateSelected) return;
    const instance = services.getInstanceAtPath(screen, instancePath);
    if (instance) services.selectInstance(instancePath, instance.src || null);
  }
}
