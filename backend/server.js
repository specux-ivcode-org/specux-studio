const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const YAML = require("yaml");
const validation = require("../shared/validation");
const { validateProject } = require("./project");
const {
  clearBrowserAnnotationCache,
  writeBrowserAnnotationCache
} = require("./browserAnnotationCache");

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_SAVE = 100;
const MAX_ANNOTATIONS_PER_SCREEN = 200;
const MAX_POINTS_PER_ANNOTATION = 2048;
const ANNOTATION_TOOLS = new Set(["pen", "circle", "rectangle", "arrow", "highlight", "note"]);
const mermaidDistRoot = path.dirname(require.resolve("mermaid"));
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

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isSpecuxPreviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "specux:" && url.hostname === "screen" &&
      !url.username && !url.password && !url.port && !url.hash;
  } catch {
    return false;
  }
}

function isValidStateSelection(value) {
  if (typeof value === "string") return true;
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      value.type !== "text" || typeof value.text !== "string" ||
      !value.range || typeof value.range !== "object") return false;
  return ["start", "end"].every((key) => {
    const position = value.range[key];
    return position && Number.isInteger(position.line) && position.line > 0 &&
      Number.isInteger(position.column) && position.column > 0;
  });
}

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function validateAnnotationSet(body) {
  if (!body || Array.isArray(body) || typeof body !== "object" ||
      typeof body.screenId !== "string" || !/^[a-z][a-z0-9-]*$/.test(body.screenId) ||
      body.coordinateSpace !== "screen canvas pixels" ||
      typeof body.previewStateId !== "string" || !/^[a-z][a-z0-9-]*$/.test(body.previewStateId) ||
      !body.canvasSize ||
      !Number.isInteger(body.canvasSize.width) || body.canvasSize.width < 1 ||
      body.canvasSize.width > 16384 ||
      !Number.isInteger(body.canvasSize.height) || body.canvasSize.height < 1 ||
      body.canvasSize.height > 16384 ||
      !Array.isArray(body.annotations) || body.annotations.length > MAX_ANNOTATIONS_PER_SCREEN) {
    throw requestError(
      "Annotations must include a valid screenId, preview state, canvas size, and canvas coordinate space."
    );
  }
  const ids = new Set();
  const annotations = body.annotations.map((annotation) => {
    if (!annotation || Array.isArray(annotation) || typeof annotation !== "object" ||
        typeof annotation.id !== "string" || !annotation.id || annotation.id.length > 100 ||
        ids.has(annotation.id) || !ANNOTATION_TOOLS.has(annotation.tool) ||
        !Array.isArray(annotation.points) || !annotation.points.length ||
        annotation.points.length > MAX_POINTS_PER_ANNOTATION) {
      throw requestError("Each annotation must have a unique id, supported tool, and valid points.");
    }
    ids.add(annotation.id);
    const points = annotation.points.map((point) => {
      if (!point || Array.isArray(point) || typeof point !== "object" ||
          !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < 0 || point.x > body.canvasSize.width ||
          point.y < 0 || point.y > body.canvasSize.height) {
        throw requestError("Annotation points must be within the Screen canvas pixel dimensions.");
      }
      return { x: point.x, y: point.y };
    });
    const clean = {
      id: annotation.id,
      tool: annotation.tool,
      points
    };
    if (annotation.text !== undefined) {
      if (typeof annotation.text !== "string" || annotation.text.length > 500) {
        throw requestError("Annotation text must be at most 500 characters.");
      }
      clean.text = annotation.text;
    }
    if (annotation.target !== undefined) {
      const target = annotation.target;
      if (!target || Array.isArray(target) || typeof target !== "object" ||
          !Array.isArray(target.instancePath) ||
          target.instancePath.some((part) =>
            !(Number.isInteger(part) && part >= 0) &&
            !(typeof part === "string" && /^[a-z][a-z0-9-]*$/.test(part))
          )) {
        throw requestError("Annotation targets must include a valid Element instancePath.");
      }
      if (target.text !== undefined &&
          (typeof target.text !== "string" || target.text.length > 500)) {
        throw requestError("Annotation target text must be at most 500 characters.");
      }
      clean.target = {
        instancePath: target.instancePath,
        ...(typeof target.elementId === "string" ? { elementId: target.elementId } : {}),
        ...(typeof target.name === "string" ? { name: target.name } : {}),
        ...(typeof target.materialId === "string" ? { materialId: target.materialId } : {}),
        ...(typeof target.materialSrc === "string" ? { materialSrc: target.materialSrc } : {}),
        ...(target.text !== undefined ? { text: target.text } : {})
      };
    }
    return clean;
  });
  return {
    screenId: body.screenId,
    annotations,
    coordinateSpace: "screen canvas pixels",
    canvasSize: { ...body.canvasSize },
    previewStateId: body.previewStateId
  };
}

