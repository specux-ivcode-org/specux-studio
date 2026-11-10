const { randomUUID } = require("node:crypto");
const {
  clearBrowserAnnotationCache,
  writeBrowserAnnotationCache
} = require("../browserAnnotationCache");
const { requestError } = require("./httpUtils");

const EDITOR_IMAGE_CAPTURE_TIMEOUT_MS = 20000;

/** Owns live editor selection, annotations, connected browsers, and image captures. */
class EditorSession {
  #projectRoot;
  #eventClients = new Set();
  #selectionState = {
    path: null,
    file: null,
    type: null,
    name: null,
    clientId: null,
    preview: null,
    selection: null,
    selected: [],
    annotationContext: null,
    annotations: [],
    updatedAt: null
  };
  #pendingEditorImageCaptures = new Map();
  #annotationsByScreen = new Map();
  #annotationCacheGeneration = 0;
  #annotationCacheQueue = Promise.resolve();

  /** Creates an isolated live-editor session for one project root. */
  constructor(projectRoot) {
    this.#projectRoot = projectRoot;
  }

  /** Returns the number of browsers currently subscribed to editor events. */
  get connectedBrowserCount() {
    return this.#eventClients.size;
  }

  /** Reports whether a browser has published an editor selection. */
  get hasSelection() {
    return this.#selectionState.selection !== null;
  }

  /** Returns the active Screen ID when the current selection has one. */
  get currentScreenId() {
    return this.#selectionState.selection?.screen?.id;
  }

  /** Registers a browser's response stream for server-sent events. */
  addEventClient(response) {
    this.#eventClients.add(response);
  }

  /** Removes a browser response stream after it disconnects. */
  removeEventClient(response) {
    this.#eventClients.delete(response);
  }

  /** Broadcasts a named server-sent event to connected editor browsers. */
  publishEvent(name, data) {
    // Serialize the event once so every connected browser receives the same payload.
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.#eventClients) client.write(message);
  }

  /** Builds the public annotation response for a Screen, including empty defaults. */
  getAnnotations(screenId) {
    const entry = screenId ? this.#annotationsByScreen.get(screenId) : null;
    return {
      screenId: screenId || null,
      coordinateSpace: "screen canvas pixels",
      annotations: entry?.annotations || [],
      ...(entry?.canvasSize ? { canvasSize: entry.canvasSize } : {}),
      ...(entry?.previewStateId ? { previewStateId: entry.previewStateId } : {}),
      updatedAt: entry?.updatedAt || null
    };
  }

  /** Builds the current selection and annotation snapshot returned by the state API. */
  getEditorState() {
    const screenId = this.currentScreenId;
    const screenAnnotations = screenId && this.#annotationsByScreen.has(screenId)
      ? this.getAnnotations(screenId)
      : null;
    return {
      path: this.#selectionState.path,
      file: this.#selectionState.file,
      type: this.#selectionState.type,
      name: this.#selectionState.name,
      preview: this.#selectionState.preview,
      selected: this.#selectionState.selected,
      ...(this.#selectionState.annotationContext
        ? {
            annotationContext: this.#selectionState.annotationContext,
            annotations: this.#selectionState.annotations
          }
        : {}),
      ...(screenAnnotations ? { screenAnnotations } : {}),
      annotated: Boolean(
        (this.#selectionState.annotationContext && this.#selectionState.annotations.length) ||
        (screenId && this.#annotationsByScreen.get(screenId)?.annotations.length)
      )
    };
  }

  /** Applies optional selection fields only when the payload includes them. */
  #applyOptionalSelectionFields(body) {
    if (body.path !== undefined) this.#selectionState.path = body.path;
    if (body.file !== undefined) this.#selectionState.file = body.file;
    if (body.type !== undefined) this.#selectionState.type = body.type;
    if (body.name !== undefined) this.#selectionState.name = body.name;
    if (body.preview !== undefined) this.#selectionState.preview = body.preview;
  }

  /** Applies a validated selection payload to the in-memory editor state. */
  #applySelection(body, editorAnnotations) {
    // Replace selection-specific state while preserving optional fields omitted by the caller.
    this.#selectionState.selection = body.selection;
    this.#selectionState.annotationContext = editorAnnotations?.context || null;
    this.#selectionState.annotations = editorAnnotations?.annotations || [];
    this.#selectionState.selected = body.selected ??
      (typeof body.selection?.selectedPlacement?.id === "string"
        ? [body.selection.selectedPlacement.id]
        : []);
    this.#applyOptionalSelectionFields(body);
    this.#selectionState.clientId = body.clientId ?? null;
    this.#selectionState.updatedAt = new Date().toISOString();
  }

  /** Applies a validated editor selection and invalidates the previous browser cache. */
  async updateSelection(body, editorAnnotations) {
    // Apply the new selection before invalidating cached annotations from the previous context.
    this.#applySelection(body, editorAnnotations);
    this.#annotationCacheGeneration += 1;
    await this.#enqueueAnnotationCacheTask(() => clearBrowserAnnotationCache(this.#projectRoot));
  }

  /** Saves a validated Screen annotation set and caches it only for the matching active context. */
  async saveAnnotations(annotationSet) {
    // Capture the active context so a queued cache write cannot outlive this selection.
    const cacheGeneration = this.#annotationCacheGeneration;
    const selectionUpdatedAt = this.#selectionState.updatedAt;
    const updatedAt = new Date().toISOString();
    let cached = false;

    // Cache the set only if the active selection still matches when the write reaches the queue.
    await this.#enqueueAnnotationCacheTask(async () => {
      const selection = this.#selectionState.selection;
      if (cacheGeneration !== this.#annotationCacheGeneration ||
          selectionUpdatedAt !== this.#selectionState.updatedAt ||
          selection?.view !== "screen" ||
          selection.screen?.id !== annotationSet.screenId ||
          (selection.previewStateId || "default") !== annotationSet.previewStateId) {
        return;
      }
      await writeBrowserAnnotationCache(this.#projectRoot, annotationSet);
      cached = true;
    });

    // Update live Screen annotations and notify connected browsers after cache processing.
    this.#annotationsByScreen.set(annotationSet.screenId, {
      annotations: annotationSet.annotations,
      canvasSize: annotationSet.canvasSize,
      previewStateId: annotationSet.previewStateId,
      updatedAt
    });
    this.publishEvent("annotations-updated", {
      screenId: annotationSet.screenId,
      updatedAt
    });
    return {
      screenId: annotationSet.screenId,
      saved: annotationSet.annotations.length,
      cached,
      updatedAt
    };
  }

  /** Clears one Screen's annotations or all annotations and removes the browser cache. */
  async clearAnnotations(screenId) {
    // Invalidate queued writes and clear the browser cache before changing the live annotation map.
    this.#annotationCacheGeneration += 1;
    await this.#enqueueAnnotationCacheTask(() => clearBrowserAnnotationCache(this.#projectRoot));
    const clearedScreenIds = screenId
      ? (this.#annotationsByScreen.has(screenId) ? [screenId] : [])
      : [...this.#annotationsByScreen.keys()];

    // Remove the requested Screen or all Screens, then publish the resulting clear event.
    if (screenId) this.#annotationsByScreen.delete(screenId);
    else this.#annotationsByScreen.clear();
    this.publishEvent("annotations-updated", {
      screenId: screenId || null,
      cleared: true,
      updatedAt: new Date().toISOString()
    });
    return {
      cleared: clearedScreenIds.length,
      screenIds: clearedScreenIds
    };
  }

  /** Requests a PNG from the active editor browser and rejects on timeout or context change. */
  async captureEditorImage() {
    // Require an active browser selection and at least one connected event stream.
    if (!this.#selectionState.path || !this.#selectionState.clientId) {
      throw requestError("No active editor browser has published its selection.", 409);
    }
    if (this.#eventClients.size === 0) {
      throw requestError("No editor browser is connected to capture an image.", 409);
    }

    // Ask the active browser for a capture and wait only until its response deadline.
    const requestId = randomUUID();
    const clientId = this.#selectionState.clientId;
    const image = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#finishEditorImageCapture(
          requestId,
          null,
          requestError("The active editor did not respond to the image capture request.", 504)
        );
      }, EDITOR_IMAGE_CAPTURE_TIMEOUT_MS);
      this.#pendingEditorImageCaptures.set(requestId, {
        clientId,
        resolve,
        reject,
        timeout
      });
      this.publishEvent("capture-editor-image", { requestId, clientId });
    });

    // Refuse to return a capture if the active browser changed while it was being produced.
    if (this.#selectionState.clientId !== clientId) {
      throw requestError("The active editor changed during image capture. Retry the command.", 409);
    }
    return { image, state: this.getEditorState() };
  }

  /** Reports whether an upload matches an outstanding capture request and browser. */
  hasPendingEditorImageCapture(requestId, clientId) {
    const capture = this.#pendingEditorImageCaptures.get(requestId);
    return Boolean(capture && capture.clientId === clientId);
  }

  /** Completes a pending capture with its PNG and ignores uploads arriving after timeout. */
  receiveEditorImage(requestId, image) {
    this.#finishEditorImageCapture(requestId, image);
  }

  /** Rejects a pending capture using a validated failure report from the active editor. */
  reportEditorImageFailure(body) {
    // Accept a failure only from the browser that owns the pending capture.
    const capture = this.#pendingEditorImageCaptures.get(body?.requestId);
    if (!capture || capture.clientId !== body?.clientId ||
        typeof body.message !== "string" || !body.message.trim()) {
      throw requestError("This image capture failure report is invalid or expired.");
    }
    this.#finishEditorImageCapture(
      body.requestId,
      null,
      requestError(`The active editor could not capture an image: ${body.message.slice(0, 500)}`, 422)
    );
  }

  /** Settles an outstanding capture once and releases its timeout and map entry. */
  #finishEditorImageCapture(requestId, image, error) {
    // Remove and settle a capture once, releasing its timeout regardless of outcome.
    const capture = this.#pendingEditorImageCaptures.get(requestId);
    if (!capture) return false;
    this.#pendingEditorImageCaptures.delete(requestId);
    clearTimeout(capture.timeout);
    if (error) capture.reject(error);
    else capture.resolve(image);
    return true;
  }

  /** Serializes cache operations while keeping the queue usable after a failed task. */
  #enqueueAnnotationCacheTask(task) {
    // Chain cache writes in order and keep a rejection from poisoning later queue entries.
    const operation = this.#annotationCacheQueue.then(task);
    this.#annotationCacheQueue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { EditorSession };
