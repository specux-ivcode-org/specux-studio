const fs = require("node:fs/promises");
const path = require("node:path");
const validation = require("../../shared/validation");
const { sendJson } = require("./httpUtils");
const { isWithin } = require("../project/paths");

const mermaidDistRoot = path.dirname(require.resolve("mermaid"));
const html2canvasDistRoot = path.dirname(require.resolve("html2canvas"));
const yamlPackageRoot = path.dirname(require.resolve("yaml/package.json"));
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".yml", "text/yaml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mmd", "text/markdown; charset=utf-8"],
  [validation.MATERIAL_FILE_EXTENSION, "text/plain; charset=utf-8"]
]);
const PACKAGE_ROOTS = [
  { prefix: "/vendor/html2canvas/", root: html2canvasDistRoot },
  { prefix: "/vendor/mermaid/", root: mermaidDistRoot },
  { prefix: "/vendor/yaml/", root: yamlPackageRoot }
];
const EDITOR_ASSETS = new Set([
  "/index.html",
  "/app.mjs",
  "/icons/spec-icon.svg",
  "/browser/EditorEventController.mjs",
  "/styles.css",
  "/browser/BrowserHistory.mjs",
  "/browser/EditorNavigation.mjs",
  "/browser/InspectorRenderer.mjs",
  "/browser/MaterialFileEditor.mjs",
  "/browser/ProjectRepository.mjs",
  "/browser/ProjectFileNavigator.mjs",
  "/browser/ProjectFileTree.mjs",
  "/browser/ProjectPersistence.mjs",
  "/browser/ResizablePanels.mjs",
  "/browser/PreviewStateController.mjs",
  "/browser/ResponsiveToolbarController.mjs",
  "/browser/ScreenAnnotationController.mjs",
  "/browser/ScreenController.mjs",
  "/browser/ScreenSelectionController.mjs",
  "/browser/ScreenRulerController.mjs",
  "/browser/ScreenCanvasViewportController.mjs",
  "/browser/ScreenYamlEditor.mjs",
  "/browser/MaterialCanvas.mjs",
  "/browser/ScreenMaterialController.mjs",
  "/browser/ScreenMaterialRenderer.mjs",
  "/browser/MaterialDefaults.mjs",
  "/browser/SpecEditor.mjs",
  "/browser/SplitViewLayout.mjs",
  "/browser/ThemeEditor.mjs",
  "/browser/TemplateMarkupRenderer.mjs",
  "/browser/WorkspaceViewRenderer.mjs",
  "/browser/WorkflowEditor.mjs"
]);
const SHARED_ASSETS = new Set([
  "/shared/yaml.mjs",
  "/shared/validation.js",
  "/shared/ScreenLayers.mjs",
  "/shared/ScreenGroups.mjs"
]);

/** Rejects hidden, empty, and traversal segments in a static asset path. */
function hasSafePathSegments(value) {
  return Boolean(value) && !value.split("/").some((segment) =>
    !segment || segment === "." || segment === ".." || segment.startsWith(".")
  );
}

/** Resolves an allowlisted dependency asset path. */
function resolvePackageAsset(pathname) {
  const packageRoot = PACKAGE_ROOTS.find(({ prefix }) => pathname.startsWith(prefix));
  if (!packageRoot) return null;
  const packagePath = pathname.slice(packageRoot.prefix.length);
  if (!hasSafePathSegments(packagePath)) return null;
  return {
    allowedRoot: packageRoot.root,
    relativePath: path.join(...packagePath.split("/"))
  };
}

/** Resolves a validated project file path below the SpecUX URL prefix. */
function resolveProjectAsset(pathname, projectRoot) {
  if (!pathname.startsWith("/specux/")) return null;
  let projectPath;
  try {
    projectPath = decodeURIComponent(pathname.slice("/specux/".length));
  } catch {
    return null;
  }
  if (projectPath.includes("\\") || projectPath.includes("\0") ||
      path.win32.isAbsolute(projectPath) || !hasSafePathSegments(projectPath)) {
    return null;
  }
  return {
    allowedRoot: projectRoot,
    relativePath: path.join(...projectPath.split("/"))
  };
}

/** Selects an allowlisted file and its root directory for an HTTP pathname. */
function resolveStaticAsset(pathname, roots) {
  if (pathname === "/") {
    return { allowedRoot: roots.rootDirectory, relativePath: "index.html" };
  }
  const packageAsset = resolvePackageAsset(pathname);
  if (packageAsset) return packageAsset;
  if (EDITOR_ASSETS.has(pathname)) {
    return { allowedRoot: roots.rootDirectory, relativePath: pathname.slice(1) };
  }
  if (SHARED_ASSETS.has(pathname)) {
    return { allowedRoot: roots.sharedRoot, relativePath: pathname.slice("/shared/".length) };
  }
  return resolveProjectAsset(pathname, roots.projectRoot);
}

/** Serves allowlisted editor assets and project files from their configured roots. */
class StaticFileService {
  /** Stores the roots from which static resources may be served. */
  constructor({ rootDirectory, projectRoot, sharedRoot }) {
    this.rootDirectory = rootDirectory;
    this.projectRoot = projectRoot;
    this.sharedRoot = sharedRoot;
  }

  /** Serves allowlisted editor assets and project files while confining reads to their roots. */
  async serve(pathname, response) {
    // Resolve only configured assets and return immediately for paths outside the allowlist.
    const asset = resolveStaticAsset(pathname, this);
    if (!asset) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }

    const { allowedRoot, relativePath } = asset;
    const target = path.resolve(allowedRoot, relativePath);
    try {
      // Resolve symlinks and ensure the final target is a regular file beneath its allowed root.
      const realTarget = await fs.realpath(target);
      if (!isWithin(allowedRoot, realTarget)) {
        sendJson(response, 404, { error: "File not found." });
        return;
      }
      const details = await fs.stat(realTarget);
      if (!details.isFile()) {
        sendJson(response, 404, { error: "File not found." });
        return;
      }

      // Read the verified file and send it with its extension-based content type.
      const content = await fs.readFile(realTarget);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES.get(path.extname(realTarget).toLowerCase()) || "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": content.length,
        "X-Content-Type-Options": "nosniff"
      });
      response.end(content);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        sendJson(response, 404, { error: "File not found." });
        return;
      }
      throw error;
    }
  }
}

module.exports = { StaticFileService };
