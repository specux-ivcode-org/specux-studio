const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { createServer } = require("../backend/server");
const {
  clearBrowserAnnotationCache,
  readBrowserAnnotationCache
} = require("../backend/browserAnnotationCache");
const validation = require("../shared/validation");
const cliPath = path.join(__dirname, "..", "backend", "cli.js");
const editorHtmlPath = path.join(__dirname, "..", "frontend", "index.html");
const execFileAsync = promisify(execFile);

function materialDocument(data, body) {
  return validation.formatMaterialDocument(YAML.stringify(data), body);
}

async function withServer(run) {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "specux-server-test-"));
  await fs.mkdir(path.join(rootDirectory, "specux"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "specux", "screens"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "specux", "materials"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "browser"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "icons"), { recursive: true });
  await fs.writeFile(path.join(rootDirectory, "index.html"), "<h1>Editor</h1>");
  await fs.writeFile(path.join(rootDirectory, "app.mjs"), "window.editor = true;");
  await fs.writeFile(
    path.join(rootDirectory, "icons", "spec-icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  );
  await fs.writeFile(path.join(rootDirectory, "styles.css"), "body { color: black; }\n");
  await fs.writeFile(
    path.join(rootDirectory, "browser", "EditorEventController.mjs"),
    "export class EditorEventController {}\n"
  );
  await fs.writeFile(path.join(rootDirectory, "browser", "BrowserHistory.mjs"), "export class BrowserHistory {}\n");
  await fs.writeFile(
    path.join(rootDirectory, "browser", "EditorNavigation.mjs"),
    "export class EditorNavigation {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ProjectFileNavigator.mjs"),
    "export class ProjectFileNavigator {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ResizablePanels.mjs"),
    "export class ResizablePanels {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "InspectorRenderer.mjs"),
    "export class InspectorRenderer {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "MaterialFileEditor.mjs"),
    "export class MaterialFileEditor {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "TemplateMarkupRenderer.mjs"),
    "export class TemplateMarkupRenderer {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ScreenYamlEditor.mjs"),
    "export class ScreenYamlEditor {}\n"
  );
  await fs.writeFile(path.join(rootDirectory, "browser", "ScreenController.mjs"), "export class ScreenController {}\n");
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ScreenAnnotationController.mjs"),
    "export class ScreenAnnotationController {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ScreenSelectionController.mjs"),
    "export class ScreenSelectionController {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ScreenRulerController.mjs"),
    "export class ScreenRulerController {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ProjectFileTree.mjs"),
    "export class ProjectFileTree {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ProjectPersistence.mjs"),
    "export class ProjectPersistence {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "PreviewStateController.mjs"),
    "export class PreviewStateController {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ResponsiveToolbarController.mjs"),
    "export class ResponsiveToolbarController {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ProjectRepository.mjs"),
    "export class ProjectRepository {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "SpecEditor.mjs"),
    "export class SpecEditor {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "SplitViewLayout.mjs"),
    "export class SplitViewLayout {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ThemeEditor.mjs"),
    "export class ThemeEditor {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "WorkspaceViewRenderer.mjs"),
    "export class WorkspaceViewRenderer {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "WorkflowEditor.mjs"),
    "export class WorkflowEditor {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "MaterialCanvas.mjs"),
    "export class MaterialCanvas {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ScreenMaterialController.mjs"),
    "export class ScreenMaterialController {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "ScreenMaterialRenderer.mjs"),
    "export class ScreenMaterialRenderer {}\n"
  );
  await fs.writeFile(
    path.join(rootDirectory, "browser", "MaterialDefaults.mjs"),
    "export function getMaterialDefaultSize() { return null; }\n"
  );
  await fs.writeFile(path.join(rootDirectory, "specux", "project.yml"), "name: Example\n");
  await fs.writeFile(path.join(rootDirectory, "specux", "screen.yml"), "name: Before\n");
  await fs.writeFile(
    path.join(rootDirectory, "specux", "materials", "demo.stml"),
    materialDocument({
      id: "demo",
      name: "Demo",
      type: "label"
    }, "<p>Before</p>")
  );
  await fs.writeFile(
    path.join(rootDirectory, "specux", "materials", "preview image.png"),
    Buffer.from("image")
  );
  const server = createServer({ rootDirectory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, rootDirectory });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
    await clearBrowserAnnotationCache(path.join(rootDirectory, "specux"));
    await fs.rm(rootDirectory, { recursive: true, force: true });
  }
}

