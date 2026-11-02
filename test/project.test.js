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
const validElementSpec = `[Continue button](specux://screen/home/screen.yml?placement=continue-button&state=dialog-open)\n\n${validSpec}`;

test("example Screen binds presentation attributes to Light and Dark Theme tokens", async () => {
  const projectRoot = path.join(__dirname, "..", "specux");
  const theme = YAML.parse(await fs.readFile(
    path.join(projectRoot, "theme.yml"),
    "utf8"
  ));
  const screen = YAML.parse(await fs.readFile(
    path.join(projectRoot, "screens", "home", "screen.yml"),
    "utf8"
  ));
  const presentationAttributes = new Set([
    "color",
    "background",
    "border",
    "shadow",
    "track",
    "fill",
    "icon-color",
    "icon-background"
  ]);
  const definedTokens = Object.fromEntries(
    Object.entries(theme.modes).map(([mode, definition]) => [
      mode,
      new Set(Object.keys(definition.tokens || {}))
    ])
  );

  assert.deepEqual(Object.keys(definedTokens).sort(), ["dark", "light"]);
  for (const placement of screen.materials) {
    for (const [name, value] of Object.entries(placement.attributes || {})) {
      if (!presentationAttributes.has(name) || ["none", "transparent"].includes(value)) continue;
      assert.equal(typeof value, "string", `${placement.id}.${name} must be a string`);
      const tokens = [...value.matchAll(/var\(--theme-([a-z0-9-]+)/g)].map((match) => match[1]);
      assert.ok(tokens.length > 0, `${placement.id}.${name} must use a Theme token`);
      for (const token of tokens) {
        for (const mode of ["light", "dark"]) {
          assert.ok(definedTokens[mode].has(token), `${mode} Theme must define ${token}`);
        }
      }
    }
  }
});

test("validates the single-file Theme token schema", () => {
  assert.doesNotThrow(() => validation.validateTheme({
    modes: {
      light: { tokens: { surface: "#ffffff" } },
      dark: { tokens: { surface: "#101827" } }
    }
  }, "theme.yml"));
  assert.throws(() => validation.validateTheme({
    name: "Named Theme",
    tokens: { surface: "#ffffff" }
  }, "theme.yml"), /unsupported property "name"/);
  assert.throws(() => validation.validateTheme({
    styles: "theme.css",
    modes: { light: { tokens: { surface: "#ffffff" } } }
  }, "theme.yml"), /unsupported property "styles"/);
});

function materialDocument(data, body) {
  return validation.formatMaterialDocument(YAML.stringify(data), body);
}

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "specux-project-test-"));
  const files = {
    "project.yml": YAML.stringify({
      name: "Test project",
      specux: SPECUX_VERSION,
      screens: [{ id: "home", file: "screens/home/screen.yml" }],
      theme: "theme.yml"
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
    "materials/brand.stml": materialDocument({
      id: "brand",
      name: "Label",
      type: "label",
      attributes: { text: { type: "string", default: "Label", overridable: true } }
    }, '<div class="material-visual material-visual-label">${attributes.text}</div>\n'),
    "materials/continue.stml": materialDocument({
      id: "continue",
      name: "Button",
      type: "button",
      attributes: { text: { type: "string", default: "Button", overridable: true } }
    }, '<div class="material-visual material-visual-button">${attributes.text}</div>\n'),
    "materials/brand.png": Buffer.from("image"),
    "materials/images/chart.png": Buffer.from("chart"),
    "theme.yml": YAML.stringify({
      tokens: { background: "#ffffff" }
    }),
    "screens/home/specs/element-continue-button.md": validElementSpec
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

test("discovers project files and validates native visual Materials", async () => {
  const root = await createProject();
  try {
    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
    assert.equal(Object.hasOwn(result, "assets"), false);
    assert.equal(result.materialFiles.get("materials/brand.stml").data.type, "label");
    assert.equal(result.materialFiles.get("materials/continue.stml").data.type, "button");
    assert.deepEqual([...result.referencedSpecPaths], ["screens/home/specs/element-continue-button.md"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates project manifest fields and required Screen metadata", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.name = 42;
    manifest.extra = true;
    manifest.screens[0].label = "Home";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));

    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    delete screen.description;
    screen.materials[0].size.width = 12;
    await fs.writeFile(screenPath, YAML.stringify(screen));

    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("project.yml: name must be a string.")));
    assert.ok(result.errors.some((error) => error.includes('project.yml: unsupported property "extra".')));
    assert.ok(result.errors.some((error) => error.includes('screens[0] has unsupported property "label".')));
    assert.ok(result.errors.some((error) => error.includes("screens/home/screen.yml: description must be a string.")));
    const sizeError = result.errors.find((error) => error.includes("materials[0]: size must contain"));
    assert.match(sizeError, /\(line \d+, column \d+\)$/);
    const screenSource = await fs.readFile(screenPath, "utf8");
    const expectedLine = screenSource.split(/\r?\n/).findIndex((line) => /^\s+size:/.test(line)) + 1;
    assert.ok(sizeError.endsWith(`(line ${expectedLine}, column 5)`), sizeError);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("points missing project files to their YAML references", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.theme = "missing-theme.yml";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));

    const result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("missing-theme.yml") &&
      /referenced at project\.yml:\d+:\d+/.test(error)
    ));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("prints the Screen workflow schema from the CLI", () => {
  const result = spawnSync(process.execPath, [cliPath, "schema", "workflow"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Screen Workflow File/);
  assert.match(result.stdout, /up\/down selector/);
});

test("does not expose the retired Asset schema or prune command", () => {
  const assetSchema = spawnSync(process.execPath, [cliPath, "schema", "asset"], {
    encoding: "utf8"
  });
  assert.equal(assetSchema.status, 1);
  assert.match(assetSchema.stderr, /Unknown schema type "asset"/);

  const prune = spawnSync(process.execPath, [cliPath, "prune"], {
    encoding: "utf8"
  });
  assert.equal(prune.status, 1);
  assert.match(prune.stderr, /Unknown command "prune"/);
});

test("rejects legacy Asset registries and invalid Screen material transforms", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest["asset-templates"] = [];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('unsupported property "asset-templates"')));

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

test("validates sparse named-state placement and layer overrides", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen["preview-states"][1].layers = { base: { visible: false } };
    screen["preview-states"][1].placements = {
      "continue-button": {
        visible: true,
        attributes: { text: "Continue in dialog" },
        position: { x: 30, y: 80 },
        size: { width: 180, height: 48 },
        rotation: 5,
        scale: { x: 1.1, y: 1 },
        affine: { a: 1, b: 0, c: 0, d: 1 }
      }
    };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    let result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    screen["preview-states"][1].placements.missing = { visible: false };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes('placement "missing" does not reference a placement on this Screen')
    ));

    delete screen["preview-states"][1].placements.missing;
    screen["preview-states"][0].layers = { base: { visible: false } };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("default preview state cannot contain overrides")
    ));
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
  assert.throws(
    () => validation.validateMaterialMarkup('<div style="color:red;z-index:2"></div>', "brand.stml"),
    /cannot set the CSS "z-index" property/
  );
  assert.throws(
    () => validation.validateMaterialMarkup("<style>.brand { Z-INDEX: 2; }</style><div></div>", "brand.stml"),
    /cannot set the CSS "z-index" property/
  );

  const root = await createProject();
  try {
    const materialPath = path.join(root, "materials", "brand.stml");
    await fs.writeFile(materialPath, materialDocument({
      id: "brand",
      name: "Brand",
      type: "image"
    }, "<div>Brand</div>\n"));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("type must be one of: label, button, surface, avatar, navigation-item, text-field, progress, divider, checkbox")
    ));

    await fs.writeFile(materialPath, materialDocument({
      id: "brand",
      name: "Brand",
      type: "surface"
    }, "<div>One</div><div>Two</div>\n"));
    result = await validateProject(root);
    assert.ok(!result.errors.some((error) => error.includes("front matter type must be one of:")));
    const rootMarkupError = result.errors.find((error) => error.includes("one root HTML element"));
    assert.ok(rootMarkupError);
    assert.match(rootMarkupError, /\(line \d+, column \d+\)$/);

    await fs.writeFile(materialPath, materialDocument({
      id: "brand",
      name: "Brand",
      type: "label"
    }, "<div>${attributes.unknown}</div>\n"));
    result = await validateProject(root);
    const undeclaredAttributeError = result.errors.find((error) =>
      error.includes('references undeclared attribute "unknown"')
    );
    assert.ok(undeclaredAttributeError);
    assert.match(undeclaredAttributeError, /\(line \d+, column \d+\)$/);

    await fs.writeFile(materialPath, materialDocument({
      id: "brand",
      name: "Brand",
      type: "button"
    }, "<button>Not an interactive control</button>\n"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("interactive controls")));

    await fs.writeFile(materialPath, materialDocument({
      id: "brand",
      name: "Brand",
      type: "label"
    }, '<img src="missing.png">\n'));
    result = await validateProject(root);
    const missingResourceError = result.errors.find((error) =>
      error.includes('resource "missing.png"')
    );
    assert.ok(missingResourceError);
    assert.match(missingResourceError, /\(line \d+, column \d+\)$/);
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