async function listProjectFiles(projectRoot) {
  const realProjectRoot = await fs.realpath(projectRoot);
  const files = [];

  async function visit(directory, relativeDirectory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visit(realProjectRoot, "");
  return files.sort((left, right) => left.localeCompare(right));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw requestError("Request body exceeds the 2 MB limit.", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw requestError("Request body must be valid JSON.");
  }
}

function isSpecPath(relativePath) {
  try {
    validation.validateSpecPath(relativePath);
    return true;
  } catch {
    return false;
  }
}

function isWorkflowPath(relativePath) {
  try {
    validation.validateWorkflowPath(relativePath);
    return true;
  } catch {
    return false;
  }
}

function isScreenFilePath(relativePath) {
  return /^screens\/[a-z][a-z0-9-]*\/screen\.yml$/.test(relativePath);
}

function isMaterialFilePath(relativePath) {
  return /^materials\/[a-z][a-z0-9-]*\.stml$/.test(relativePath);
}

async function resolveProjectDirectory(projectRoot, relativePath, { create = false } = {}) {
  const realProjectRoot = await fs.realpath(projectRoot);
  let current = realProjectRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let details;
    try {
      details = await fs.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT" || !create) throw error;
      await fs.mkdir(current);
      details = await fs.lstat(current);
    }
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw requestError("Project directories must be real directories inside the specux project.");
    }
  }
  if (!isWithin(realProjectRoot, current)) {
    throw requestError("Project directory resolves outside the specux project.");
  }
  return current;
}

function parseYamlMapping(source) {
  if (typeof source !== "string") throw requestError("YAML source must be text.");
  const document = YAML.parseDocument(source);
  if (document.errors.length) {
    const issues = document.errors.map((error) => {
      const position = error.linePos?.[0];
      return position
        ? `line ${position.line}, column ${position.col}: ${error.message}`
        : error.message;
    });
    throw requestError(`Invalid YAML: ${issues.join("; ")}`);
  }
  const data = document.toJS();
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw requestError("YAML source must contain a mapping.");
  }
  return data;
}

async function resolveProjectFile(projectRoot, relativePath, { create = false } = {}) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      relativePath.startsWith("/") || relativePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )) {
    throw requestError("Save paths must be relative paths inside the specux project.");
  }
  const extension = path.extname(relativePath).toLowerCase();
  const specPath = isSpecPath(relativePath);
  const workflowPath = isWorkflowPath(relativePath);
  if (![".yml", ".yaml", validation.MATERIAL_FILE_EXTENSION].includes(extension) &&
      !(extension === ".md" && specPath) && !(extension === ".mmd" && workflowPath)) {
    throw requestError("The editor can only save project YAML, STML, behavior spec Markdown, and Screen workflow Mermaid files.");
  }

  if (extension === validation.MATERIAL_FILE_EXTENSION && !isMaterialFilePath(relativePath)) {
    throw requestError("STML saves are only allowed as named files inside materials/.");
  }

  const target = path.resolve(projectRoot, ...relativePath.split("/"));
  if (!isWithin(projectRoot, target)) {
    throw requestError("Save path is outside the specux project.");
  }

  if (create) {
    const screenFile = isScreenFilePath(relativePath);
    const materialFile = isMaterialFilePath(relativePath);
    if (!screenFile && !specPath && !materialFile && !workflowPath) {
      throw requestError("New files can only be created as named Screen YAML, Material STML, behavior spec Markdown, or Screen workflow Mermaid files.", 400);
    }
    const relativeDirectory = path.posix.dirname(relativePath);
    const realTargetDirectory = await resolveProjectDirectory(projectRoot, relativeDirectory, { create: true });
    const newTarget = path.join(realTargetDirectory, path.basename(relativePath));
    try {
      await fs.lstat(newTarget);
      throw requestError(`Project file "${relativePath}" already exists.`, 409);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return newTarget;
  }

  let realTarget;
  try {
    realTarget = await fs.realpath(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw requestError(`Project file "${relativePath}" does not exist.`);
    }
    throw error;
  }
  if (!isWithin(projectRoot, realTarget)) {
    throw requestError("Save path resolves outside the specux project.");
  }
  const details = await fs.stat(realTarget);
  if (!details.isFile()) throw requestError(`Project path "${relativePath}" is not a file.`);
  return realTarget;
}

