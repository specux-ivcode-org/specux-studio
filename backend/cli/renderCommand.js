const fs = require("node:fs/promises");
const path = require("node:path");
const { createServer } = require("../server");
const { readBrowserAnnotationCache } = require("../browserAnnotationCache");
const { validateProject } = require("../project");
const {
  frontendRoot,
  locateProjectRoot,
  parseOptions,
  printValidationResult
} = require("./support");
const {
  browserFailure,
  closeServer,
  createBrowserArgs,
  findBrowserExecutable,
  inlineProjectResources,
  runBrowser
} = require("./browserRenderer");

/** Parses render arguments and rejects unsupported option combinations. */
function parseRenderOptions(args) {
  const { positional, options } = parseOptions(
    args,
    new Set(["--annotations", "--format", "--output", "--port", "--project", "--state"])
  );
  if (positional.length !== 1 || !options.format) {
    throw new Error("Usage: specux render <screen> --format <html|image> [--state <id>] [--output <file>] [--annotations] [--project <directory>]");
  }
  if (options.port !== undefined && !options.annotations) {
    throw new Error('The "--port" option requires "--annotations".');
  }
  if (options.annotations && options.format !== "image") {
    throw new Error('The "--annotations" option requires "--format image".');
  }
  if (options.format === "image" && !options.output) {
    throw new Error("Image rendering requires --output <file>.");
  }
  return { screenId: positional[0], options };
}

/** Checks that a Screen State ID is available on the selected Screen. */
function hasScreenState(screen, stateId) {
  return screen.data["preview-states"]?.some((state) => state.id === stateId) || false;
}

/** Loads the project and resolves the requested Screen and state. */
async function loadScreenContext(projectRoot, screenId, stateId) {
  // Validate the full project before resolving the requested Screen and state.
  const validationResult = await validateProject(projectRoot);
  if (validationResult.errors.length) {
    printValidationResult(validationResult);
    return null;
  }

  // Confirm the Screen exists and that the requested state belongs to it.
  const screen = validationResult.screens.find((entry) => entry.id === screenId);
  if (!screen) throw new Error(`Unknown Screen "${screenId}".`);
  if (stateId !== undefined && !hasScreenState(screen, stateId)) {
    const states = screen.data["preview-states"] || [{ id: "default" }];
    throw new Error(
      `Unknown Screen State "${stateId}" for Screen "${screen.id}". Available states: ${states.map((state) => state.id).join(", ")}.`
    );
  }
  return screen;
}

/** Checks that cached annotations match the requested Screen and state. */
function validateCachedAnnotations(annotationSet, screen, requestedState) {
  // Require a cache for the requested Screen and enforce any explicit state selection.
  if (!annotationSet) {
    throw new Error(
      `No annotations are cached for Screen "${screen.id}". Add an annotation in the editor with that Screen selected, then retry.`
    );
  }
  if (annotationSet.screenId !== screen.id) {
    throw new Error(
      `The cached annotations are for Screen "${annotationSet.screenId}", not "${screen.id}". Select that Screen and add an annotation to refresh the cache.`
    );
  }
  if (requestedState !== undefined && annotationSet.previewStateId !== requestedState) {
    throw new Error(
      `The cached annotations are for Screen State "${annotationSet.previewStateId}", not "${requestedState}". Select that state and add an annotation to refresh the cache.`
    );
  }

  // Ensure the effective cached state is still defined by the Screen.
  const renderState = requestedState || annotationSet.previewStateId;
  if (renderState !== "default" && !hasScreenState(screen, renderState)) {
    throw new Error(
      `The cached annotations reference unknown Screen State "${renderState}" for Screen "${screen.id}".`
    );
  }
  return renderState;
}

/** Loads annotation context when requested and returns the effective state and annotations. */
async function loadRenderAnnotations(options, projectRoot, screen) {
  // Leave annotations absent unless the caller explicitly requests the editor cache.
  if (!options.annotations) {
    return { renderState: options.state, renderAnnotations: null };
  }
  if (options.port !== undefined) {
    console.warn('The "--port" option is ignored for --annotations; the CLI uses its local renderer.');
  }

  // Validate the cached Screen and state before preparing renderer input.
  const annotationSet = await readBrowserAnnotationCache(projectRoot);
  const renderState = validateCachedAnnotations(annotationSet, screen, options.state);
  return {
    renderState,
    renderAnnotations: {
      screenId: annotationSet.screenId,
      coordinateSpace: annotationSet.coordinateSpace,
      canvasSize: annotationSet.canvasSize,
      previewStateId: annotationSet.previewStateId,
      annotations: annotationSet.annotations
    }
  };
}