test("derives Element spec ownership and preview targets from SpecUX links", async () => {
  assert.deepEqual(
    validation.getElementSpecIdentity("screens/home/specs/element-continue-button.md"),
    { screenId: "home", elementId: "continue-button" }
  );
  assert.deepEqual(
    validation.parseSpecScreenReferences(validElementSpec).map((reference) => ({
      screenId: reference.screenId,
      placementId: reference.placementId,
      stateId: reference.stateId
    })),
    [{
      screenId: "home",
      placementId: "continue-button",
      stateId: "dialog-open"
    }]
  );
  assert.doesNotThrow(() =>
    validation.validateElementSpecPath("screens/home/specs/element-continue-button.md", "continue-button")
  );
  assert.throws(
    () => validation.validateElementSpecPath("screens/home/specs/elements/continue-button.md", "continue-button"),
    /Behavior spec path must be/
  );
  const screens = [{
    id: "home",
    data: {
      "preview-states": [{ id: "default" }, { id: "dialog-open" }],
      materials: [{ id: "continue-button" }]
    }
  }];
  assert.throws(() => validation.validateSpecScreenReferences(
    "[Missing state](specux://screen/home/screen.yml?state=unknown)",
    screens
  ), /preview state "unknown" is not available/);
  assert.throws(() => validation.parseSpecScreenReferences(
    "[Bad query](specux://screen/home/screen.yml?state=dialog-open&extra=value)"
  ), /one placement and one state parameter/);
});