async function saveProjectFiles(projectRoot, files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_SAVE) {
    throw requestError(`Save requests must contain between 1 and ${MAX_FILES_PER_SAVE} files.`);
  }
  const seen = new Set();
  const updates = [];
  for (const file of files) {
    if (!file || Array.isArray(file) || typeof file !== "object" || typeof file.path !== "string") {
      throw requestError("Each save entry must specify a project file path.");
    }
    if (Object.hasOwn(file, "create") && typeof file.create !== "boolean") {
      throw requestError("Save entry create flags must be booleans.");
    }
    if (seen.has(file.path)) throw requestError(`Save request contains "${file.path}" more than once.`);
    seen.add(file.path);
    const create = file.create === true;
    const extension = path.extname(file.path).toLowerCase();
    if (extension === ".md") {
      if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
        throw requestError("Behavior spec Markdown save entries must contain text content.");
      }
      try {
        validation.validateSpecContent(file.content);
        const references = validation.parseSpecScreenReferences(file.content, file.path);
        if (/^screens\/[^/]+\/specs\/element-/.test(file.path)) {
          const identity = validation.getElementSpecIdentity(file.path);
          if (!identity) throw new Error("Element behavior spec path is invalid.");
          validation.validateElementSpecPath(file.path, identity.elementId);
          if (!references.some((reference) =>
            reference.screenId === identity.screenId &&
            reference.placementId === identity.elementId
          )) {
            throw new Error(
              `Element behavior specs must include a SpecUX Screen link to Element "${identity.elementId}".`
            );
          }
        }
      } catch (error) {
        throw requestError(`${file.path}: ${error.message || String(error)}`);
      }
      updates.push({ path: file.path, content: file.content, create });
    } else if (extension === ".mmd") {
      if (!isWorkflowPath(file.path) || typeof file.content !== "string" ||
          Object.hasOwn(file, "data")) {
        throw requestError("Screen workflow Mermaid save entries must contain text content at a valid Screen workflow path.");
      }
      updates.push({ path: file.path, content: file.content, create });
    } else if (extension === validation.MATERIAL_FILE_EXTENSION && isMaterialFilePath(file.path)) {
      if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
        throw requestError("Material STML save entries must contain text content.");
      }
      try {
        const { header, body } = validation.splitMaterialDocument(file.content, file.path);
        const materialDocument = parseYamlMapping(header);
        validation.validateMaterialDocumentHeader(materialDocument, file.path);
        const expectedId = path.posix.basename(file.path, validation.MATERIAL_FILE_EXTENSION);
        if (materialDocument.id !== expectedId) {
          throw new Error(`front matter id must match Material file name "${expectedId}${validation.MATERIAL_FILE_EXTENSION}".`);
        }
        validation.validateMaterialMarkup(body, file.path);
        validation.validateMaterialAttributeMarkup(materialDocument, body, file.path);
      } catch (error) {
        throw requestError(`${file.path}: ${error.message || String(error)}`);
      }
      updates.push({ path: file.path, content: file.content, create });
    } else if (typeof file.content === "string" && !Object.hasOwn(file, "data")) {
      parseYamlMapping(file.content);
      updates.push({ path: file.path, content: file.content, create });
    } else {
      if (!Object.hasOwn(file, "data") || !file.data ||
          Array.isArray(file.data) || typeof file.data !== "object" ||
          Object.hasOwn(file, "content")) {
        throw requestError("YAML save entries must contain a mapping of data.");
      }
      updates.push({ path: file.path, content: YAML.stringify(file.data), create });
    }
  }

  const staged = [];
  try {
    for (const update of updates) {
      update.target = await resolveProjectFile(projectRoot, update.path, {
        create: update.create
      });
    }
    for (const update of updates) {
      const temporaryPath = path.join(
        path.dirname(update.target),
        `.${path.basename(update.target)}.${randomUUID()}.tmp`
      );
      await fs.writeFile(temporaryPath, update.content, { encoding: "utf8", flag: "wx" });
      staged.push({ ...update, temporaryPath });
    }
    for (const update of staged) {
      if (update.create) {
        try {
          await fs.link(update.temporaryPath, update.target);
        } catch (error) {
          if (error.code === "EEXIST") {
            throw requestError(`Project file "${update.path}" already exists.`, 409);
          }
          throw error;
        }
        await fs.rm(update.temporaryPath, { force: true });
      } else {
        await fs.rename(update.temporaryPath, update.target);
      }
    }
  } catch (error) {
    await Promise.all(staged.map(({ temporaryPath }) => fs.rm(temporaryPath, { force: true })));
    throw error;
  }
  return { saved: updates.map(({ path: filePath }) => filePath) };
}

