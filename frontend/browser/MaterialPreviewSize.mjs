import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";

/** Returns the Material's editor preview dimensions. */
export function getMaterialPreviewSize(material) {
  return material.data["preview-size"] || getMaterialDefaultSize(material.data.type);
}