test("serves the editor root and the example project", async () => {
  await withServer(async ({ baseUrl }) => {
    const editor = await fetch(baseUrl);
    const appModule = await fetch(`${baseUrl}/app.mjs`);
    const imageCaptureLibrary = await fetch(`${baseUrl}/vendor/html-to-image.js`);
    const html2canvasLibrary = await fetch(`${baseUrl}/vendor/html2canvas/html2canvas.min.js`);
    const stylesheet = await fetch(`${baseUrl}/styles.css`);
    const yamlModule = await fetch(`${baseUrl}/shared/yaml.mjs`);
    const yamlBrowserEntry = await fetch(`${baseUrl}/vendor/yaml/browser/index.js`);
    const yamlBrowserCore = await fetch(`${baseUrl}/vendor/yaml/browser/dist/index.js`);
    const validationModule = await fetch(`${baseUrl}/shared/validation.js`);
    const screenLayersModule = await fetch(`${baseUrl}/shared/ScreenLayers.mjs`);
    const screenGroupsModule = await fetch(`${baseUrl}/shared/ScreenGroups.mjs`);
    const editorEventControllerModule = await fetch(`${baseUrl}/browser/EditorEventController.mjs`);
    const browserModule = await fetch(`${baseUrl}/browser/BrowserHistory.mjs`);
    const editorNavigationModule = await fetch(`${baseUrl}/browser/EditorNavigation.mjs`);
    const inspectorRendererModule = await fetch(`${baseUrl}/browser/InspectorRenderer.mjs`);
    const materialFileEditorModule = await fetch(`${baseUrl}/browser/MaterialFileEditor.mjs`);
    const projectRepositoryModule = await fetch(`${baseUrl}/browser/ProjectRepository.mjs`);
    const projectFileNavigatorModule = await fetch(`${baseUrl}/browser/ProjectFileNavigator.mjs`);
    const projectFileTreeModule = await fetch(`${baseUrl}/browser/ProjectFileTree.mjs`);
    const projectPersistenceModule = await fetch(`${baseUrl}/browser/ProjectPersistence.mjs`);
    const resizablePanelsModule = await fetch(`${baseUrl}/browser/ResizablePanels.mjs`);
    const previewStateControllerModule = await fetch(`${baseUrl}/browser/PreviewStateController.mjs`);
    const responsiveToolbarControllerModule = await fetch(`${baseUrl}/browser/ResponsiveToolbarController.mjs`);
    const screenAnnotationControllerModule = await fetch(`${baseUrl}/browser/ScreenAnnotationController.mjs`);
    const screenSelectionControllerModule = await fetch(`${baseUrl}/browser/ScreenSelectionController.mjs`);
    const screenRulerControllerModule = await fetch(`${baseUrl}/browser/ScreenRulerController.mjs`);
    const screenYamlEditorModule = await fetch(`${baseUrl}/browser/ScreenYamlEditor.mjs`);
    const retiredAssetEditorModule = await fetch(`${baseUrl}/browser/AssetEditor.mjs`);
    const screenControllerModule = await fetch(`${baseUrl}/browser/ScreenController.mjs`);
    const specEditorModule = await fetch(`${baseUrl}/browser/SpecEditor.mjs`);
    const splitViewLayoutModule = await fetch(`${baseUrl}/browser/SplitViewLayout.mjs`);
    const themeEditorModule = await fetch(`${baseUrl}/browser/ThemeEditor.mjs`);
    const workflowEditorModule = await fetch(`${baseUrl}/browser/WorkflowEditor.mjs`);
    const mermaidModule = await fetch(`${baseUrl}/vendor/mermaid/mermaid.esm.min.mjs`);
    const workspaceViewRendererModule = await fetch(`${baseUrl}/browser/WorkspaceViewRenderer.mjs`);
    const templateMarkupRendererModule = await fetch(`${baseUrl}/browser/TemplateMarkupRenderer.mjs`);
    const materialCanvasModule = await fetch(`${baseUrl}/browser/MaterialCanvas.mjs`);
    const screenMaterialControllerModule = await fetch(`${baseUrl}/browser/ScreenMaterialController.mjs`);
    const screenMaterialRendererModule = await fetch(`${baseUrl}/browser/ScreenMaterialRenderer.mjs`);
    const materialDefaultsModule = await fetch(`${baseUrl}/browser/MaterialDefaults.mjs`);
    const project = await fetch(`${baseUrl}/specux/project.yml`);
    const encodedResource = await fetch(`${baseUrl}/specux/materials/preview%20image.png`);
    const material = await fetch(`${baseUrl}/specux/materials/demo.stml`);
    const traversal = await fetch(`${baseUrl}/specux/%2e%2e%2findex.html`);
    assert.equal(editor.status, 200);
    const editorHtml = await editor.text();
    assert.match(editorHtml, /Editor/);
    assert.match(readFileSync(editorHtmlPath, "utf8"), /"yaml": "\/vendor\/yaml\/browser\/index\.js"/);
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(yamlBrowserEntry.status, 200);
    assert.equal(yamlBrowserEntry.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.match(await yamlBrowserEntry.text(), /from '\.\/dist\/index\.js'/);
    assert.equal(yamlBrowserCore.status, 200);
    assert.equal(yamlBrowserCore.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(yamlModule.status, 200);
    assert.match(await yamlModule.text(), /from "yaml"/);
    assert.equal(validationModule.status, 200);
    assert.equal(screenLayersModule.status, 200);
    assert.equal(screenGroupsModule.status, 200);
    assert.equal(appModule.status, 200);
    assert.equal(appModule.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.match(
      readFileSync(path.join(__dirname, "..", "frontend", "app.mjs"), "utf8"),
      /foreignObjectRendering:\s*true/
    );
    assert.match(
      readFileSync(path.join(__dirname, "..", "frontend", "app.mjs"), "utf8"),
      /element\.scrollTop = 0/
    );
    assert.equal(imageCaptureLibrary.status, 404);
    assert.equal(html2canvasLibrary.status, 200);
    assert.equal(html2canvasLibrary.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.match(readFileSync(editorHtmlPath, "utf8"), /\/vendor\/html2canvas\/html2canvas\.min\.js/);
    assert.equal(retiredAssetEditorModule.status, 404);
    assert.equal(editorEventControllerModule.status, 200);
    assert.equal(browserModule.status, 200);
    assert.equal(editorNavigationModule.status, 200);
    assert.equal(inspectorRendererModule.status, 200);
    assert.equal(materialFileEditorModule.status, 200);
    assert.equal(browserModule.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(projectRepositoryModule.status, 200);
    assert.equal(projectFileNavigatorModule.status, 200);
    assert.equal(projectFileTreeModule.status, 200);
    assert.equal(projectPersistenceModule.status, 200);
    assert.equal(resizablePanelsModule.status, 200);
    assert.equal(previewStateControllerModule.status, 200);
    assert.equal(responsiveToolbarControllerModule.status, 200);
    assert.equal(screenAnnotationControllerModule.status, 200);
    assert.equal(screenSelectionControllerModule.status, 200);
    assert.equal(screenRulerControllerModule.status, 200);
    assert.equal(screenYamlEditorModule.status, 200);
    assert.equal(screenControllerModule.status, 200);
    assert.equal(specEditorModule.status, 200);
    assert.equal(splitViewLayoutModule.status, 200);
    assert.equal(themeEditorModule.status, 200);
    assert.equal(workflowEditorModule.status, 200);
    const specIcon = await fetch(`${baseUrl}/icons/spec-icon.svg`);
    assert.equal(specIcon.status, 200);
    assert.match(specIcon.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await specIcon.text(), /<svg/);
    assert.equal(mermaidModule.status, 200);
    assert.match(mermaidModule.headers.get("content-type"), /text\/javascript/);
    assert.equal(workspaceViewRendererModule.status, 200);
    assert.equal(templateMarkupRendererModule.status, 200);
    assert.equal(materialCanvasModule.status, 200);
    assert.equal(screenMaterialControllerModule.status, 200);
    assert.equal(screenMaterialRendererModule.status, 200);
    assert.equal(materialDefaultsModule.status, 200);
    assert.equal(project.status, 200);
    assert.deepEqual(YAML.parse(await project.text()), { name: "Example" });
    assert.equal(encodedResource.status, 200);
    assert.equal(encodedResource.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await encodedResource.arrayBuffer()), Buffer.from("image"));
    assert.equal(material.status, 200);
    assert.equal(material.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await material.text(), /^---\n/);
    assert.equal(traversal.status, 404);
  });
});

test("lists project files without exposing hidden paths", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    await fs.mkdir(path.join(rootDirectory, "specux", "screens", "home", "specs"), { recursive: true });
    await fs.writeFile(path.join(rootDirectory, "specux", "screens", "home", "screen.yml"), "name: Home\n");
    await fs.writeFile(path.join(rootDirectory, "specux", ".private.yml"), "secret: true\n");

    const response = await fetch(`${baseUrl}/api/files`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).files, [
      "materials/demo.stml",
      "materials/preview image.png",
      "project.yml",
      "screen.yml",
      "screens/home/screen.yml"
    ]);
  });
});

