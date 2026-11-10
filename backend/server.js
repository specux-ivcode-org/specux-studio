const http = require("node:http");
const path = require("node:path");
const { validateProject } = require("./project");
const { EditorSession } = require("./server/editorSession");
const { ProjectFileService, saveProjectFiles } = require("./server/projectFileService");
const { StaticFileService } = require("./server/staticFileService");
const {
  MAX_EDITOR_IMAGE_BYTES,
  readBufferBody,
  readJsonBody,
  requestError,
  sendJson
} = require("./server/httpUtils");
const { validateAnnotationSet, validateSelectionRequest } = require("./server/requestValidation");

/** Validates update request origins and rejects non-local browser origins. */
function validateUpdateOrigin(origin) {
  if (!origin) return;
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

/** Creates the editor HTTP server and delegates state and file operations to focused services. */
class EditorServer {
  #getRoutes;
  #postRoutes;
  #deleteRoutes;

  /** Configures server roots, collaborators, and the HTTP request handler. */
  constructor(options = {}) {
    // Resolve the editor, project, and shared roots before creating their services.
    const repositoryRoot = path.resolve(__dirname, "..");
    const rootDirectory = path.resolve(options.rootDirectory || path.join(repositoryRoot, "frontend"));
    const projectRoot = path.resolve(options.projectRoot ||
      (options.rootDirectory ? path.join(rootDirectory, "specux") : path.join(repositoryRoot, "specux")));
    const sharedRoot = path.resolve(options.sharedRoot || path.join(repositoryRoot, "shared"));
    this.options = options;
    this.projectRoot = projectRoot;
    this.projectFiles = new ProjectFileService({ projectRoot });
    this.staticFiles = new StaticFileService({ rootDirectory, projectRoot, sharedRoot });
    this.session = new EditorSession(projectRoot);
    this.httpServer = null;

    // Register the supported API routes by HTTP method.
    this.#getRoutes = new Map([
      ["/api/validation", (_request, response) => this.#getValidation(response)],
      ["/api/status", (_request, response) => this.#getStatus(response)],
      ["/api/files", (_request, response) => this.#getFiles(response)],
      ["/api/state", (_request, response) => this.#getState(response)],
      ["/api/annotations", (_request, response, url) => this.#getAnnotations(response, url)],
      ["/api/render-annotations", (_request, response, url) => this.#getRenderAnnotations(response, url)],
      ["/api/events", (_request, response) => this.#getEvents(response)]
    ]);
    this.#postRoutes = new Map([
      ["/api/editor-image/capture", (_request, response) => this.#captureEditorImage(response)],
      ["/api/editor-image", (request, response, url) => this.#uploadEditorImage(request, response, url)],
      ["/api/editor-image/failure", (request, response) => this.#reportEditorImageFailure(request, response)],
      ["/api/selection", (request, response) => this.#updateSelection(request, response)],
      ["/api/annotations", (request, response) => this.#saveAnnotations(request, response)],
      ["/api/update", (request, response) => this.#publishUpdate(request, response)],
      ["/api/save", (request, response) => this.#saveFiles(request, response)],
      ["/api/yaml/parse", (request, response) => this.#parseYaml(request, response)],
      ["/api/yaml/stringify", (request, response) => this.#stringifyYaml(request, response)]
    ]);
    this.#deleteRoutes = new Map([
      ["/api/annotations", (request, response, url) => this.#clearAnnotations(response, url)]
    ]);
  }

  /** Creates the Node HTTP server and binds request handling to this instance. */
  createServer() {
    this.httpServer = http.createServer(this.handleRequest.bind(this));
    return this.httpServer;
  }

  /** Returns project validation errors. */
  async #getValidation(response) {
    const result = await validateProject(this.projectRoot);
    sendJson(response, 200, { errors: result.errors });
  }

  /** Returns server and browser connection status. */
  #getStatus(response) {
    const address = this.httpServer.address();
    sendJson(response, 200, {
      status: "ok",
      url: address && typeof address === "object"
        ? `http://127.0.0.1:${address.port}/`
        : null,
      connectedBrowsers: this.session.connectedBrowserCount,
      selectionAvailable: this.session.hasSelection
    });
  }

  /** Returns the visible project file list. */
  async #getFiles(response) {
    sendJson(response, 200, { files: await this.projectFiles.listFiles() });
  }

  /** Returns the editor's current state snapshot. */
  #getState(response) {
    sendJson(response, 200, this.session.getEditorState());
  }

  /** Returns annotations for an explicitly requested or currently selected Screen. */
  #getAnnotations(response, requestUrl) {
    const screenId = requestUrl.searchParams.get("screenId") ||
      this.session.currentScreenId || null;
    sendJson(response, 200, this.session.getAnnotations(screenId));
  }

  /** Returns the annotation set supplied for the current render operation. */
  #getRenderAnnotations(response, requestUrl) {
    // Return only annotations explicitly associated with this render request.
    const screenId = requestUrl.searchParams.get("screenId");
    const annotationSet = this.options.renderAnnotations;
    if (!annotationSet || annotationSet.screenId !== screenId) {
      throw requestError("No matching annotation set is available for this render.", 404);
    }
    sendJson(response, 200, annotationSet);
  }

  /** Opens a server-sent event stream for the connected editor browser. */
  #getEvents(response) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(": connected\n\n");
    this.session.addEventClient(response);
    response.on("close", () => this.session.removeEventClient(response));
  }

  /** Routes GET requests to API handlers or the static file service. */
  async #handleGet(request, response, requestUrl) {
    const handler = this.#getRoutes.get(requestUrl.pathname);
    if (handler) return handler(request, response, requestUrl);
    return this.staticFiles.serve(requestUrl.pathname, response);
  }

  /** Captures the active editor image and returns its state snapshot. */
  async #captureEditorImage(response) {
    const capture = await this.session.captureEditorImage();
    sendJson(response, 200, {
      image: capture.image.toString("base64"),
      state: capture.state
    });
  }

  /** Receives a PNG image only while its capture request remains active. */
  async #uploadEditorImage(request, response, requestUrl) {
    // Confirm the capture request is still active and belongs to the requesting browser.
    const requestId = requestUrl.searchParams.get("requestId");
    const clientId = requestUrl.searchParams.get("clientId");
    if (!this.session.hasPendingEditorImageCapture(requestId, clientId)) {
      throw requestError("This image capture request is no longer active.", 404);
    }
    if (request.headers["content-type"] !== "image/png") {
      throw requestError("Editor image uploads must use image/png.", 415);
    }

    // Enforce the upload limit and PNG signature before passing the image to the session.
    const image = await readBufferBody(request, MAX_EDITOR_IMAGE_BYTES);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (image.length < 8 || !image.subarray(0, 8).equals(pngSignature)) {
      throw requestError("The editor did not provide a valid PNG image.");
    }
    this.session.receiveEditorImage(requestId, image);
    sendJson(response, 202, { received: true });
  }

  /** Records an editor image capture failure reported by its browser. */
  async #reportEditorImageFailure(request, response) {
    const body = await readJsonBody(request);
    this.session.reportEditorImageFailure(body);
    sendJson(response, 202, { received: true });
  }

  /** Applies a validated editor selection and optional annotation context. */
  async #updateSelection(request, response) {
    const body = await readJsonBody(request);
    const editorAnnotations = validateSelectionRequest(body);
    await this.session.updateSelection(body, editorAnnotations);
    sendJson(response, 200, { updated: true });
  }

  /** Validates and stores Screen-scoped annotations. */
  async #saveAnnotations(request, response) {
    const body = await readJsonBody(request);
    const annotationSet = validateAnnotationSet(body);
    sendJson(response, 200, await this.session.saveAnnotations(annotationSet));
  }

  /** Clears saved annotations for an optional Screen ID. */
  async #clearAnnotations(response, requestUrl) {
    const screenId = requestUrl.searchParams.get("screenId");
    if (screenId && !/^[a-z][a-z0-9-]*$/.test(screenId)) {
      throw requestError("Invalid Screen id for clearing annotations.");
    }
    sendJson(response, 200, await this.session.clearAnnotations(screenId));
  }

  /** Publishes a project-updated event after validating a supplied origin. */
  #publishUpdate(request, response) {
    validateUpdateOrigin(request.headers.origin);
    const timestamp = new Date().toISOString();
    this.session.publishEvent("project-updated", { timestamp });
    sendJson(response, 200, { notifiedBrowsers: this.session.connectedBrowserCount });
  }

  /** Validates and saves a batch of project files. */
  async #saveFiles(request, response) {
    // Require a JSON object before delegating path and content validation to the file service.
    const body = await readJsonBody(request);
    if (!body || Array.isArray(body) || typeof body !== "object") {
      throw requestError("Save request must be a JSON object.");
    }
    const result = await this.projectFiles.saveFiles(body.files);
    sendJson(response, 200, result);
  }

  /** Parses YAML request text and returns its mapping data. */
  async #parseYaml(request, response) {
    // Require a JSON object and return the parsed YAML mapping.
    const body = await readJsonBody(request);
    if (!body || Array.isArray(body) || typeof body !== "object") {
      throw requestError("YAML parse request must be a JSON object.");
    }
    sendJson(response, 200, { data: await this.projectFiles.parseYaml(body.source) });
  }

  /** Serializes a YAML mapping supplied by the editor. */
  async #stringifyYaml(request, response) {
    // Require a JSON object containing a mapping before serializing YAML.
    const body = await readJsonBody(request);
    if (!body || Array.isArray(body) || typeof body !== "object" ||
        !body.data || Array.isArray(body.data) || typeof body.data !== "object") {
      throw requestError("YAML stringify request must contain a mapping of data.");
    }
    sendJson(response, 200, { source: await this.projectFiles.stringifyYaml(body.data) });
  }

  /** Routes POST requests to API handlers and reports whether a route matched. */
  async #handlePost(request, response, requestUrl) {
    const handler = this.#postRoutes.get(requestUrl.pathname);
    if (!handler) return false;
    await handler(request, response, requestUrl);
    return true;
  }

  /** Routes DELETE requests to API handlers and reports whether a route matched. */
  async #handleDelete(request, response, requestUrl) {
    const handler = this.#deleteRoutes.get(requestUrl.pathname);
    if (!handler) return false;
    await handler(request, response, requestUrl);
    return true;
  }

  /** Dispatches a request by HTTP method, using static assets only for GET fallbacks. */
  async #dispatchRequest(request, response, requestUrl) {
    // Handle GET requests directly, then try the state-changing route tables.
    if (request.method === "GET") return this.#handleGet(request, response, requestUrl);
    if (request.method === "POST" && await this.#handlePost(request, response, requestUrl)) return;
    if (request.method === "DELETE" && await this.#handleDelete(request, response, requestUrl)) return;
    sendJson(response, 405, { error: "Method not allowed." });
  }

  /** Routes API and static-file requests, converting thrown errors into JSON responses. */
  async handleRequest(request, response) {
    // Parse and dispatch the request, converting handler failures to JSON error responses.
    try {
      const requestUrl = new URL(request.url, "http://localhost");
      await this.#dispatchRequest(request, response, requestUrl);
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "Request failed." });
    }
  }
}

/** Preserves the existing factory API while constructing the class-based server. */
function createServer(options = {}) {
  return new EditorServer(options).createServer();
}

if (require.main === module) {
  // Start the standalone editor on the configured loopback port.
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "127.0.0.1", () => {
    console.log(`SpecUX editor available at http://127.0.0.1:${port}/`);
  });
}

module.exports = { createServer, saveProjectFiles };
