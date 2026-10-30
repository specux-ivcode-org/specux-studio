const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { inlineProjectResources } = require("../backend/cli");
const {
  clearBrowserAnnotationCache,
  writeBrowserAnnotationCache
} = require("../backend/browserAnnotationCache");
const { SPECUX_VERSION, validateProject } = require("../backend/project");
const validation = require("../shared/validation");

const cliPath = path.join(__dirname, "..", "backend", "cli.js");
const validSpec = [
  "# Call to action",
  "",
  "## Purpose",
  "Describe the behavior of this Element.",
  "",
  "## Requirements",
  "",
  "### Requirement: Continue the flow",
  "The Element SHALL continue the sign-in flow when activated.",
  "",
  "#### Scenario: User activates the Element",
  "- **WHEN** the user activates the Element",
  "- **THEN** the next step is displayed.",
  "- **SHOW** dialog-open",
  ""
].join("\n");
const validElementSpec = `---\nelement-id: continue-button\n---\n\n${validSpec}`;

function assetDocument(data, body) {
  return validation.formatAssetDocument(YAML.stringify(data), body);
}

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "specux-project-test-"));
  const files = {
    "project.yml": YAML.stringify({
      name: "Test project",
      specux: SPECUX_VERSION,
      screens: [{ id: "home", file: "screens/home/screen.yml" }],
      theme: "theme/theme.yml"
    }),
    "screens/home/screen.yml": YAML.stringify({
      name: "Home",
      description: "Test screen",
      layers: [{ id: "base", name: "Base" }],
      "preview-states": [
        { id: "default", name: "Default" },
        { id: "dialog-open", name: "Dialog open", description: "Show the dialog." }
      ],
      materials: [
        {
          id: "brand-mark",
          src: "materials/brand.stml",
          attributes: { text: "Brand" },
          position: { x: 10, y: 10 },
          size: { width: 120, height: 40 },
          rotation: 0,
          layer: "base"
        },
        {
          id: "continue-button",
          src: "materials/continue.stml",
          attributes: { text: "Continue" },
          position: { x: 10, y: 60 },
          size: { width: 160, height: 48 },
          rotation: 0,
          layer: "base",
          visibility: { default: false, "dialog-open": true }
        }
      ]
    }),
    "materials/brand.stml": assetDocument({
      id: "brand",
      name: "Label",
      type: "label",
      attributes: { text: { type: "string", default: "Label", overridable: true } }
    }, '<div class="material-visual material-visual-label">${attributes.text}</div>\n'),
    "materials/continue.stml": assetDocument({
      id: "continue",
      name: "Button",
      type: "button",
      attributes: { text: { type: "string", default: "Button", overridable: true } }
    }, '<div class="material-visual material-visual-button">${attributes.text}</div>\n'),
    "assets/brand.png": Buffer.from("image"),
    "assets/static-page.html": "<main>Static HTML</main>\n",
    "assets/button.stml": assetDocument({
      id: "button",
      name: "Button",
      description: "A button template.",
      attributes: {
        label: { type: "string", default: "Continue", overridable: true }
      }
    }, "<button>${attributes.label}</button>\n"),
    "screens/home/assets/layout.stml": assetDocument({
      id: "layout",
      name: "Layout",
      description: "A layout with a content slot.",
      slots: [{ id: "content", name: "Content" }]
    }, "<main><div data-specux-slot=\"content\"></div></main>\n"),
    "screens/home/assets/unused.stml": assetDocument({
      id: "unused",
      name: "Unused",
      description: "Unused template asset."
    }, "<div>Unused</div>\n"),
    "screens/home/assets/images/chart.png": Buffer.from("chart"),
    "theme/theme.yml": YAML.stringify({
      name: "Test theme",
      styles: "theme.css",
      colors: { background: "#ffffff" }
    }),
    "theme/theme.css": ":root { color-scheme: light; }\n",
    "screens/home/specs/element-continue-button.md": validElementSpec
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

test("discovers project files and validates native visual materials", async () => {
  const root = await createProject();
  try {
    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.assets.get("assets/button.stml").type, "template");
    assert.equal(result.assets.get("assets/brand.png").type, "image");
    assert.equal(result.assets.get("assets/static-page.html").type, "resource");
    assert.equal(result.assets.get("screens/home/assets/layout.stml").type, "template");
    assert.equal(result.materialFiles.get("materials/brand.stml").data.type, "label");
    assert.equal(result.materialFiles.get("materials/continue.stml").data.type, "button");
    assert.equal(result.usedAssetFiles.has("assets/button.stml"), false);
    assert.equal(result.usedAssetFiles.has("assets/brand.png"), false);
    assert.equal(result.usedAssetFiles.has("screens/home/assets/layout.stml"), false);
    assert.equal(result.usedAssetFiles.has("screens/home/assets/unused.stml"), false);
    assert.equal(result.usedAssetFiles.has("screens/home/assets/images/chart.png"), false);
    assert.deepEqual([...result.referencedSpecPaths], ["screens/home/specs/element-continue-button.md"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects manifest Asset registries and invalid Screen material transforms", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest["asset-templates"] = [];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("asset registries are no longer supported")));

    delete manifest["asset-templates"];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.materials[0].attributes.text = 42;
    screen.materials[0].position.x = "left";
    screen.materials[1].src = "materials/missing.stml";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("position must contain numeric x and y values")));
    assert.ok(result.errors.some((error) =>
      error.includes('Material attribute "text" does not match its declared type')
    ));
    assert.ok(result.errors.some((error) => error.includes("src must reference a discovered Material STML file")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates Screen layers and placement layer references", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.layers = [{ id: "foreground", name: "Foreground" }];
    for (const material of screen.materials) material.layer = "foreground";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    let result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    delete screen.materials[0].layer;
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("layer must reference a layer defined on this Screen")
    ));

    screen.materials[0].layer = "foreground";
    screen.layers.push({ id: "foreground", name: "", visible: "yes" });
    screen.materials[1].layer = "missing";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('Layer id "foreground" is already used')));
    assert.ok(result.errors.some((error) => error.includes("Layer name must be a non-empty string")));
    assert.ok(result.errors.some((error) => error.includes("Layer visible must be a boolean")));
    assert.ok(result.errors.some((error) => error.includes("layer must reference a layer defined")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates recursive Screen placement groups and inherited layers", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    const children = screen.materials.map(({ layer, ...material }) => material);
    screen.materials = [{
      id: "brand-group",
      type: "group",
      layer: "base",
      position: { x: 10, y: 10 },
      size: { width: 240, height: 100 },
      rotation: 0,
      scale: 1,
      children
    }];
    await fs.writeFile(screenPath, YAML.stringify(screen));
    let result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    screen.materials[0].children[0].layer = "base";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("nested placements inherit their layer from the group")
    ));

    delete screen.materials[0].children[0].layer;
    screen.materials[0].scale = { x: 1, y: 2 };
    screen.materials[0].children[0].scale = { x: 2, y: 1 };
    screen.materials[0].children[0].affine = { a: 1, b: 0, c: 0, d: 1 };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    screen.materials[0].children[0].scale = { x: 0, y: 1 };
    screen.materials[0].children[0].affine = { a: 1, b: 0, c: 0, d: 0 };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("scale must be a positive number or positive x/y factors")
    ));
    assert.ok(result.errors.some((error) =>
      error.includes("affine must contain a non-singular a/b/c/d matrix")
    ));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates reusable Material front matter and single-root markup", async () => {
  const root = await createProject();
  try {
    const materialPath = path.join(root, "materials", "brand.stml");
    await fs.writeFile(materialPath, assetDocument({
      id: "brand",
      name: "Brand",
      type: "image"
    }, "<div>Brand</div>\n"));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("type must be one of: label, button, surface, avatar, navigation-item, text-field, progress, divider, checkbox")
    ));

    await fs.writeFile(materialPath, assetDocument({
      id: "brand",
      name: "Brand",
      type: "surface"
    }, "<div>One</div><div>Two</div>\n"));
    result = await validateProject(root);
    assert.ok(!result.errors.some((error) => error.includes("front matter type must be one of:")));
    assert.ok(result.errors.some((error) => error.includes("one root HTML element")));

    await fs.writeFile(materialPath, assetDocument({
      id: "brand",
      name: "Brand",
      type: "label"
    }, "<div>${attributes.unknown}</div>\n"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('references undeclared attribute "unknown"')));

    await fs.writeFile(materialPath, assetDocument({
      id: "brand",
      name: "Brand",
      type: "button"
    }, "<button>Not an interactive control</button>\n"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("interactive controls")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects the obsolete Screen elements property", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.elements = [{ id: "page-title",     type: "label", content: "Welcome" }];
    await fs.writeFile(screenPath, YAML.stringify(screen));
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("Screen elements are no longer supported")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates template front matter, filename IDs, resources, and slot declarations", async () => {
  const root = await createProject();
  try {
    const templatePath = path.join(root, "assets", "button.stml");
    await fs.writeFile(templatePath, "<button>Missing front matter</button>");
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("must begin with a YAML front matter block")));

    await fs.writeFile(templatePath, assetDocument({
      id: "wrong-id",
      name: "Button",
      description: "A button template."
    }, "<button>Button</button>"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("front matter id must match filename \"button\"")));

    const layoutPath = path.join(root, "screens", "home", "assets", "layout.stml");
    await fs.writeFile(layoutPath, assetDocument({
      id: "layout",
      name: "Layout",
      description: "A layout.",
      slots: [{ id: "content" }]
    }, "<main><div data-specux-slot=\"unknown\"></div></main>"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('must contain exactly one element with data-specux-slot="content"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("discovers image Assets recursively while requiring STML templates at the assets root", async () => {
  const root = await createProject();
  try {
    const nestedTemplate = path.join(root, "assets", "nested", "card.stml");
    await fs.mkdir(path.dirname(nestedTemplate), { recursive: true });
    await fs.writeFile(nestedTemplate, assetDocument({
      id: "card",
      name: "Card",
      description: "Nested template."
    }, "<article>Card</article>"));
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("STML template files must be directly inside an assets directory")));
    assert.equal(result.assets.get("screens/home/assets/images/chart.png").type, "image");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates Element spec front matter and direct specs directory paths", async () => {
  assert.equal(validation.validateElementSpecHeader(validElementSpec), "continue-button");
  assert.doesNotThrow(() =>
    validation.validateElementSpecPath("screens/home/specs/element-continue-button.md", "continue-button")
  );
  assert.throws(
    () => validation.validateElementSpecPath("screens/home/specs/elements/continue-button.md", "continue-button"),
    /Behavior spec path must be/
  );
  assert.throws(
    () => validation.validateElementSpecHeader("---\nasset-id: continue-button\n---\n"),
    /element-id/
  );
});

test("CLI init creates reusable STML Materials and Screen placements", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "specux-init-test-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "init", "--project", parent], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = YAML.parse(await fs.readFile(path.join(parent, "specux", "project.yml"), "utf8"));
    const screen = YAML.parse(await fs.readFile(
      path.join(parent, "specux", "screens", "home", "screen.yml"),
      "utf8"
    ));
    assert.equal(Object.hasOwn(manifest, "asset-templates"), false);
    assert.equal(screen.materials[0].src, "materials/label.stml");
    assert.deepEqual(screen.materials[0].attributes, { text: "Welcome to SpecUX" });
    assert.equal(screen.materials[1].src, "materials/button.stml");
    assert.deepEqual(screen.materials[1].attributes, { text: "Get started" });
    const label = await fs.readFile(
      path.join(parent, "specux", "materials", "label.stml"),
      "utf8"
    );
    assert.match(label, /type: label/);
    assert.match(label, /attributes:/);
    assert.match(label, /\$\{attributes\.text\}/);
    const validationResult = await validateProject(path.join(parent, "specux"));
    assert.deepEqual(validationResult.errors, []);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("CLI renders structured annotations without a running editor server", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "specux-annotation-cli-test-"));
  const projectRoot = path.join(parent, "specux");
  try {
    const initialized = spawnSync(process.execPath, [cliPath, "init", "--project", parent], {
      encoding: "utf8"
    });
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
    await writeBrowserAnnotationCache(projectRoot, {
      screenId: "home",
      previewStateId: "default",
      coordinateSpace: "screen canvas pixels",
      canvasSize: { width: 1440, height: 900 },
      annotations: [{
        id: "mark-1",
        tool: "circle",
        points: [{ x: 120, y: 120 }, { x: 360, y: 300 }],
        target: { instancePath: [0], materialId: "welcome" }
      }]
    });
    const outputPath = path.join(parent, "home-annotated.png");
    const rendered = spawnSync(process.execPath, [
      cliPath,
      "render",
      "home",
      "--format",
      "image",
      "--annotations",
      "--project",
      projectRoot,
      "--output",
      outputPath
    ], { encoding: "utf8" });

    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
    const png = await fs.readFile(outputPath);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.match(rendered.stdout, /Rendered Screen "home" to/);
  } finally {
    await clearBrowserAnnotationCache(projectRoot);
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("CLI prune reports discovered unreferenced Assets and removes only files on apply", async () => {
  const root = await createProject();
  try {
    const dryRun = spawnSync(process.execPath, [cliPath, "prune", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /template unused \(screens\/home\/assets\/unused\.stml\)/);
    assert.match(dryRun.stdout, /image chart\.png \(screens\/home\/assets\/images\/chart\.png\)/);
    await fs.access(path.join(root, "screens", "home", "assets", "unused.stml"));

    const originalManifest = await fs.readFile(path.join(root, "project.yml"), "utf8");
    const applied = spawnSync(process.execPath, [cliPath, "prune", "--apply", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(applied.status, 0, applied.stderr || applied.stdout);
    await assert.rejects(fs.access(path.join(root, "screens", "home", "assets", "unused.stml")));
    await assert.rejects(fs.access(path.join(root, "screens", "home", "assets", "images", "chart.png")));
    assert.equal(await fs.readFile(path.join(root, "project.yml"), "utf8"), originalManifest);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("inlines local resources referenced by rendered Screen output", async () => {
  const root = await createProject();
  try {
    const html = await inlineProjectResources(
      '<img src="http://127.0.0.1:3000/specux/assets/brand.png"><img src="http://127.0.0.1:3000/specux/screens/home/assets/images/chart.png">',
      "http://127.0.0.1:3000",
      root
    );
    assert.match(html, /data:image\/png;base64,/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