test("returns project validation errors with source locations", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/validation`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.every((error) => /line \d+, column \d+/.test(error)));
  });
});

test("reports server status and editor state and notifies connected browsers", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const status = await fetch(`${baseUrl}/api/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      status: "ok",
      url: baseUrl + "/",
      connectedBrowsers: 0,
      selectionAvailable: false
    });

    const selection = {
      view: "screen",
      screen: { id: "home", name: "Home", file: "screens/home/screen.yml" },
      selectedPlacement: {
        id: "continue-button",
        name: "Continue",
        instancePath: [0]
      }
    };
    const selected = ["continue-button", "cancel-button"];
    const editorPath = "/?file=screens/home/screen.yml&view=screen&screen=home";
    const file = "screens/home/screen.yml";
    const type = "screen";
    const name = "Home";
    const preview = "specux://screen/home/screen.yml";
    const published = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: editorPath, file, type, name, preview, selection, selected })
    });
    assert.equal(published.status, 200);
    const currentState = await fetch(`${baseUrl}/api/state`);
    const state = await currentState.json();
    assert.deepEqual(state, {
      path: editorPath,
      file,
      type,
      name,
      preview,
      selected,
      annotated: false,
    });

    const cliState = await execFileAsync(process.execPath, [
      cliPath, "server", "state", "--port", new URL(baseUrl).port
    ], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(cliState.stdout), state);

    const workflowSelection = {
      view: "workflow",
      screen: selection.screen,
      workflow: { file: "screens/home/workflows/add-item.mmd" }
    };
    const workflowStateUpdate = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/?file=screens%2Fhome%2Fworkflows%2Fadd-item.mmd&view=workflow&screen=home",
        file: "screens/home/workflows/add-item.mmd",
        type: "workflow",
        name: "add-item",
        preview: "specux://screen/home/workflows/add-item.mmd?node=saveItem",
        selection: workflowSelection,
        selected: ["saveItem"]
      })
    });
    assert.equal(workflowStateUpdate.status, 200);
    const workflowStateResponse = await fetch(`${baseUrl}/api/state`);
    const workflowState = await workflowStateResponse.json();
    assert.deepEqual(workflowState, {
      path: "/?file=screens%2Fhome%2Fworkflows%2Fadd-item.mmd&view=workflow&screen=home",
      file: "screens/home/workflows/add-item.mmd",
      type: "workflow",
      name: "add-item",
      preview: "specux://screen/home/workflows/add-item.mmd?node=saveItem",
      selected: ["saveItem"],
      annotated: false
    });

    const selectedText = {
      type: "text",
      text: "The user can save the dialog.",
      range: {
        start: { line: 18, column: 5 },
        end: { line: 18, column: 34 }
      }
    };
    const specSelectionUpdate = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/?file=screens%2Fhome%2Fspecs%2Felement-dialog-save.md&view=spec&screen=home",
        file: "screens/home/specs/element-dialog-save.md",
        type: "spec",
        name: "element-dialog-save",
        preview: "specux://screen/home/screen.yml?placement=dialog-save&state=add-item-open",
        selection: { view: "spec", screen: selection.screen },
        selected: [selectedText]
      })
    });
    assert.equal(specSelectionUpdate.status, 200);
    const specStateResponse = await fetch(`${baseUrl}/api/state`);
    const specState = await specStateResponse.json();
    assert.deepEqual(specState.selected, [selectedText]);

    const annotationContext = {
      key: "spec:screens/home/specs/element-dialog-save.md:markdown",
      view: "spec",
      type: "spec",
      file: "screens/home/specs/element-dialog-save.md",
      mode: "markdown",
      coordinateSpace: "editor viewport pixels",
      canvasSize: { width: 900, height: 700 }
    };
    const transientAnnotations = [{
      id: "note-1",
      tool: "note",
      points: [{ x: 240, y: 180 }],
      text: "Clarify this paragraph"
    }];
    const annotationsPublished = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selection: { view: "spec", screen: selection.screen },
        annotationContext,
        annotations: transientAnnotations
      })
    });
    assert.equal(annotationsPublished.status, 200);
    const annotationStateResponse = await fetch(`${baseUrl}/api/state`);
    const annotationState = await annotationStateResponse.json();
    assert.deepEqual(annotationState.annotationContext, annotationContext);
    assert.deepEqual(annotationState.annotations, transientAnnotations);
    assert.equal(annotationState.annotated, true);
    assert.equal(
      await readBrowserAnnotationCache(path.join(rootDirectory, "specux")),
      null
    );
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "specux", "materials", "demo.stml"), "utf8"),
      materialDocument({ id: "demo", name: "Demo", type: "label" }, "<p>Before</p>")
    );

    const rejectedAnnotation = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selection: { view: "spec" },
        annotationContext,
        annotations: [{
          id: "outside",
          tool: "pen",
          points: [{ x: 901, y: 20 }]
        }]
      })
    });
    assert.equal(rejectedAnnotation.status, 400);
    const annotationContextCleared = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: { view: "screen", screen: { id: "home" } } })
    });
    assert.equal(annotationContextCleared.status, 200);
    const clearedAnnotationState = await fetch(`${baseUrl}/api/state`).then((response) =>
      response.json()
    );
    assert.equal(Object.hasOwn(clearedAnnotationState, "annotationContext"), false);
    assert.equal(clearedAnnotationState.annotated, false);

    const controller = new AbortController();
    const events = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /connected/);
    const connectedStatus = await fetch(`${baseUrl}/api/status`);
    assert.equal((await connectedStatus.json()).connectedBrowsers, 1);

    const update = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.deepEqual(await update.json(), { notifiedBrowsers: 1 });
    assert.match(decoder.decode((await reader.read()).value), /event: project-updated/);
    await reader.cancel();
    controller.abort();

    const rejected = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid"
      },
      body: "{}"
    });
    assert.equal(rejected.status, 403);
  });
});

