import { nextMaterialPosition } from "./MaterialCanvas.mjs";
import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";
import { BASE_LAYER_ID, normalizeScreenLayers } from "../../shared/ScreenLayers.mjs";
import {
  createScreenPlacementGroup,
  getScreenPlacementAtPath,
  getScreenPlacementLocation,
  getScreenPlacementPathById,
  isScreenGroup,
  ungroupScreenPlacement
} from "../../shared/ScreenGroups.mjs";

export class ScreenMaterialController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async add(type, position = null) {
    if (!this.state.screens[this.state.activeScreenIndex]) {
      throw new Error("Select a Screen before adding a Material.");
    }
    this.requireDefaultState();
    if (type !== "label") throw new Error(`Unsupported material type "${type}".`);
    let definition = [...this.state.materialFiles.values()]
      .find((material) =>
        material.data.type === "label" && material.html.includes("${attributes.text}")
      );
    if (!definition) {
      definition = this.createLabelDefinition();
      this.state.materialFiles.set(definition.file, definition);
      this.state.createdMaterialFiles.add(definition.file);
      this.state.projectFilePaths.push(definition.file);
      this.services.markEdited(definition.file);
      this.services.renderNavigation();
    }
    await this.addFromFile(definition.file, position);
  }

  createLabelDefinition() {
    const { state } = this;
    let id = "label";
    let file = `materials/${id}.stml`;
    for (let suffix = 2; state.materialFiles.has(file) || state.projectFilePaths.includes(file); suffix += 1) {
      id = `label-${suffix}`;
      file = `materials/${id}.stml`;
    }
    const data = {
      id,
      name: "Label",
      type: "label",
      attributes: { text: { type: "string", default: "Label", overridable: true } }
    };
    const body = '<div class="material-visual material-visual-label">${attributes.text}</div>';
    const documentSource = `---\nid: ${id}\nname: Label\ntype: label\nattributes:\n  text:\n    type: string\n    default: Label\n    overridable: true\n---\n${body}\n`;
    return {
      id,
      file,
      base: new URL("materials/", state.appRoot),
      data,
      documentSource,
      html: body
    };
  }

  async addFromFile(filePath, position = null) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const definition = state.materialFiles.get(filePath);
    if (!screen) throw new Error("Select a Screen before adding a Material.");
    this.requireDefaultState(screen);
    if (!definition) throw new Error(`Material file "${filePath}" is not available.`);
    normalizeScreenLayers(screen.data);
    const size = getMaterialDefaultSize(definition.data.type);
    if (!size) throw new Error(`Material "${filePath}" has an unsupported type.`);
    const materials = screen.data.materials;
    const baseId = definition.id;
    let id = baseId;
    for (let suffix = 2; getScreenPlacementPathById(materials, id); suffix += 1) {
      id = `${baseId}-${suffix}`;
    }
    const attributes = Object.fromEntries(
      Object.entries(definition.data.attributes || {})
        .filter(([, attribute]) =>
          attribute.overridable === true && Object.hasOwn(attribute, "default")
        )
        .map(([name, attribute]) => [name, attribute.default])
    );
    const layerId = screen.data.layers.find((layer) => layer.id === BASE_LAYER_ID)?.id ||
      screen.data.layers[0]?.id;
    if (!layerId) throw new Error("The Screen must have a layer before adding a Material.");
    const material = {
      id,
      src: filePath,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      position: Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) }
        : nextMaterialPosition(materials, size),
      size,
      rotation: 0,
      layer: layerId
    };
    materials.push(material);
    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex);
    services.selectInstance([materials.length - 1], null);
  }

  async createLayer() {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    normalizeScreenLayers(screen.data);
    let suffix = 1;
    while (screen.data.layers.some((layer) => layer.id === `layer-${suffix}`)) suffix += 1;
    const layer = { id: `layer-${suffix}`, name: `Layer ${suffix}` };
    screen.data.layers.unshift(layer);
    await this.commitLayerChange(screen);
    return layer.id;
  }

  async renameLayer(layerId, name) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const layer = this.getLayer(screen, layerId);
    const nextName = name.trim();
    if (!nextName) throw new Error("Layer names cannot be empty.");
    layer.name = nextName;
    await this.commitLayerChange(screen);
  }

  async setLayerVisibility(layerId, visible) {
    const screen = this.getActiveScreen();
    const layer = this.getLayer(screen, layerId);
    const stateId = this.services.getActivePreviewStateId?.(screen.data) || "default";
    if (this.services.setPreviewLayerVisibility) {
      this.services.setPreviewLayerVisibility(screen, layer, visible, stateId);
    } else if (visible) delete layer.visible;
    else layer.visible = false;
    await this.commitLayerChange(screen);
  }

  async moveLayer(layerId, direction) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const layers = screen.data.layers || [];
    const index = layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) return;
    [layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]];
    await this.commitLayerChange(screen);
  }

  async reorderLayer(layerId, targetLayerId, insertAfter) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const layers = screen.data.layers;
    if (layerId === targetLayerId) return;
    const fromIndex = layers.findIndex((layer) => layer.id === layerId);
    if (fromIndex < 0) throw new Error(`Layer "${layerId}" is no longer available.`);
    if (!layers.some((layer) => layer.id === targetLayerId)) {
      throw new Error(`Layer "${targetLayerId}" is no longer available.`);
    }
    const previousOrder = layers.map((layer) => layer.id);
    const [layer] = layers.splice(fromIndex, 1);
    const targetIndex = layers.findIndex((candidate) => candidate.id === targetLayerId);
    layers.splice(targetIndex + (insertAfter ? 1 : 0), 0, layer);
    if (layers.every((candidate, index) => candidate.id === previousOrder[index])) return;
    await this.commitLayerChange(screen);
  }

  async moveMaterial(materialIndex, direction) {
    return this.movePlacement([materialIndex], direction);
  }

  async movePlacement(path, direction) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const { siblings, index } = getScreenPlacementLocation(screen.data.materials, path);
    const selectedId = getScreenPlacementAtPath(
      screen.data.materials,
      this.state.activeInstancePath || []
    )?.id;
    const layerId = screen.data.materials[path[0]]?.layer;
    const ordered = siblings
      .map((candidate, siblingIndex) => ({ candidate, siblingIndex }))
      .filter(({ candidate }) =>
        path.length > 1 || candidate.layer === layerId
      );
    const layerIndex = ordered.findIndex(({ siblingIndex }) => siblingIndex === index);
    const next = ordered[layerIndex + direction];
    if (!next) return;
    [siblings[index], siblings[next.siblingIndex]] =
      [siblings[next.siblingIndex], siblings[index]];
    await this.commitPlacementChange(screen, selectedId);
  }

  async reorderMaterial(materialIndex, targetMaterialId, insertAfter) {
    const screen = this.getActiveScreen();
    return this.reorderPlacement([materialIndex], [screen.data.materials.findIndex(
      (material) => material.id === targetMaterialId
    )], insertAfter);
  }

  async reorderPlacement(path, targetPath, insertAfter) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const materials = screen.data.materials;
    const { parentPath, siblings, index, placement: moving } =
      getScreenPlacementLocation(materials, path);
    const targetLocation = getScreenPlacementLocation(materials, targetPath);
    const selectedId = getScreenPlacementAtPath(
      materials,
      this.state.activeInstancePath || []
    )?.id;
    if (parentPath.length !== targetLocation.parentPath.length ||
        !parentPath.every((part, partIndex) => part === targetLocation.parentPath[partIndex])) {
      throw new Error("Placements can only be reordered among siblings.");
    }
    if (!moving) throw new Error("The Material placement is no longer available.");
    const target = targetLocation.placement;
    if (!target) throw new Error("The target placement is no longer available.");
    if (moving === target) return;
    siblings.splice(index, 1);
    const targetIndex = siblings.indexOf(target);
    if (parentPath.length === 0) moving.layer = target.layer;
    siblings.splice(targetIndex + (insertAfter ? 1 : 0), 0, moving);
    await this.commitPlacementChange(screen, selectedId);
  }

  async deleteLayer(layerId) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const layers = screen.data.layers || [];
    const index = layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) throw new Error(`Layer "${layerId}" is no longer available.`);
    if (layers.length <= 1) {
      throw new Error("At least one layer must remain on a Screen.");
    }
    layers.splice(index, 1);
    const materials = screen.data.materials;
    const selectedId = getScreenPlacementAtPath(
      materials,
      this.state.activeInstancePath || []
    )?.id;
    const removedPlacementIds = materials
      .filter((material) => material.layer === layerId)
      .flatMap((material) => this.getPlacementIds(material));
    for (let materialIndex = materials.length - 1; materialIndex >= 0; materialIndex -= 1) {
      if (materials[materialIndex].layer === layerId) materials.splice(materialIndex, 1);
    }
    this.services.removePlacementStateOverrides?.(screen, removedPlacementIds, [layerId]);
    await this.commitLayerChange(screen);
    if (selectedId && getScreenPlacementPathById(materials, selectedId)) {
      await this.selectPlacementById(materials, selectedId);
    } else {
      this.services.selectInstance?.([], null);
    }
  }

  async assignMaterialLayer(materialIndex, layerId) {
    return this.assignPlacementLayer([materialIndex], layerId);
  }

  async assignPlacementLayer(path, layerId) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    if (path.length !== 1) {
      throw new Error("A placement inside a group inherits its layer from that group.");
    }
    const material = getScreenPlacementAtPath(screen.data.materials, path);
    if (!material) throw new Error("The Material placement is no longer available.");
    this.getLayer(screen, layerId);
    material.layer = layerId;
    await this.commitLayerChange(screen);
  }

  async group(paths) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const id = this.getUniqueGroupId(screen.data.materials);
    const stateSnapshots = this.captureNamedStatePlacements(screen);
    for (const { stateId, placements } of stateSnapshots) {
      createScreenPlacementGroup(placements, paths, id);
    }
    const { path } = createScreenPlacementGroup(screen.data.materials, paths, id);
    for (const { stateId, placements } of stateSnapshots) {
      this.services.persistStatePlacements?.(screen, placements, stateId);
    }
    await this.commitLayerChange(screen);
    this.services.selectInstance?.(path, null);
    return path;
  }

  async ungroup(path) {
    const screen = this.getActiveScreen();
    this.requireDefaultState(screen);
    const groupId = getScreenPlacementAtPath(screen.data.materials, path)?.id;
    const stateSnapshots = this.captureNamedStatePlacements(screen);
    const stateChildVisibility = [];
    for (const { stateId, placements } of stateSnapshots) {
      const stateGroup = getScreenPlacementAtPath(placements, path);
      if (stateGroup) {
        const groupVisible = this.services.isInstanceVisible
          ? this.services.isInstanceVisible(stateGroup, stateId, screen.data)
          : true;
        stateGroup.children.forEach((child) => {
          const childVisible = this.services.isInstanceVisible
            ? this.services.isInstanceVisible(child, stateId, screen.data)
            : true;
          stateChildVisibility.push({
            id: child.id,
            stateId,
            visible: groupVisible && childVisible
          });
        });
      }
      ungroupScreenPlacement(placements, path);
    }
    const baseGroup = getScreenPlacementAtPath(screen.data.materials, path);
    if (baseGroup && this.services.isInstanceVisible &&
        !this.services.isInstanceVisible(baseGroup, "default", screen.data)) {
      baseGroup.children.forEach((child) => { child.visible = false; });
    }
    const children = ungroupScreenPlacement(screen.data.materials, path);
    if (groupId) this.services.removePlacementStateOverrides?.(screen, [groupId]);
    for (const { stateId, placements } of stateSnapshots) {
      this.services.persistStatePlacements?.(screen, placements, stateId);
    }
    for (const { id, stateId, visible } of stateChildVisibility) {
      const childPath = getScreenPlacementPathById(screen.data.materials, id);
      const child = childPath && getScreenPlacementAtPath(screen.data.materials, childPath);
      if (child) this.services.setInstanceVisible?.(screen, child, visible, stateId);
    }
    await this.commitLayerChange(screen);
    const first = children[0];
    const instance = getScreenPlacementAtPath(screen.data.materials, first);
    this.services.selectInstance?.(first, instance?.src || null);
    return children;
  }

  async delete(path) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    if (!screen || !Array.isArray(path) || path.length === 0) {
      throw new Error("Select a Material placement before deleting it.");
    }
    this.requireDefaultState(screen);
    const location = getScreenPlacementLocation(screen.data.materials, path);
    const id = location.placement.id;
    const removedPlacementIds = this.getPlacementIds(location.placement);
    location.siblings.splice(location.index, 1);
    let parentPath = location.parentPath;
    while (parentPath.length) {
      const parent = getScreenPlacementAtPath(screen.data.materials, parentPath);
      if (!isScreenGroup(parent) || parent.children.length > 0) break;
      removedPlacementIds.push(parent.id);
      const parentLocation = getScreenPlacementLocation(screen.data.materials, parentPath);
      parentLocation.siblings.splice(parentLocation.index, 1);
      parentPath = parentLocation.parentPath;
    }
    this.services.removePlacementStateOverrides?.(screen, removedPlacementIds);
    if (!getScreenPlacementPathById(screen.data.materials, id)) {
      services.selectInstance?.([], null);
    }
    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex);
  }

  getActiveScreen() {
    const screen = this.state.screens[this.state.activeScreenIndex];
    if (!screen) throw new Error("Select a Screen before editing layers.");
    normalizeScreenLayers(screen.data);
    return screen;
  }

  requireDefaultState(screen = this.getActiveScreen()) {
    if ((this.services.getActivePreviewStateId?.(screen.data) || "default") !== "default") {
      throw new Error("Placement and layer structure can only be edited in the Default state.");
    }
  }

  getLayer(screen, layerId) {
    const layer = screen.data.layers?.find((candidate) => candidate.id === layerId);
    if (!layer) throw new Error(`Layer "${layerId}" is no longer available.`);
    return layer;
  }

  async commitLayerChange(screen) {
    this.services.markEdited(screen.file);
    await this.services.renderScreen(this.state.activeScreenIndex);
  }

  getUniqueGroupId(placements) {
    let suffix = 1;
    let id = "group";
    while (getScreenPlacementPathById(placements, id)) {
      suffix += 1;
      id = `group-${suffix}`;
    }
    return id;
  }

  getPlacementIds(placement) {
    return [
      placement.id,
      ...(placement.children || []).flatMap((child) => this.getPlacementIds(child))
    ];
  }

  captureNamedStatePlacements(screen) {
    const states = this.services.getScreenPreviewStates?.(screen.data) || [];
    return states
      .filter((previewState) => previewState.id !== "default")
      .map((previewState) => ({
        stateId: previewState.id,
        placements: screen.data.materials.map((placement) =>
          this.services.resolvePlacementForState
            ? this.services.resolvePlacementForState(
              placement,
              previewState.id,
              screen.data
            )
            : structuredClone(placement)
        )
      }));
  }

  async commitPlacementChange(screen, placementId) {
    await this.commitLayerChange(screen);
    if (!placementId) return;
    const path = getScreenPlacementPathById(screen.data.materials, placementId);
    const placement = path && getScreenPlacementAtPath(screen.data.materials, path);
    this.services.selectInstance?.(path || [], placement?.src || null);
  }

  async selectPlacementById(placements, id) {
    const path = getScreenPlacementPathById(placements, id);
    const placement = path && getScreenPlacementAtPath(placements, path);
    this.services.selectInstance?.(path || [], placement?.src || null);
  }
}
