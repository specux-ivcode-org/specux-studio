const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { resolveProjectPath } = require("../project/paths");

/** Returns browser paths configured for the current host platform. */
function platformBrowserCandidates() {
  const windowsCandidates = process.platform === "win32"
    ? [
        process.env.ProgramFiles
          ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")
          : null,
        process.env["ProgramFiles(x86)"]
          ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
          : null,
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
          : null,
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
          : null
      ]
    : [];
  const macCandidates = process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      ]
    : [];
  return [
    ...windowsCandidates,
    ...macCandidates,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge"
  ].filter(Boolean);
}

/** Returns the first existing regular file in an ordered list of browser paths. */
function findExistingBrowser(candidates) {
  for (const candidate of candidates) {
    try {
      if (require("node:fs").statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

/** Searches PATH for a supported browser executable. */
function findBrowserOnPath() {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const names = process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["chromium", "chromium-browser", "google-chrome", "microsoft-edge"];
  for (const name of names) {
    const result = spawnSync(lookup, [name], { encoding: "utf8", windowsHide: true });
    const found = result.status === 0 ? result.stdout.split(/\r?\n/)[0].trim() : "";
    if (found) return found;
  }
  return null;
}

/** Finds a Chromium-based browser using configured paths and common install locations. */
function findBrowserExecutable() {
  // Honor explicit browser paths before checking platform defaults and PATH.
  const configuredCandidates = [
    process.env.SPECUX_BROWSER,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH
  ].filter(Boolean);
  return findExistingBrowser([...configuredCandidates, ...platformBrowserCandidates()]) ||
    findBrowserOnPath();
}

/** Runs the headless browser with a timeout and bounded stdout/stderr collection. */
function runBrowser(executable, args, timeoutMs) {
  // Run Chromium while bounding both its lifetime and captured diagnostic output.
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

/** Builds Chromium flags for measuring HTML or capturing a screenshot. */
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

/** Creates an error containing the browser's final diagnostic output. */
function browserFailure(result) {
  const details = (result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-8).join("\n");
  return new Error(`Browser rendering failed${details ? `:\n${details}` : "."}`);
}

/** Replaces rendered project resource URLs with data URLs so HTML is self-contained. */
async function inlineProjectResources(html, origin, projectRoot) {
  // Find unique project URLs embedded in rendered markup.
  const urls = new Set();
  const prefix = `${origin}/specux/`;
  for (const match of html.matchAll(/https?:\/\/[^"'()<>\s]+/g)) {
    if (match[0].startsWith(prefix)) urls.add(match[0]);
  }

  // Map local resource extensions to data URL media types.
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

  // Resolve each URL inside the project, encode its contents, and replace the reference.
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

/** Closes the temporary render server and propagates close errors. */
async function closeServer(server) {
  // Wait for the listener to close and propagate any shutdown error.
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

module.exports = {
  browserFailure,
  closeServer,
  createBrowserArgs,
  findBrowserExecutable,
  inlineProjectResources,
  runBrowser
};