test("captures the active editor image and returns its annotation context to the CLI", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const clientId = "11111111-1111-4111-8111-111111111111";
    const annotationContext = {
      key: "spec:screens/home/specs/overview.md:markdown",
      view: "spec",
      type: "spec",
      file: "screens/home/specs/overview.md",
      mode: "markdown",
      coordinateSpace: "editor viewport pixels",
      canvasSize: { width: 900, height: 700 }
    };
    const annotations = [{
      id: "note-1",
      tool: "note",
      points: [{ x: 240, y: 180 }],
      text: "Clarify this paragraph"
    }];
    const screenAnnotationSet = {
      screenId: "home",
      annotations: [{
        id: "screen-note",
        tool: "note",
        points: [{ x: 200, y: 300 }],
        text: "Check this preview"
      }],
      coordinateSpace: "screen canvas pixels",
      canvasSize: { width: 1440, height: 900 },
      previewStateId: "default"
    };
    const selection = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/?file=screens%2Fhome%2Fspecs%2Foverview.md&view=spec&screen=home",
        file: "screens/home/specs/overview.md",
        type: "spec",
        name: "overview",
        clientId,
        selection: { view: "spec", screen: { id: "home" } },
        annotationContext,
        annotations
      })
    });
    assert.equal(selection.status, 200);
    const screenAnnotationsSaved = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(screenAnnotationSet)
    });
    assert.equal(screenAnnotationsSaved.status, 200);

    const controller = new AbortController();
    const events = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /connected/);

    const outputPath = path.join(rootDirectory, "agent-image.png");
    const cliPort = new URL(baseUrl).port;
    const cliCapture = execFileAsync(process.execPath, [
      cliPath,
      "server",
      "screenshot",
      "--port",
      cliPort,
      "--output",
      outputPath
    ], { encoding: "utf8" });
    let eventText = "";
    while (!eventText.includes("event: capture-editor-image")) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      eventText += decoder.decode(value);
    }
    const requestData = JSON.parse(/data: (.+)/.exec(eventText)[1]);
    assert.equal(requestData.clientId, clientId);

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const uploaded = await fetch(
      `${baseUrl}/api/editor-image?requestId=${encodeURIComponent(requestData.requestId)}` +
        `&clientId=${encodeURIComponent(clientId)}`,
      { method: "POST", headers: { "Content-Type": "image/png" }, body: png }
    );
    assert.equal(uploaded.status, 202);

    const cliResult = await cliCapture;
    const metadata = JSON.parse(cliResult.stdout);
    assert.equal(metadata.output, outputPath);
    assert.equal(metadata.file, "screens/home/specs/overview.md");
    assert.deepEqual(metadata.annotationContext, annotationContext);
    assert.deepEqual(metadata.annotations, annotations);
    assert.deepEqual(metadata.screenAnnotations.annotations, screenAnnotationSet.annotations);
    assert.deepEqual(await fs.readFile(outputPath), png);

    await reader.cancel();
    controller.abort();
  });
});