/** Creates the temporary editor server and waits until it is listening. */
async function startRenderServer(projectRoot, renderAnnotations) {
  const server = createServer({ rootDirectory: frontendRoot, projectRoot, renderAnnotations });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

/** Builds the local render URL with its Screen, format, state, and annotation options. */
function createRenderUrl(server, screenId, format, renderState, renderAnnotations) {
  const address = server.address();
  const url = new URL("/", `http://127.0.0.1:${address.port}`);
  url.searchParams.set("render", screenId);
  url.searchParams.set("format", format);
  if (renderState !== undefined) url.searchParams.set("state", renderState);
  if (renderAnnotations) url.searchParams.set("annotations", "true");
  return url;
}

/** Measures Screen height and captures a full-height PNG. */
async function renderImage(browser, url, temporaryDirectory, outputPath, timeoutMs) {
  // Measure the rendered Screen height at the standard width before capturing it.
  const measureArgs = createBrowserArgs(url, temporaryDirectory, 1440, 1000);
  if (process.env.SPECUX_DEBUG_RENDER) {
    console.error(`Using browser: ${browser}`);
    console.error(`Browser arguments: ${measureArgs.join(" ")}`);
  }
  const measurement = await runBrowser(browser, measureArgs, timeoutMs);
  if (measurement.status !== 0) throw browserFailure(measurement);

  const heightMatch = /data-specux-render-height="(\d+)"/.exec(measurement.stdout);
  const viewportHeight = heightMatch ? Number(heightMatch[1]) : 0;
  if (!Number.isSafeInteger(viewportHeight) || viewportHeight < 1 || viewportHeight > 16384) {
    throw new Error(
      heightMatch
        ? `Rendered Screen height ${viewportHeight}px exceeds the 16384px image limit.`
        : "The browser could not measure the rendered Screen height."
    );
  }

  // Capture the full Screen using the measured height and requested output path.
  const screenshotArgs = createBrowserArgs(
    url,
    temporaryDirectory,
    1440,
    viewportHeight,
    outputPath
  );
  if (process.env.SPECUX_DEBUG_RENDER) {
    console.error(`Browser arguments: ${screenshotArgs.join(" ")}`);
  }
  return runBrowser(browser, screenshotArgs, timeoutMs);
}

/** Captures the rendered document for HTML output. */
async function renderHtml(browser, url, temporaryDirectory, timeoutMs) {
  const browserArgs = createBrowserArgs(url, temporaryDirectory, 1440, 1000);
  if (process.env.SPECUX_DEBUG_RENDER) {
    console.error(`Using browser: ${browser}`);
    console.error(`Browser arguments: ${browserArgs.join(" ")}`);
  }
  return runBrowser(browser, browserArgs, timeoutMs);
}

/** Runs the browser in the requested output mode and returns its process result. */
async function renderInBrowser(browser, url, temporaryDirectory, outputPath, format, timeoutMs) {
  if (format === "image") {
    return renderImage(browser, url, temporaryDirectory, outputPath, timeoutMs);
  }
  return renderHtml(browser, url, temporaryDirectory, timeoutMs);
}

/** Validates the browser PNG and reports the saved output path. */
async function writeImageOutput(screenId, outputPath) {
  const image = await fs.readFile(outputPath);
  if (image.length < 8 ||
      !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("The browser did not produce a valid PNG image.");
  }
  console.log(`Rendered Screen "${screenId}" to ${outputPath}`);
}

/** Extracts browser-rendered HTML, inlines project resources, and writes or prints it. */
async function writeHtmlOutput(result, url, projectRoot, outputPath, screenId) {
  // Extract the browser's completed rendered document from its DOM output.
  const match = /data-specux-render-ready="true"[^>]*data-specux-render-html="([A-Za-z0-9+/=]+)"/.exec(result.stdout) ||
    /data-specux-render-html="([A-Za-z0-9+/=]+)"[^>]*data-specux-render-ready="true"/.exec(result.stdout);
  const encodedHtml = match && (match[1] || match[2]);
  if (!encodedHtml) throw new Error("The browser could not render that Screen as HTML.");

  // Inline project resources so saved or printed HTML works without the temporary server.
  const renderedHtml = Buffer.from(encodedHtml, "base64").toString("utf8");
  const html = await inlineProjectResources(renderedHtml, url.origin, projectRoot);
  if (outputPath) {
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`Rendered Screen "${screenId}" to ${outputPath}`);
    return;
  }
  process.stdout.write(html);
}

/** Saves the selected output format after confirming that the browser succeeded. */
async function writeRenderOutput(result, format, screenId, outputPath, url, projectRoot) {
  // Surface browser failures before writing either supported output format.
  if (result.status !== 0) throw browserFailure(result);
  if (format === "image") {
    await writeImageOutput(screenId, outputPath);
    return;
  }
  await writeHtmlOutput(result, url, projectRoot, outputPath, screenId);
}

/** Validates and renders a Screen as HTML or PNG, optionally including cached annotations. */
async function runRenderCommand(args) {
  // Parse the command and validate its requested Screen and state.
  const { screenId, options } = parseRenderOptions(args);
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const screen = await loadScreenContext(projectRoot, screenId, options.state);
  if (!screen) return 1;

  // Add cached annotations only after confirming they match the selected Screen and state.
  const { renderState, renderAnnotations } =
    await loadRenderAnnotations(options, projectRoot, screen);

  // Confirm the renderer exists before opening a temporary local server.
  const browser = findBrowserExecutable();
  if (!browser) {
    throw new Error("A Chromium-based browser is required. Set SPECUX_BROWSER to its executable path.");
  }

  // Create the render server and prepare paths for output and isolated browser data.
  const server = await startRenderServer(projectRoot, renderAnnotations);
  let temporaryDirectory;
  const outputPath = options.output ? path.resolve(options.output) : null;
  try {
    temporaryDirectory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "specux-render-"));
    if (outputPath) await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Build the request URL and run the browser in the selected output mode.
    const url = createRenderUrl(
      server,
      screenId,
      options.format,
      renderState,
      renderAnnotations
    );
    const timeoutMs = Number(process.env.SPECUX_RENDER_TIMEOUT_MS) || 60000;
    const result = await renderInBrowser(
      browser,
      url,
      temporaryDirectory,
      outputPath,
      options.format,
      timeoutMs
    );

    // Validate and write the requested output, then always release temporary resources.
    await writeRenderOutput(result, options.format, screenId, outputPath, url, projectRoot);
  } finally {
    try {
      await closeServer(server);
    } finally {
      if (temporaryDirectory) {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
}

module.exports = { runRenderCommand };
