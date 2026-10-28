import { nextMaterialPosition } from "./MaterialCanvas.mjs";
import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";

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
    const material = {
      id,
      src: filePath,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      position: Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) }
        : nextMaterialPosition(materials, size),
      size,
      rotation: 0
    };
    materials.push(material);
    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex);
    services.selectInstance([materials.length - 1], null);
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
}