test("serves absolute canvas annotations to the CLI and clears them by Screen", async () => {
  await withServer(async ({ baseUrl }) => {
    const port = new URL(baseUrl).port;
    const selection = {
      view: "screen",
      screen: { id: "home", name: "Home", file: "screens/home/screen.yml" }
    };
    await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/?file=screens%2Fhome%2Fscreen.yml&view=screen&screen=home",
        file: "screens/home/screen.yml",
        type: "screen",
        name: "Home",
        preview: "specux://screen/home/screen.yml",
        selection
      })
    });
    const annotation = {
      id: "mark-1",
      tool: "circle",
      points: [{ x: 200, y: 300 }, { x: 400, y: 500 }],
      target: {
        instancePath: [0, "content", 1],
        elementId: "account-summary",
        name: "Account summary",
        materialId: "account-summary",
        materialSrc: "materials/surface.stml",
        text: "Payroll deposit"
      }
    };
    const canvasSize = { width: 1440, height: 900 };
    const annotationSet = {
      screenId: "home",
      annotations: [annotation],
      coordinateSpace: "screen canvas pixels",
      canvasSize,
      previewStateId: "default"
    };
    const saved = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationSet)
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.saved, 1);
    assert.equal(savedBody.cached, true);

    const currentState = await fetch(`${baseUrl}/api/state`);
    assert.deepEqual(await currentState.json(), {
      path: "/?file=screens%2Fhome%2Fscreen.yml&view=screen&screen=home",
      file: "screens/home/screen.yml",
      type: "screen",
      name: "Home",
      preview: "specux://screen/home/screen.yml",
      selected: [],
      screenAnnotations: {
        screenId: "home",
        coordinateSpace: "screen canvas pixels",
        annotations: [annotation],
        canvasSize,
        previewStateId: "default",
        updatedAt: savedBody.updatedAt
      },
      annotated: true,
    });
    const currentAnnotations = await fetch(`${baseUrl}/api/annotations?screenId=home`);
    const annotationDetails = await currentAnnotations.json();
    assert.deepEqual(annotationDetails.annotations, [annotation]);
    assert.deepEqual(annotationDetails.canvasSize, canvasSize);
    assert.equal(annotationDetails.coordinateSpace, "screen canvas pixels");
    assert.equal(annotationDetails.previewStateId, "default");

    const invalid = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenId: "home",
        annotations: [{ ...annotation, points: [{ x: 1441, y: 0 }] }],
        coordinateSpace: "screen canvas pixels",
        canvasSize,
        previewStateId: "default"
      })
    });
    assert.equal(invalid.status, 400);

    const invalidTargetText = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...annotationSet,
        annotations: [{
          ...annotation,
          target: { ...annotation.target, text: "x".repeat(501) }
        }]
      })
    });
    assert.equal(invalidTargetText.status, 400);

    const invalidCanvasSize = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...annotationSet,
        canvasSize: { width: 0, height: 900 }
      })
    });
    assert.equal(invalidCanvasSize.status, 400);

    const cliList = await execFileAsync(process.execPath, [
      cliPath, "server", "annotations", "--port", port
    ], { encoding: "utf8" });
    const cliListBody = JSON.parse(cliList.stdout);
    assert.deepEqual(cliListBody.annotations, [annotation]);
    assert.deepEqual(cliListBody.canvasSize, canvasSize);
    assert.equal(cliListBody.coordinateSpace, "screen canvas pixels");

    const cliClear = await execFileAsync(process.execPath, [
      cliPath, "server", "annotations", "clear", "--port", port
    ], { encoding: "utf8" });
    assert.match(cliClear.stdout, /Cleared annotations for Screen "home"/);

    const afterClear = await fetch(`${baseUrl}/api/annotations?screenId=home`);
    assert.deepEqual((await afterClear.json()).annotations, []);
  });
});

