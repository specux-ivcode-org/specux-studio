import { getMaterialDefaultSize } from "./MaterialDefaults.mjs";

/** Returns the Material's editor preview dimensions. */
export function getMaterialPreviewSize(material) {
  return material.data["preview-size"] || getMaterialDefaultSize(material.data.type);
}

/** Returns the stored selector frame or the complete preview bounds. */
export function getMaterialPreviewFrame(project, material) {
  const size = getMaterialPreviewSize(material);
  if (!size) throw new Error(`Material "${material.file}" has no supported preview size.`);
  const frame = project?.["material-previews"]?.[material.id];
  return frame ? { ...frame } : { x: 0, y: 0, ...size };
}
