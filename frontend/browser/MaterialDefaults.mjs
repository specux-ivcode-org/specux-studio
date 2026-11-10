export const MATERIAL_DEFAULT_SIZES = Object.freeze({
  label: Object.freeze({ width: 240, height: 56 }),
  button: Object.freeze({ width: 160, height: 48 }),
  surface: Object.freeze({ width: 240, height: 120 }),
  avatar: Object.freeze({ width: 48, height: 48 }),
  "navigation-item": Object.freeze({ width: 160, height: 40 }),
  "text-field": Object.freeze({ width: 280, height: 48 }),
  progress: Object.freeze({ width: 240, height: 24 }),
  divider: Object.freeze({ width: 120, height: 24 }),
  checkbox: Object.freeze({ width: 24, height: 24 })
});

/** Returns the default dimensions for the specified Material type. */
export function getMaterialDefaultSize(type) {
  const size = MATERIAL_DEFAULT_SIZES[type];
  return size ? { ...size } : null;
}