test("caches structured annotations and clears them when editor context changes", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const selection = {
      view: "screen",
      screen: { id: "home" },
      previewStateId: "default"
    };
    await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection })
    });
    const annotationSet = {
      screenId: "home",
      coordinateSpace: "screen canvas pixels",
      canvasSize: { width: 1440, height: 900 },
      previewStateId: "default",
      annotations: [{
        id: "note-1",
        tool: "note",
        points: [{ x: 300, y: 250 }],
        text: "Review this Material",
        target: {
          instancePath: [0],
          materialId: "top-bar",
          materialSrc: "materials/surface.stml"
        }
      }]
    };
    const currentSave = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationSet)
    });
    assert.equal((await currentSave.json()).cached, true);
    const projectRoot = path.join(rootDirectory, "specux");
    const cachedAnnotations = await readBrowserAnnotationCache(projectRoot);
    assert.equal(cachedAnnotations.screenId, "home");
    assert.deepEqual(cachedAnnotations.annotations, annotationSet.annotations);
    assert.deepEqual(cachedAnnotations.canvasSize, annotationSet.canvasSize);

    await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: { view: "screen", screen: { id: "sign-in" } } })
    });
    assert.equal(await readBrowserAnnotationCache(projectRoot), null);
    const staleSave = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationSet)
    });
    assert.equal((await staleSave.json()).cached, false);
    assert.equal(await readBrowserAnnotationCache(projectRoot), null);
    const cleared = await fetch(`${baseUrl}/api/annotations`, { method: "DELETE" });
    assert.equal(cleared.status, 200);
    assert.equal(await readBrowserAnnotationCache(projectRoot), null);
    const afterSessionReset = await fetch(`${baseUrl}/api/annotations?screenId=home`);
    assert.deepEqual((await afterSessionReset.json()).annotations, []);
  });
});