async function serveStatic(rootDirectory, projectRoot, sharedRoot, pathname, response) {
  let relativePath;
  let allowedRoot = rootDirectory;
  if (pathname === "/") relativePath = "index.html";
  else if (pathname.startsWith("/vendor/mermaid/")) {
    const packagePath = pathname.slice("/vendor/mermaid/".length);
    if (!packagePath || packagePath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || segment.startsWith(".")
    )) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    allowedRoot = mermaidDistRoot;
    relativePath = path.join(...packagePath.split("/"));
  }
  else if ([
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
  ].includes(pathname)) {
    relativePath = pathname.slice(1);
  } else if ([
    "/shared/yaml.js",
    "/shared/validation.js",
    "/shared/ScreenLayers.mjs",
    "/shared/ScreenGroups.mjs"
  ].includes(pathname)) {
    allowedRoot = sharedRoot;
    relativePath = pathname.slice("/shared/".length);
  } else if (pathname.startsWith("/specux/")) {
    let projectPath;
    try {
      projectPath = decodeURIComponent(pathname.slice("/specux/".length));
    } catch {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    if (projectPath.includes("\\") || projectPath.includes("\0") ||
        path.win32.isAbsolute(projectPath) || projectPath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || segment.startsWith(".")
    )) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    allowedRoot = projectRoot;
    relativePath = path.join(...projectPath.split("/"));
  } else {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const target = path.resolve(allowedRoot, relativePath);
  try {
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

function createServer(options = {}) {
  const repositoryRoot = path.resolve(__dirname, "..");
  const rootDirectory = path.resolve(options.rootDirectory || path.join(repositoryRoot, "frontend"));
  const projectRoot = path.resolve(options.projectRoot ||
    (options.rootDirectory ? path.join(rootDirectory, "specux") : path.join(repositoryRoot, "specux")));
  const sharedRoot = path.resolve(options.sharedRoot || path.join(repositoryRoot, "shared"));
  const eventClients = new Set();
  const selectionState = {
    path: null,
    file: null,
    type: null,
    name: null,
    preview: null,
    selection: null,
    selected: [],
    updatedAt: null
  };
  const annotationsByScreen = new Map();
  let annotationCacheGeneration = 0;
  let annotationCacheQueue = Promise.resolve();
  let server;
  function enqueueAnnotationCacheTask(task) {
    const operation = annotationCacheQueue.then(task);
    annotationCacheQueue = operation.catch(() => {});
    return operation;
  }
  function publishEvent(name, data) {
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) client.write(message);
  }
  function annotationsFor(screenId) {
    const entry = screenId ? annotationsByScreen.get(screenId) : null;
    return {
      screenId: screenId || null,
      coordinateSpace: "screen canvas pixels",
      annotations: entry?.annotations || [],
      ...(entry?.canvasSize ? { canvasSize: entry.canvasSize } : {}),
      ...(entry?.previewStateId ? { previewStateId: entry.previewStateId } : {}),
      updatedAt: entry?.updatedAt || null
    };
  }
  server = http.createServer(async (request, response) => {
    let pathname;
    let requestUrl;
    try {
      requestUrl = new URL(request.url, "http://localhost");
      pathname = requestUrl.pathname;
      if (request.method === "GET") {
        if (pathname === "/api/validation") {
          const result = await validateProject(projectRoot);
          sendJson(response, 200, { errors: result.errors });
          return;
        }
        if (pathname === "/api/status") {
          const address = server.address();
          sendJson(response, 200, {
            status: "ok",
            url: address && typeof address === "object"
              ? `http://127.0.0.1:${address.port}/`
              : null,
            connectedBrowsers: eventClients.size,
            selectionAvailable: selectionState.selection !== null
          });
          return;
        }
        if (pathname === "/api/files") {
          sendJson(response, 200, { files: await listProjectFiles(projectRoot) });
          return;
        }
        if (pathname === "/api/state") {
          const screenId = selectionState.selection?.screen?.id;
          sendJson(response, 200, {
            path: selectionState.path,
            file: selectionState.file,
            type: selectionState.type,
            name: selectionState.name,
            preview: selectionState.preview,
            selected: selectionState.selected,
            annotated: Boolean(
              screenId && annotationsByScreen.get(screenId)?.annotations.length
            )
          });
          return;
        }
        if (pathname === "/api/annotations") {
          const screenId = requestUrl.searchParams.get("screenId") ||
            selectionState.selection?.screen?.id || null;
          sendJson(response, 200, annotationsFor(screenId));
          return;
        }
        if (pathname === "/api/render-annotations") {
          const screenId = requestUrl.searchParams.get("screenId");
          const annotationSet = options.renderAnnotations;
          if (!annotationSet || annotationSet.screenId !== screenId) {
            throw requestError("No matching annotation set is available for this render.", 404);
          }
          sendJson(response, 200, annotationSet);
          return;
        }
        if (pathname === "/api/events") {
          response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
          });
          response.write(": connected\n\n");
          eventClients.add(response);
          response.on("close", () => eventClients.delete(response));
          return;
        }
        await serveStatic(rootDirectory, projectRoot, sharedRoot, pathname, response);
        return;
      }
      if (request.method === "POST" && pathname === "/api/selection") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object" ||
            !Object.hasOwn(body, "selection") ||
            (body.selection !== null && (Array.isArray(body.selection) || typeof body.selection !== "object")) ||
            (Object.hasOwn(body, "path") &&
              (typeof body.path !== "string" || !body.path.startsWith("/") || body.path.startsWith("//"))) ||
            (Object.hasOwn(body, "file") && body.file !== null && typeof body.file !== "string") ||
            (Object.hasOwn(body, "type") &&
              body.type !== null &&
              !["screen", "workflow", "spec", "theme", "project", "material"].includes(body.type)) ||
            (Object.hasOwn(body, "name") && body.name !== null && typeof body.name !== "string") ||
            (Object.hasOwn(body, "preview") &&
              body.preview !== null &&
              !isSpecuxPreviewUrl(body.preview)) ||
            (Object.hasOwn(body, "selected") &&
              (!Array.isArray(body.selected) ||
                body.selected.some((item) => !isValidStateSelection(item))))) {
          throw requestError("Selection updates must contain an object or null and a valid URL path.");
        }
        selectionState.selection = body.selection;
        selectionState.selected = body.selected ??
          (typeof body.selection?.selectedPlacement?.id === "string"
            ? [body.selection.selectedPlacement.id]
            : []);
        if (body.path !== undefined) selectionState.path = body.path;
        if (body.file !== undefined) selectionState.file = body.file;
        if (body.type !== undefined) selectionState.type = body.type;
        if (body.name !== undefined) selectionState.name = body.name;
        if (body.preview !== undefined) selectionState.preview = body.preview;
        selectionState.updatedAt = new Date().toISOString();
        annotationCacheGeneration += 1;
        await enqueueAnnotationCacheTask(() => clearBrowserAnnotationCache(projectRoot));
        sendJson(response, 200, { updated: true });
        return;
      }
      if (request.method === "POST" && pathname === "/api/annotations") {
        const body = await readJsonBody(request);
        const annotationSet = validateAnnotationSet(body);
        const cacheGeneration = annotationCacheGeneration;
        const selectionUpdatedAt = selectionState.updatedAt;
        const updatedAt = new Date().toISOString();
        let cached = false;
        await enqueueAnnotationCacheTask(async () => {
          const selection = selectionState.selection;
          if (cacheGeneration !== annotationCacheGeneration ||
              selectionUpdatedAt !== selectionState.updatedAt ||
              selection?.view !== "screen" ||
              selection.screen?.id !== annotationSet.screenId ||
              (selection.previewStateId || "default") !== annotationSet.previewStateId) {
            return;
          }
          await writeBrowserAnnotationCache(projectRoot, annotationSet);
          cached = true;
        });
        annotationsByScreen.set(annotationSet.screenId, {
          annotations: annotationSet.annotations,
          canvasSize: annotationSet.canvasSize,
          previewStateId: annotationSet.previewStateId,
          updatedAt
        });
        publishEvent("annotations-updated", {
          screenId: annotationSet.screenId,
          updatedAt
        });
        sendJson(response, 200, {
          screenId: annotationSet.screenId,
          saved: annotationSet.annotations.length,
          cached,
          updatedAt
        });
        return;
      }
      if (request.method === "DELETE" && pathname === "/api/annotations") {
        const screenId = requestUrl.searchParams.get("screenId");
        if (screenId && !/^[a-z][a-z0-9-]*$/.test(screenId)) {
          throw requestError("Invalid Screen id for clearing annotations.");
        }
        annotationCacheGeneration += 1;
        await enqueueAnnotationCacheTask(() => clearBrowserAnnotationCache(projectRoot));
        const clearedScreenIds = screenId
          ? (annotationsByScreen.has(screenId) ? [screenId] : [])
          : [...annotationsByScreen.keys()];
        if (screenId) annotationsByScreen.delete(screenId);
        else annotationsByScreen.clear();
        publishEvent("annotations-updated", {
          screenId: screenId || null,
          cleared: true,
          updatedAt: new Date().toISOString()
        });
        sendJson(response, 200, {
          cleared: clearedScreenIds.length,
          screenIds: clearedScreenIds
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/update") {
        const origin = request.headers.origin;
        if (origin) {
          let originUrl;
          try {
            originUrl = new URL(origin);
          } catch {
            throw requestError("Update requests must originate from the local editor.", 403);
          }
          if (!["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname)) {
            throw requestError("Update requests must originate from the local editor.", 403);
          }
        }
        const timestamp = new Date().toISOString();
        publishEvent("project-updated", { timestamp });
        sendJson(response, 200, { notifiedBrowsers: eventClients.size });
        return;
      }
      if (request.method === "POST" && pathname === "/api/save") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object") {
          throw requestError("Save request must be a JSON object.");
        }
        const result = await saveProjectFiles(projectRoot, body.files);
        sendJson(response, 200, result);
        return;
      }
      if (request.method === "POST" && pathname === "/api/yaml/parse") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object") {
          throw requestError("YAML parse request must be a JSON object.");
        }
        sendJson(response, 200, { data: parseYamlMapping(body.source) });
        return;
      }
      if (request.method === "POST" && pathname === "/api/yaml/stringify") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object" ||
            !body.data || Array.isArray(body.data) || typeof body.data !== "object") {
          throw requestError("YAML stringify request must contain a mapping of data.");
        }
        sendJson(response, 200, { source: YAML.stringify(body.data) });
        return;
      }
      sendJson(response, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "Request failed." });
    }
  });
  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "127.0.0.1", () => {
    console.log(`SpecUX editor available at http://127.0.0.1:${port}/`);
  });
}

module.exports = { createServer, saveProjectFiles };
