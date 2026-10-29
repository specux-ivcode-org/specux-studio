import { nextMaterialPosition } from "./MaterialCanvas.mjs";
import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";
import { BASE_LAYER_ID, normalizeScreenLayers } from "../../shared/ScreenLayers.mjs";

export class ScreenMaterialController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async add(type, position = null) {
    if (!this.state.screens[this.state.activeScreenIndex]) {
      throw new Error("Select a Screen before adding a Material.");
    }
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
    if (!definition) throw new Error(`Material file "${filePath}" is not available.`);
    normalizeScreenLayers(screen.data);
    const size = getMaterialDefaultSize(definition.data.type);
    if (!size) throw new Error(`Material "${filePath}" has an unsupported type.`);
    const materials = screen.data.materials;
    const baseId = definition.id;
    let id = baseId;
    for (let suffix = 2; materials.some((material) => material.id === id); suffix += 1) {
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
    const layer = this.getLayer(screen, layerId);
    const nextName = name.trim();
    if (!nextName) throw new Error("Layer names cannot be empty.");
    layer.name = nextName;
    await this.commitLayerChange(screen);
  }

  async setLayerVisibility(layerId, visible) {
    const screen = this.getActiveScreen();
    const layer = this.getLayer(screen, layerId);
    if (visible) delete layer.visible;
    else layer.visible = false;
    await this.commitLayerChange(screen);
  }

  async moveLayer(layerId, direction) {
    const screen = this.getActiveScreen();
    const layers = screen.data.layers || [];
    const index = layers.findIndex((layer) => layer.id === layerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) return;
    [layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]];
    await this.commitLayerChange(screen);
  }

  async reorderLayer(layerId, targetLayerId, insertAfter) {
    const screen = this.getActiveScreen();
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
    const screen = this.getActiveScreen();
    const materials = screen.data.materials;
    const material = materials[materialIndex];
    if (!material) throw new Error("The Material placement is no longer available.");
    const layerMaterials = materials
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.layer === material.layer);
    const layerIndex = layerMaterials.findIndex(({ index }) => index === materialIndex);
    const next = layerMaterials[layerIndex + direction];
    if (!next) return;
    [materials[materialIndex], materials[next.index]] =
      [materials[next.index], materials[materialIndex]];
    const selectedIndex = this.state.activeInstancePath?.length === 1
      ? this.state.activeInstancePath[0]
      : null;
    if (selectedIndex === materialIndex || selectedIndex === next.index) {
      const nextSelectedIndex = selectedIndex === materialIndex ? next.index : materialIndex;
      const selectedMaterial = materials[nextSelectedIndex];
      this.services.selectInstance?.([nextSelectedIndex], selectedMaterial.src || null);
    }
    await this.commitLayerChange(screen);
  }

  async reorderMaterial(materialIndex, targetMaterialId, insertAfter) {
    const screen = this.getActiveScreen();
    const materials = screen.data.materials;
    const moving = materials[materialIndex];
    if (!moving) throw new Error("The Material placement is no longer available.");
    if (moving.id === targetMaterialId) return;
    const target = materials.find((material) => material.id === targetMaterialId);
    if (!target) throw new Error(`Material placement "${targetMaterialId}" is no longer available.`);
    const selectedMaterialId = this.state.activeInstancePath?.length === 1
      ? materials[this.state.activeInstancePath[0]]?.id
      : null;
    const previousOrder = materials.map((material) => `${material.id}:${material.layer}`);
    materials.splice(materialIndex, 1);
    const targetIndex = materials.findIndex((material) => material.id === targetMaterialId);
    moving.layer = target.layer;
    materials.splice(targetIndex + (insertAfter ? 1 : 0), 0, moving);
    if (materials.every((material, index) =>
      `${material.id}:${material.layer}` === previousOrder[index]
    )) return;
    if (selectedMaterialId) {
      const selectedIndex = materials.findIndex((material) => material.id === selectedMaterialId);
      if (selectedIndex >= 0) {
        this.services.selectInstance?.(
          [selectedIndex],
          materials[selectedIndex].src || null
        );
      }
    }
    await this.commitLayerChange(screen);
  }

  async deleteLayer(layerId) {
    const screen = this.getActiveScreen();
    const layers = screen.data.layers || [];
    const index = layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) throw new Error(`Layer "${layerId}" is no longer available.`);
    if (layers.length <= 1) {
      throw new Error("At least one layer must remain on a Screen.");
    }
    layers.splice(index, 1);
    const materials = screen.data.materials;
    const selectedIndex = this.state.activeInstancePath?.length === 1
      ? this.state.activeInstancePath[0]
      : null;
    const selectedMaterial = selectedIndex === null ? null : materials[selectedIndex];
    for (let materialIndex = materials.length - 1; materialIndex >= 0; materialIndex -= 1) {
      if (materials[materialIndex].layer === layerId) materials.splice(materialIndex, 1);
    }
    if (selectedMaterial) {
      if (selectedMaterial.layer === layerId) {
        this.services.selectInstance?.([], null);
      } else {
        const nextSelectedIndex = materials.indexOf(selectedMaterial);
        this.services.selectInstance?.(
          [nextSelectedIndex],
          selectedMaterial.src || null
        );
      }
    }
    await this.commitLayerChange(screen);
  }

  async assignMaterialLayer(materialIndex, layerId) {
    const screen = this.getActiveScreen();
    const material = screen.data.materials[materialIndex];
    if (!material) throw new Error("The Material placement is no longer available.");
    this.getLayer(screen, layerId);
    material.layer = layerId;
    await this.commitLayerChange(screen);
  }

  async delete(path) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    if (!screen || path.length !== 1 || !Number.isInteger(path[0])) {
      throw new Error("Select a Material placement before deleting it.");
    }
    const [index] = path;
    if (index < 0 || index >= screen.data.materials.length) {
      throw new Error("The selected Material is no longer available.");
    }
    screen.data.materials.splice(index, 1);
    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex);
  }

  getActiveScreen() {
    const screen = this.state.screens[this.state.activeScreenIndex];
    if (!screen) throw new Error("Select a Screen before editing layers.");
    normalizeScreenLayers(screen.data);
    return screen;
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
}