test("saves YAML data while retaining unknown project fields", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screen.yml",
          data: { name: "After", editorExtension: { preserved: true } }
        }]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: ["screen.yml"] });
    const saved = YAML.parse(await fs.readFile(path.join(rootDirectory, "specux", "screen.yml"), "utf8"));
    assert.deepEqual(saved, { name: "After", editorExtension: { preserved: true } });
  });
});

test("creates new Screen YAML files and updates the project manifest", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          {
            path: "project.yml",
            data: {
              name: "Example",
              screens: [{ id: "new-screen", file: "screens/new-screen/screen.yml" }]
            }
          },
          {
            path: "screens/new-screen/screen.yml",
            create: true,
            data: {
              name: "New Screen",
              description: "",
              layers: [{ id: "base", name: "Base" }],
              materials: []
            }
          }
        ]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      saved: ["project.yml", "screens/new-screen/screen.yml"]
    });
    assert.deepEqual(
      YAML.parse(await fs.readFile(path.join(rootDirectory, "specux", "project.yml"), "utf8")),
      {
        name: "Example",
        screens: [{ id: "new-screen", file: "screens/new-screen/screen.yml" }]
      }
    );
    assert.deepEqual(
      YAML.parse(await fs.readFile(
        path.join(rootDirectory, "specux", "screens", "new-screen", "screen.yml"),
        "utf8"
      )),
      {
        name: "New Screen",
        description: "",
        layers: [{ id: "base", name: "Base" }],
        materials: []
      }
    );

    const duplicate = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screens/new-screen/screen.yml",
          create: true,
          data: { name: "Overwrite", elements: [] }
        }]
      })
    });
    assert.equal(duplicate.status, 409);

    const rejected = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screens/new-screen/assets/demo.stml",
          create: true,
          content: materialDocument({ id: "demo", name: "Demo", type: "label" }, "<p>Demo</p>")
        }]
      })
    });
    assert.equal(rejected.status, 400);
  });
});

test("creates and validates reusable Material STML files", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const content = materialDocument({
      id: "notice",
      name: "Label",
      type: "label",
      attributes: { text: { type: "string", default: "Notice", overridable: true } }
    }, '<div class="material-visual material-visual-label">${attributes.text}</div>\n');
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "materials/notice.stml",
          create: true,
          content
        }]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: ["materials/notice.stml"] });
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "specux", "materials", "notice.stml"), "utf8"),
      content
    );

    const invalid = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "materials/notice.stml",
          content: materialDocument({
            id: "notice",
            name: "Label",
            type: "label",
            attributes: { text: { type: "string", default: "Notice", overridable: true } }
          }, "<div>One</div><div>Two</div>")
        }]
      })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /one root HTML element/);

    const unsupportedPath = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "screens/home/assets/demo.stml", content }]
      })
    });
    assert.equal(unsupportedPath.status, 400);
  });
});

