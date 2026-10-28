const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ANNOTATION_TOOLS = new Set(["pen", "circle", "rectangle", "arrow", "highlight", "note"]);

function annotationCachePath(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const hashInput = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
  const projectKey = createHash("sha256").update(hashInput).digest("hex");
  return path.join(os.tmpdir(), "specux-browser-annotations", projectKey, "latest.json");
}

async function writeBrowserAnnotationCache(projectRoot, annotationSet) {
  const filePath = annotationCachePath(projectRoot);
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const payload = { formatVersion: 1, ...annotationSet };
  const content = JSON.stringify(payload);
  const stored = JSON.stringify({
    ...payload,
    sha256: createHash("sha256").update(content).digest("hex")
  });

  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, stored, { flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function readBrowserAnnotationCache(projectRoot) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(annotationCachePath(projectRoot), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error("The cached annotation data is invalid. Add an annotation again in the editor.");
    }
    throw error;
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("The cached annotation data is invalid. Add an annotation again in the editor.");
  }
  const { sha256, ...payload } = parsed;
  const expectedHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (payload.formatVersion !== 1 || typeof sha256 !== "string" || sha256 !== expectedHash ||
      typeof payload.screenId !== "string" || !/^[a-z][a-z0-9-]*$/.test(payload.screenId) ||
      typeof payload.previewStateId !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(payload.previewStateId) ||
      !payload.canvasSize ||
      !Number.isInteger(payload.canvasSize.width) || payload.canvasSize.width < 1 ||
      payload.canvasSize.width > 16384 ||
      !Number.isInteger(payload.canvasSize.height) || payload.canvasSize.height < 1 ||
      payload.canvasSize.height > 16384 ||
      payload.coordinateSpace !== "screen canvas pixels" ||
      !Array.isArray(payload.annotations) || payload.annotations.length > 200 ||
      payload.annotations.some((annotation) =>
        !annotation || typeof annotation !== "object" || Array.isArray(annotation) ||
        typeof annotation.id !== "string" || !annotation.id ||
        !ANNOTATION_TOOLS.has(annotation.tool) ||
        !Array.isArray(annotation.points) || annotation.points.length === 0 ||
        annotation.points.length > 2048 ||
        annotation.points.some((point) =>
          !point || !Number.isFinite(point.x) || point.x < 0 ||
          point.x > payload.canvasSize.width || !Number.isFinite(point.y) ||
          point.y < 0 || point.y > payload.canvasSize.height
        )
      )) {
    throw new Error("The cached annotation data is incomplete or corrupt. Add an annotation again in the editor.");
  }
  return payload;
}

async function clearBrowserAnnotationCache(projectRoot) {
  try {
    await fs.rm(annotationCachePath(projectRoot), { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  clearBrowserAnnotationCache,
  readBrowserAnnotationCache,
  writeBrowserAnnotationCache
};