test("validates Screen spec references against the loaded project", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.spec = "screens/home/specs/screen.md";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    const specPath = path.join(root, "screens", "home", "specs", "screen.md");
    await fs.writeFile(
      specPath,
      `[Home](specux://screen/home/screen.yml?state=missing)\n\n${validSpec}`
    );

    const result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes('preview state "missing" is not available on Screen "home"')
    ));
    assert.ok(result.errors.some((error) =>
      error.includes('preview state "missing" is not available on Screen "home"') &&
      /\(line 1, column 1\)$/.test(error)
    ));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("points behavior spec content errors to the failing line", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.spec = "screens/home/specs/screen.md";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    const specPath = path.join(root, "screens", "home", "specs", "screen.md");
    const specSource = validSpec.replace(
      "- **WHEN** the user activates the Element",
      "- **GIVEN** the user activates the Element"
    );
    await fs.writeFile(specPath, specSource);

    const result = await validateProject(root);
    const specError = result.errors.find((error) =>
      error.includes('Each scenario must include "- **WHEN** ..." and "- **THEN** ..." steps.')
    );
    assert.ok(specError);
    assert.match(specError, /\(line 11, column 1\)$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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

test("inlines local resources referenced by rendered Screen output", async () => {
  const root = await createProject();
  try {
    const html = await inlineProjectResources(
      '<img src="http://127.0.0.1:3000/specux/materials/brand.png"><img src="http://127.0.0.1:3000/specux/materials/images/chart.png">',
      "http://127.0.0.1:3000",
      root
    );
    assert.match(html, /data:image\/png;base64,/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
