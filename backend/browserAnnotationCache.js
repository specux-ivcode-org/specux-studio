const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ANNOTATION_TOOLS = new Set(["pen", "circle", "rectangle", "arrow", "highlight", "note"]);

/** Checks that cached canvas dimensions are positive integers within the supported limit. */
function hasValidCanvasSize(size) {
  return size && Number.isInteger(size.width) && size.width >= 1 && size.width <= 16384 &&
    Number.isInteger(size.height) && size.height >= 1 && size.height <= 16384;
}

/** Checks that a cached annotation has a supported tool and a bounded point list. */
function hasValidAnnotation(annotation, canvasSize) {
  return annotation && typeof annotation === "object" && !Array.isArray(annotation) &&
    typeof annotation.id === "string" && Boolean(annotation.id) &&
    ANNOTATION_TOOLS.has(annotation.tool) && Array.isArray(annotation.points) &&
    annotation.points.length > 0 && annotation.points.length <= 2048 &&
    annotation.points.every((point) =>
      point && Number.isFinite(point.x) && point.x >= 0 && point.x <= canvasSize.width &&
      Number.isFinite(point.y) && point.y >= 0 && point.y <= canvasSize.height
    );
}

/** Checks the checksum and required metadata for a cached annotation payload. */
function hasValidCacheMetadata(payload, sha256) {
  // Verify the stored checksum before trusting any cached annotation metadata.
  const expectedHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  // Reject payloads that do not match the supported identity, dimensions, and content limits.
  return payload.formatVersion === 1 && typeof sha256 === "string" && sha256 === expectedHash &&
    hasValidCacheIdentity(payload) && hasValidCanvasSize(payload.canvasSize) &&
    payload.coordinateSpace === "screen canvas pixels" &&
    Array.isArray(payload.annotations) && payload.annotations.length <= 200 &&
    payload.annotations.every((annotation) => hasValidAnnotation(annotation, payload.canvasSize));
}

/** Checks the required screen and preview identifiers in a cached payload. */
function hasValidCacheIdentity(payload) {
  return typeof payload.screenId === "string" && /^[a-z][a-z0-9-]*$/.test(payload.screenId) &&
    typeof payload.previewStateId === "string" &&
    /^[a-z][a-z0-9-]*$/.test(payload.previewStateId);
}

/** Builds a stable temporary cache path scoped to the resolved project root. */
function annotationCachePath(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const hashInput = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
  const projectKey = createHash("sha256").update(hashInput).digest("hex");
  return path.join(os.tmpdir(), "specux-browser-annotations", projectKey, "latest.json");
}

/** Atomically stores a checksummed annotation set in the per-project cache. */
async function writeBrowserAnnotationCache(projectRoot, annotationSet) {
  // Prepare a complete payload and its checksum before touching the cache file.
  const filePath = annotationCachePath(projectRoot);
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const payload = { formatVersion: 1, ...annotationSet };
  const content = JSON.stringify(payload);
  const stored = JSON.stringify({
    ...payload,
    sha256: createHash("sha256").update(content).digest("hex")
  });

  // Write beside the destination, then atomically replace it after the write succeeds.
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, stored, { flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

/** Loads and validates the cached annotation set, returning null when no cache exists. */
async function readBrowserAnnotationCache(projectRoot) {
  // Read and decode the persisted cache, distinguishing a missing cache from corruption.
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

  // Separate and verify the checksum before returning only the trusted annotation payload.
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("The cached annotation data is invalid. Add an annotation again in the editor.");
  }
  const { sha256, ...payload } = parsed;
  if (!hasValidCacheMetadata(payload, sha256)) {
    throw new Error("The cached annotation data is incomplete or corrupt. Add an annotation again in the editor.");
  }
  return payload;
}

/** Removes the per-project annotation cache if it exists. */
async function clearBrowserAnnotationCache(projectRoot) {
  // Treat an absent cache as already cleared while preserving other filesystem failures.
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
