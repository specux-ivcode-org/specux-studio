export const BASE_LAYER_ID = "base";
export const BASE_LAYER_NAME = "Base";

export function normalizeScreenLayers(screen) {
  if (!screen || typeof screen !== "object" || Array.isArray(screen)) return false;
  if (screen.layers !== undefined && !Array.isArray(screen.layers)) return false;

  const hasLayerList = Array.isArray(screen.layers);
  const layers = hasLayerList ? screen.layers : (screen.layers = []);
  let changed = !hasLayerList;
  if (layers.length === 0) {
    layers.push({ id: BASE_LAYER_ID, name: BASE_LAYER_NAME });
    changed = true;
  }
  return changed;
}
