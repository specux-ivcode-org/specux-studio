const fs = require("node:fs/promises");
const path = require("node:path");
const { createServer } = require("../server");
const {
  frontendRoot,
  locateProjectRoot,
  parseOptions,
  resolveServerPort
} = require("./support");

const PORT_ONLY_FLAGS = new Set(["--port"]);
const COMMAND_FLAGS = new Map([
  ["start", new Set(["--port", "--project"])],
  ["annotations", new Set(["--port", "--screen"])],
  ["screenshot", new Set(["--port", "--output"])]
]);

/** Starts the editor server for the selected project and registers Ctrl+C shutdown. */
async function startServer(options) {
  // Resolve the project and port before opening the local editor server.
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const port = resolveServerPort(options);
  const server = createServer({ rootDirectory: frontendRoot, projectRoot });

  // Wait for the loopback listener to start before reporting its address.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  // Report the selected port and shut down cleanly on Ctrl+C.
  const address = server.address();
  console.log(`SpecUX editor available at http://127.0.0.1:${address.port}/`);
  console.log("Press Ctrl+C to stop the server.");

  // Close active connections before shutting down on Ctrl+C.
  process.once("SIGINT", () => {
    server.closeAllConnections?.();

    // Exit only after the listener has completed shutdown.
    server.close(() => process.exit(0));
  });
}

/** Sends a JSON request to the local editor server and rejects unsuccessful responses. */
async function requestServer(port, pathname, options = {}) {
  // Send the requested JSON operation to the loopback editor server.
  const url = `http://127.0.0.1:${port}${pathname}`;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(2000)
    });
  } catch (error) {
    throw new Error(`Could not reach the SpecUX server at http://127.0.0.1:${port}/. Run "specux server start" first.`, {
      cause: error
    });
  }

  // Decode the response when possible, then surface HTTP errors consistently.
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `SpecUX server returned HTTP ${response.status}.`);
  return body;
}

/** Requests the active editor's screenshot, validates the PNG, and writes it to disk. */
async function runEditorScreenshot(port, output) {
  // Request the active browser capture and provide connection guidance on failure.
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/editor-image/capture`, {
      method: "POST",
      signal: AbortSignal.timeout(25000)
    });
  } catch (error) {
    throw new Error(
      `Could not capture an editor image from http://127.0.0.1:${port}/. ` +
        'Make sure the editor is open in a connected browser.',
      { cause: error }
    );
  }

  // Validate the response and PNG signature before writing the requested output.
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `SpecUX server returned HTTP ${response.status}.`);
  }
  if (typeof result.image !== "string" || !result.state) {
    throw new Error("The editor server returned an invalid image capture.");
  }
  const image = Buffer.from(result.image, "base64");
  if (image.length < 8 ||
      !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("The editor browser did not produce a valid PNG image.");
  }
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, image);
  console.log(JSON.stringify({
    output: outputPath,
    ...result.state
  }, null, 2));
}

/** Resolves the selected screen ID from the editor's current path. */
async function getSelectedScreenId(port) {
  const state = await requestServer(port, "/api/state");
  return state.path
    ? new URL(state.path, "http://localhost").searchParams.get("screen")
    : null;
}

/** Deletes the selected screen's saved annotation sets. */
async function clearAnnotations(port, screenId) {
  const selectedScreenId = screenId || await getSelectedScreenId(port);
  if (!selectedScreenId) {
    throw new Error("No Screen is selected. Pass --screen <id> to clear its annotations.");
  }
  const result = await requestServer(
    port,
    `/api/annotations?screenId=${encodeURIComponent(selectedScreenId)}`,
    { method: "DELETE" }
  );
  console.log(`Cleared annotations for Screen "${selectedScreenId}" (${result.cleared} set).`);
}

/** Lists or clears annotations for the requested or currently selected screen. */
async function runAnnotationsCommand(positional, options) {
  // Validate command arguments and resolve the target server port.
  if (positional.length > 1 || (positional.length === 1 && positional[0] !== "clear")) {
    throw new Error('Usage: specux server annotations [clear] [--port <port>] [--screen <id>]');
  }
  const port = resolveServerPort(options);

  // Clear the selected Screen or print its current annotation set.
  if (positional[0] === "clear") return clearAnnotations(port, options.screen);
  const pathname = options.screen
    ? `/api/annotations?screenId=${encodeURIComponent(options.screen)}`
    : "/api/annotations";
  const annotations = await requestServer(port, pathname);
  console.log(JSON.stringify(annotations, null, 2));
}

/** Requires and writes a requested screenshot from the active editor. */
async function runScreenshotCommand(port, options) {
  if (!options.output) {
    throw new Error("Usage: specux server screenshot --output <file> [--port <port>]");
  }
  return runEditorScreenshot(port, options.output);
}

/** Prints the server status, returning a nonzero status when it is unreachable. */
async function runStatusCommand(port) {
  try {
    const status = await requestServer(port, "/api/status");
    console.log(JSON.stringify(status, null, 2));
    return;
  } catch (error) {
    console.error(`SpecUX server is not reachable at http://127.0.0.1:${port}/.`);
    return 1;
  }
}

/** Prints the current editor state. */
async function runStateCommand(port) {
  const state = await requestServer(port, "/api/state");
  console.log(JSON.stringify(state, null, 2));
}

/** Notifies connected browsers that project files were updated. */
async function runUpdateCommand(port) {
  const result = await requestServer(port, "/api/update", { method: "POST", body: {} });
  const count = result.notifiedBrowsers;
  console.log(`Notified ${count} connected browser${count === 1 ? "" : "s"}.`);
}

/** Validates and dispatches a server subcommand, printing its result or status. */
async function runServerCommand(command, args) {
  // Parse only flags supported by this server command before dispatching it.
  const { positional, options } = parseOptions(args, COMMAND_FLAGS.get(command) || PORT_ONLY_FLAGS);
  if (command === "annotations") return runAnnotationsCommand(positional, options);
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  if (command === "start") return startServer(options);

  // Route the remaining operations through their shared server port and handler table.
  const port = resolveServerPort(options);
  const handlers = new Map([
    ["screenshot", runScreenshotCommand],
    ["status", runStatusCommand],
    ["state", runStateCommand],
    ["update", runUpdateCommand]
  ]);
  const handler = handlers.get(command);
  if (!handler) throw new Error(`Unknown server command "${command}".`);
  return handler(port, options);
}

module.exports = { runServerCommand };