test("creates and saves project, Screen, and Element behavior specs", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const content = [
      "# Sign-in button",
      "",
      "## Purpose",
      "Describe the sign-in action.",
      "",
      "## Requirements",
      "",
      "### Requirement: Submit the form",
      "The button SHALL submit the sign-in form when activated.",
      "",
      "#### Scenario: User activates the button",
      "- **GIVEN** the form contains valid credentials",
      "- **WHEN** the user activates the button",
      "- **THEN** the sign-in request is submitted.",
      ""
    ].join("\n");
    const updatedContent = content.replace(
      "The sign-in request is submitted.",
      "The sign-in request is sent."
    );
    const create = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "specs/sign-in-button.md",
          create: true,
          content
        }]
      })
    });
    assert.equal(create.status, 200);
    assert.deepEqual(await create.json(), { saved: ["specs/sign-in-button.md"] });
    const specPath = path.join(rootDirectory, "specux", "specs", "sign-in-button.md");
    assert.equal(await fs.readFile(specPath, "utf8"), content);

    const update = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "specs/sign-in-button.md",
          content: updatedContent
        }]
      })
    });
    assert.equal(update.status, 200, await update.text());
    assert.equal(await fs.readFile(specPath, "utf8"), updatedContent);

    const screenSpecPath = "screens/sign-in/specs/element-sign-in-button.md";
    const elementSpecContent =
      `[Sign-in button](specux://screen/sign-in/screen.yml?placement=sign-in-button)\n\n${content}`;
    const screenSpecCreate = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: screenSpecPath, create: true, content: elementSpecContent }]
      })
    });
    assert.equal(screenSpecCreate.status, 200);
    assert.deepEqual(await screenSpecCreate.json(), { saved: [screenSpecPath] });
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "specux", ...screenSpecPath.split("/")), "utf8"),
      elementSpecContent
    );

    const invalidElementHeader = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screens/sign-in/specs/element-wrong-name.md",
          create: true,
          content
        }]
      })
    });
    assert.equal(invalidElementHeader.status, 400);

    const invalidContent = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "specs/invalid.md", create: true, content: "# Unstructured spec\n" }]
      })
    });
    assert.equal(invalidContent.status, 400);
    await assert.rejects(fs.access(path.join(rootDirectory, "specux", "specs", "invalid.md")));

    for (const pathValue of ["notes.md", "specs/nested/sign-in.md", "specs/invalid_name.md"]) {
      const rejected = await fetch(`${baseUrl}/api/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [{ path: pathValue, content: "not allowed" }] })
      });
      assert.equal(rejected.status, 400, pathValue);
    }
  });
});

test("parses, serializes, and saves edited YAML source", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const source = "# retained comment\nname: Edited\nextension:\n  value: true\n";
    const parsedResponse = await fetch(`${baseUrl}/api/yaml/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });

    assert.equal(parsedResponse.status, 200);
    assert.deepEqual(await parsedResponse.json(), {
      data: { name: "Edited", extension: { value: true } }
    });

    const serializedResponse = await fetch(`${baseUrl}/api/yaml/stringify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: "Edited", extension: { value: true } } })
    });
    assert.equal(serializedResponse.status, 200);
    assert.deepEqual(YAML.parse((await serializedResponse.json()).source), {
      name: "Edited",
      extension: { value: true }
    });

    const invalidYamlResponse = await fetch(`${baseUrl}/api/yaml/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "name: [unterminated" })
    });
    assert.equal(invalidYamlResponse.status, 400);
    assert.match((await invalidYamlResponse.json()).error, /Invalid YAML: line \d+, column \d+:/);

    const savedResponse = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "screen.yml", content: source }] })
    });
    assert.equal(savedResponse.status, 200);
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "specux", "screen.yml"), "utf8"),
      source
    );

    const rejectedSave = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "screen.yml", content: "name: [unterminated" }] })
    });
    assert.equal(rejectedSave.status, 400);
  });
});

test("creates and serves Screen-scoped Mermaid workflow files", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const workflowPath = "screens/home/workflows/add-item.mmd";
    const source = [
      "flowchart TD",
      '  home["Screen: home"]',
      '  state["State: add-item-open"]',
      "  home --> state",
      ""
    ].join("\n");
    const create = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: workflowPath, create: true, content: source }]
      })
    });
    assert.equal(create.status, 200, await create.clone().text());
    assert.deepEqual(await create.json(), { saved: [workflowPath] });
    const workflow = await fetch(`${baseUrl}/specux/${workflowPath}`);
    assert.equal(workflow.status, 200);
    assert.match(workflow.headers.get("content-type"), /text\/markdown/);
    assert.equal(await workflow.text(), source);

    const invalidPath = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "screens/home/add-item.mmd", create: true, content: source }]
      })
    });
    assert.equal(invalidPath.status, 400);
    await assert.rejects(fs.access(path.join(rootDirectory, "specux", "screens", "home", "add-item.mmd")));
  });
});

test("rejects save paths outside the example project", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "../outside.yml", data: { name: "No" } }] })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /relative paths inside the specux project/);
  });
});

test("does not serve repository files outside the editor and example project", async () => {
  await withServer(async ({ baseUrl }) => {
    const privateFile = await fetch(`${baseUrl}/doc/editor.md`);
    const vcsData = await fetch(`${baseUrl}/.git/config`);
    assert.equal(privateFile.status, 404);
    assert.equal(vcsData.status, 404);
  });
});
