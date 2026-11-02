import { BASE_LAYER_ID, BASE_LAYER_NAME } from "../../shared/ScreenLayers.mjs";

export class ScreenController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async createScreen() {
    const { state, services } = this;
    const enteredName = services.prompt("Name for the new Screen:", "New Screen");
    if (enteredName === null) return;
    const name = enteredName.trim();
    if (!name) {
      services.showEditorMessage("Screen name required", "Enter a name before creating a Screen.");
      return;
    }
    const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen";
    let id;
    let file;
    for (let suffix = 1; ; suffix += 1) {
      id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
      file = `screens/${id}/screen.yml`;
      const alreadyListed = state.screens.some((screen) => screen.id === id || screen.file === file) ||
        state.project.screens.some((screen) => screen.id === id || screen.file === file);
      if (alreadyListed) continue;
      const response = await services.fetcher(services.safeProjectUrl(file));
      if (response.status === 404) break;
      if (!response.ok) {
        throw new Error(`Could not check Screen file "${file}" (HTTP ${response.status}).`);
      }
    }

    const screen = {
      id,
      file,
      data: {
        name,
        description: "",
        layers: [{ id: BASE_LAYER_ID, name: BASE_LAYER_NAME }],
        materials: []
      },
      yamlSource: "",
      yamlSourceMode: "data",
      yamlParseVersion: 0,
      yamlSerializeVersion: 0,
      yamlTimer: null
    };
    state.screens.push(screen);
    state.project.screens.push({ id, file });
    state.createdScreenFiles.add(file);
    services.projectFileTree.expandPath(file);
    services.markEdited(file);
    services.markEdited("project.yml");
    state.activeScreenIndex = state.screens.length - 1;
    services.renderScreenSelector();
    services.renderNavigation();
    services.renderScreen(state.activeScreenIndex).catch(services.showFatalError);
  }
}
