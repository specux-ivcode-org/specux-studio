#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { createServer } = require("./server");
const { readBrowserAnnotationCache } = require("./browserAnnotationCache");
const { SPECUX_VERSION, isWithin, resolveProjectPath, validateProject } = require("./project");
const validation = require("../shared/validation");

const repositoryRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(repositoryRoot, "frontend");
const schemaFiles = new Map([
  ["project", "project.md"],
  ["screen", "screen.md"],
  ["material", "material.md"],
  ["theme", "theme.md"],
  ["spec", "spec.md"],
  ["workflow", "workflow.md"],
  ["reference", "reference.md"]
]);

function usage() {
  return [
    "SpecUX CLI",
    "",
    "Usage:",
    "  specux server start [--port <port>] [--project <directory>]",
    "  specux server status [--port <port>]",
    "  specux server state [--port <port>]",
    "  specux server screenshot --output <file> [--port <port>]",
    "  specux server annotations [clear] [--port <port>] [--screen <id>]",
    "  specux server update [--port <port>]",
    "  specux init [--project <directory>]",
    "  specux validate [--project <directory>]",
    "  specux version",
    "  specux schema [project|screen|material|theme|spec|workflow|reference]",
    "  specux render <screen> --format <html|image> [--state <id>] [--output <file>] [--annotations] [--project <directory>]"
  ].join("\n");
}

function parseOptions(args, allowedFlags) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (!allowedFlags.has(argument)) throw new Error(`Unknown option "${argument}".`);
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--annotations") {
      options.annotations = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Option "${argument}" requires a value.`);
    index += 1;
    if (argument === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid port "${value}". Use a number from 0 to 65535.`);
      }
      options.port = port;
    } else if (argument === "--format") {
      if (!["html", "image"].includes(value)) {
        throw new Error(`Unsupported render format "${value}". Use "html" or "image".`);
      }
      options.format = value;
    } else if (argument === "--project") {
      options.project = value;
    } else if (argument === "--screen") {
      options.screen = value;
    } else if (argument === "--output") {
      options.output = value;
    } else if (argument === "--state") {
      options.state = value;
    }
  }
  return { positional, options };
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function locateProjectRoot(startDirectory = process.cwd(), projectOption) {
  if (projectOption) {
    const selected = path.resolve(startDirectory, projectOption);
    if (await isFile(path.join(selected, "project.yml"))) return selected;
    if (await isFile(path.join(selected, "specux", "project.yml"))) return path.join(selected, "specux");
    throw new Error(`No project.yml found in "${selected}" or its specux/ subdirectory.`);
  }

  let directory = path.resolve(startDirectory);
  while (true) {
    if (await isFile(path.join(directory, "project.yml"))) return directory;
    if (await isFile(path.join(directory, "specux", "project.yml"))) return path.join(directory, "specux");
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  if (isWithin(repositoryRoot, path.resolve(startDirectory)) &&
      await isFile(path.join(repositoryRoot, "specux", "project.yml"))) {
    return path.join(repositoryRoot, "specux");
  }
  throw new Error("Could not find project.yml. Run this command inside a SpecUX project or use --project <directory>.");
}

function printValidationResult(result) {
  if (!result.errors.length) {
    console.log("SpecUX project is valid.");
    return 0;
  }
  console.error(`Found ${result.errors.length} validation error${result.errors.length === 1 ? "" : "s"}:`);
  for (const error of result.errors) console.error(`- ${error}`);
  return 1;
}

function resolveServerPort(options) {
  const port = options.port ?? Number(process.env.SPECUX_PORT || process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid server port "${port}".`);
  }
  return port;
}

async function startServer(options) {
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const port = resolveServerPort(options);
  const server = createServer({ rootDirectory: frontendRoot, projectRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  console.log(`SpecUX editor available at http://127.0.0.1:${address.port}/`);
  console.log("Press Ctrl+C to stop the server.");
  process.once("SIGINT", () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
}

async function requestServer(port, pathname, options = {}) {
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
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `SpecUX server returned HTTP ${response.status}.`);
  return body;
}

async function runEditorScreenshot(port, output) {
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

async function runServerCommand(command, args) {
  const allowedFlags = command === "start"
    ? new Set(["--port", "--project"])
    : command === "annotations"
      ? new Set(["--port", "--screen"])
      : command === "screenshot"
        ? new Set(["--port", "--output"])
      : new Set(["--port"]);
  const { positional, options } = parseOptions(args, allowedFlags);
  if (command === "annotations") {
    if (positional.length > 1 || (positional.length === 1 && positional[0] !== "clear")) {
      throw new Error('Usage: specux server annotations [clear] [--port <port>] [--screen <id>]');
    }
    const port = resolveServerPort(options);
    if (positional[0] === "clear") {
      let screenId = options.screen;
      if (!screenId) {
        const state = await requestServer(port, "/api/state");
        screenId = state.path
          ? new URL(state.path, "http://localhost").searchParams.get("screen")
          : null;
      }
      if (!screenId) throw new Error("No Screen is selected. Pass --screen <id> to clear its annotations.");
      const result = await requestServer(
        port,
        `/api/annotations?screenId=${encodeURIComponent(screenId)}`,
        { method: "DELETE" }
      );
      console.log(`Cleared annotations for Screen "${screenId}" (${result.cleared} set).`);
      return;
    }
    const pathname = options.screen
      ? `/api/annotations?screenId=${encodeURIComponent(options.screen)}`
      : "/api/annotations";
    const annotations = await requestServer(port, pathname);
    console.log(JSON.stringify(annotations, null, 2));
    return;
  }
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  if (command === "start") return startServer(options);
  const port = resolveServerPort(options);
  if (command === "screenshot") {
    if (!options.output) {
      throw new Error("Usage: specux server screenshot --output <file> [--port <port>]");
    }
    return runEditorScreenshot(port, options.output);
  }
  if (command === "status") {
    try {
      const status = await requestServer(port, "/api/status");
      console.log(JSON.stringify(status, null, 2));
      return;
    } catch (error) {
      console.error(`SpecUX server is not reachable at http://127.0.0.1:${port}/.`);
      return 1;
    }
  }
  if (command === "state") {
    const state = await requestServer(port, "/api/state");
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (command === "update") {
    const result = await requestServer(port, "/api/update", { method: "POST", body: {} });
    const count = result.notifiedBrowsers;
    console.log(`Notified ${count} connected browser${count === 1 ? "" : "s"}.`);
    return;
  }
  throw new Error(`Unknown server command "${command}".`);
}

async function runSchemaCommand(args) {
  if (args.length > 1) throw new Error("Usage: specux schema [project|screen|material|theme|spec|workflow|reference]");
  const type = args[0];
  const docs = type ? [schemaFiles.get(type)] : [...schemaFiles.values()];
  if (type && !docs[0]) {
    throw new Error(`Unknown schema type "${type}". Use project, screen, material, theme, spec, workflow, or reference.`);
  }
  const content = await Promise.all(docs.map((file) =>
    fs.readFile(path.join(repositoryRoot, "schema", file), "utf8")
  ));
  process.stdout.write(content.join("\n\n---\n\n"));
}

function runVersionCommand(args) {
  if (args.length) throw new Error("Usage: specux version");
  console.log(SPECUX_VERSION);
}

async function runValidateCommand(args) {
  const { positional, options } = parseOptions(args, new Set(["--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const result = await validateProject(projectRoot);
  return printValidationResult(result);
}

async function runInitCommand(args) {
  const YAML = await import("../shared/yaml.mjs");
  const { positional, options } = parseOptions(args, new Set(["--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);

  const workingDirectory = path.resolve(process.cwd(), options.project || ".");
  const projectDirectory = path.join(workingDirectory, "specux");
  const files = [
    ["project.yml", YAML.stringify({
      name: "SpecUX Project",
      specux: SPECUX_VERSION,
      screens: [{ id: "home", file: "screens/home/screen.yml" }],
      theme: "theme.yml"
    })],
    ["screens/home/screen.yml", YAML.stringify({
      name: "Home",
      description: "Starter Screen for the SpecUX project.",
      layers: [{ id: "base", name: "Base" }],
      materials: [
        {
          id: "welcome",
          src: "materials/label.stml",
          attributes: { text: "Welcome to SpecUX" },
          position: { x: 48, y: 48 },
          size: { width: 360, height: 56 },
          rotation: 0,
          layer: "base"
        },
        {
          id: "get-started",
          src: "materials/button.stml",
          attributes: { text: "Get started" },
          position: { x: 48, y: 128 },
          size: { width: 160, height: 48 },
          rotation: 0,
          layer: "base"
        }
      ]
    })],
    ["materials/label.stml", [
      "---",
      "id: label",
      "name: Label",
      "type: label",
      "attributes:",
      "  text:",
      "    type: string",
      "    default: Label",
      "    overridable: true",
      "---",
      '<div class="material-visual material-visual-label">${attributes.text}</div>',
      ""
    ].join("\n")],
    ["materials/button.stml", [
      "---",
      "id: button",
      "name: Button",
      "type: button",
      "attributes:",
      "  text:",
      "    type: string",
      "    default: Button",
      "    overridable: true",
      "---",
      '<div class="material-visual material-visual-button">${attributes.text}</div>',
      ""
    ].join("\n")],
    ["theme.yml", YAML.stringify({
      tokens: {
        primary: "#4569e8",
        ink: "#1e293b",
        background: "#f3f6fa"
      }
    })]
  ];

  const conflicts = [];
  for (const [relativePath] of files) {
    const target = path.join(projectDirectory, relativePath);
    try {
      await fs.lstat(target);
      conflicts.push(relativePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (conflicts.length) {
    throw new Error(
      `Cannot initialize SpecUX because these files already exist in "${projectDirectory}": ${conflicts.join(", ")}.`
    );
  }

  const createdFiles = [];
  try {
    for (const [relativePath, content] of files) {
      const target = path.join(projectDirectory, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: "wx" });
      createdFiles.push(target);
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const target of createdFiles) {
      try {
        await fs.rm(target);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "SpecUX initialization failed and some created files could not be removed."
      );
    }
    throw error;
  }

  console.log(`Created SpecUX starter project in "${projectDirectory}".`);
  console.log('Run "specux validate" to check the new project.');
}

function findBrowserExecutable() {
  const candidates = [
    process.env.SPECUX_BROWSER,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    process.platform === "win32" && process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "win32" && process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : null,
    process.platform === "darwin"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : null,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (require("node:fs").statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  for (const name of process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["chromium", "chromium-browser", "google-chrome", "microsoft-edge"]) {
    const result = spawnSync(lookup, [name], { encoding: "utf8", windowsHide: true });
    const found = result.status === 0 ? result.stdout.split(/\r?\n/)[0].trim() : "";
    if (found) return found;
  }
  return null;
}

function runBrowser(executable, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const collect = (chunks, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 32 * 1024 * 1024) {
        child.kill();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("Browser renderer output exceeded the 32 MB limit."));
        }
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Could not run the browser renderer: ${error.message}`));
    });
    child.once("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = {
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (timedOut) {
        const details = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-8).join("\n");
        reject(new Error(`Browser renderer timed out after ${timeoutMs} ms.${details ? `\n${details}` : ""}`));
      } else {
        resolve(result);
      }
    });
  });
}

function createBrowserArgs(url, temporaryDirectory, viewportWidth, viewportHeight, screenshotPath) {
  const args = [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--window-size=${viewportWidth},${viewportHeight}`,
    "--virtual-time-budget=10000",
    `--user-data-dir=${path.join(temporaryDirectory, "profile")}`
  ];
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() === 0) {
    args.push("--no-sandbox");
  }
  if (screenshotPath) args.push(`--screenshot=${screenshotPath}`);
  else args.push("--dump-dom");
  args.push(url.href);
  return args;
}

function browserFailure(result) {
  const details = (result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-8).join("\n");
  return new Error(`Browser rendering failed${details ? `:\n${details}` : "."}`);
}

async function inlineProjectResources(html, origin, projectRoot) {
  const urls = new Set();
  const prefix = `${origin}/specux/`;
  for (const match of html.matchAll(/https?:\/\/[^"'()<>\s]+/g)) {
    if (match[0].startsWith(prefix)) urls.add(match[0]);
  }

  const contentTypes = new Map([
    [".css", "text/css"],
    [".avif", "image/avif"],
    [".bmp", "image/bmp"],
    [".gif", "image/gif"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".otf", "font/otf"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".ttf", "font/ttf"],
    [".webp", "image/webp"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"]
  ]);
  for (const resourceUrl of urls) {
    const encodedPath = resourceUrl.slice(prefix.length).split(/[?#]/, 1)[0];
    const relativePath = decodeURIComponent(encodedPath);
    const filePath = await resolveProjectPath(projectRoot, relativePath, "file");
    const content = await fs.readFile(filePath);
    const contentType = contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    html = html.replaceAll(resourceUrl, `data:${contentType};base64,${content.toString("base64")}`);
  }
  return html;
}

async function closeServer(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

async function runRenderCommand(args) {
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

  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const validationResult = await validateProject(projectRoot);
  if (validationResult.errors.length) {
    printValidationResult(validationResult);
    return 1;
  }
  const screen = validationResult.screens.find((entry) => entry.id === positional[0]);
  if (!screen) throw new Error(`Unknown Screen "${positional[0]}".`);
  if (options.state !== undefined &&
      !screen.data["preview-states"]?.some((state) => state.id === options.state)) {
    const states = screen.data["preview-states"] || [{ id: "default" }];
    throw new Error(
      `Unknown Screen State "${options.state}" for Screen "${screen.id}". Available states: ${states.map((state) => state.id).join(", ")}.`
    );
  }
  let renderState = options.state;
  let renderAnnotations = null;
  if (options.annotations) {
    if (options.port !== undefined) {
      console.warn('The "--port" option is ignored for --annotations; the CLI uses its local renderer.');
    }
    const annotationSet = await readBrowserAnnotationCache(projectRoot);
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
    if (options.state !== undefined && annotationSet.previewStateId !== options.state) {
      throw new Error(
        `The cached annotations are for Screen State "${annotationSet.previewStateId}", not "${options.state}". Select that state and add an annotation to refresh the cache.`
      );
    }
    renderState = options.state || annotationSet.previewStateId;
    if (renderState !== "default" &&
        !screen.data["preview-states"]?.some((state) => state.id === renderState)) {
      throw new Error(
        `The cached annotations reference unknown Screen State "${renderState}" for Screen "${screen.id}".`
      );
    }
    renderAnnotations = {
      screenId: annotationSet.screenId,
      coordinateSpace: annotationSet.coordinateSpace,
      canvasSize: annotationSet.canvasSize,
      previewStateId: annotationSet.previewStateId,
      annotations: annotationSet.annotations
    };
  }

  const browser = findBrowserExecutable();
  if (!browser) {
    throw new Error("A Chromium-based browser is required. Set SPECUX_BROWSER to its executable path.");
  }

  const server = createServer({ rootDirectory: frontendRoot, projectRoot, renderAnnotations });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const temporaryDirectory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "specux-render-"));
  const outputPath = options.output ? path.resolve(options.output) : null;
  try {
    if (outputPath) await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const address = server.address();
    const url = new URL("/", `http://127.0.0.1:${address.port}`);
    url.searchParams.set("render", positional[0]);
    url.searchParams.set("format", options.format);
    if (renderState !== undefined) url.searchParams.set("state", renderState);
    if (renderAnnotations) url.searchParams.set("annotations", "true");
    const timeoutMs = Number(process.env.SPECUX_RENDER_TIMEOUT_MS) || 60000;
    let result;
    let measurement;
    if (options.format === "image") {
      const measureArgs = createBrowserArgs(url, temporaryDirectory, 1440, 1000);
      if (process.env.SPECUX_DEBUG_RENDER) {
        console.error(`Using browser: ${browser}`);
        console.error(`Browser arguments: ${measureArgs.join(" ")}`);
      }
      measurement = await runBrowser(browser, measureArgs, timeoutMs);
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
      result = await runBrowser(browser, screenshotArgs, timeoutMs);
    } else {
      const browserArgs = createBrowserArgs(url, temporaryDirectory, 1440, 1000);
      if (process.env.SPECUX_DEBUG_RENDER) {
        console.error(`Using browser: ${browser}`);
        console.error(`Browser arguments: ${browserArgs.join(" ")}`);
      }
      result = await runBrowser(browser, browserArgs, timeoutMs);
    }
    if (result.status !== 0) throw browserFailure(result);
    if (options.format === "image") {
      const image = await fs.readFile(outputPath);
      if (image.length < 8 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error("The browser did not produce a valid PNG image.");
      }
      console.log(`Rendered Screen "${screen.id}" to ${outputPath}`);
      return;
    }
    const match = /data-specux-render-ready="true"[^>]*data-specux-render-html="([A-Za-z0-9+/=]+)"/.exec(result.stdout) ||
      /data-specux-render-html="([A-Za-z0-9+/=]+)"[^>]*data-specux-render-ready="true"/.exec(result.stdout);
    const encodedHtml = match && (match[1] || match[2]);
    if (!encodedHtml) throw new Error("The browser could not render that Screen as HTML.");
    const renderedHtml = Buffer.from(encodedHtml, "base64").toString("utf8");
    const html = await inlineProjectResources(renderedHtml, url.origin, projectRoot);
    if (outputPath) {
      await fs.writeFile(outputPath, html, "utf8");
      console.log(`Rendered Screen "${screen.id}" to ${outputPath}`);
    } else {
      process.stdout.write(html);
    }
  } finally {
    try {
      await closeServer(server);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return;
  }
  const [command, ...rest] = args;
  if (command === "server") {
    const [subcommand, ...subArgs] = rest;
    if (!subcommand) {
      throw new Error("Usage: specux server <start|status|state|screenshot|annotations|update>");
    }
    return runServerCommand(subcommand, subArgs);
  }
  if (command === "init") return runInitCommand(rest);
  if (command === "version") return runVersionCommand(rest);
  if (command === "--version" || command === "-v") return runVersionCommand(rest);
  if (command === "schema") return runSchemaCommand(rest);
  if (command === "validate") return runValidateCommand(rest);
  if (command === "render") return runRenderCommand(rest);
  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

if (require.main === module) {
  main().then((exitCode) => {
    if (typeof exitCode === "number") process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  inlineProjectResources,
  locateProjectRoot,
  runInitCommand
};
