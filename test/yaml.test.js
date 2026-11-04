const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { before, test } = require("node:test");
let YAML;
let parseSpecuxYaml;
before(async () => {
  YAML = await import("../shared/yaml.mjs");
  parseSpecuxYaml = YAML.parse;
});

function assertParserAgreement(source) {
  const document = YAML.parseDocument(source);
  assert.deepEqual(document.errors, []);
  assert.deepEqual(YAML.parse(source), document.toJS());
  return YAML.parse(source);
}

test("parses empty flow mappings and sequences", () => {
  assert.deepEqual(parseSpecuxYaml([
    "materials:",
    "  - attributes: {}",
    "    position: {}",
    "empty-list: []"
  ].join("\n")), {
    materials: [{ attributes: {}, position: {} }],
    "empty-list": []
  });
});

test("parses inline flow mappings in block sequences", () => {
  const source = [
    "layers:",
    "  - {id: content, name: Content}",
    '  - {id: dialog, name: "Dialog, overlay"}',
    "materials:",
    "  - id: main",
    "    layer: content"
  ].join("\n");
  assert.deepEqual(assertParserAgreement(source), {
    layers: [
      { id: "content", name: "Content" },
      { id: "dialog", name: "Dialog, overlay" }
    ],
    materials: [{ id: "main", layer: "content" }]
  });
});

test("keeps quoted empty flow values as strings", () => {
  assert.deepEqual(parseSpecuxYaml([
    'mapping-text: "{}"',
    "sequence-text: '[]'"
  ].join("\n")), {
    "mapping-text": "{}",
    "sequence-text": "[]"
  });
});

test("parses light and dark theme token modes", () => {
  assert.deepEqual(parseSpecuxYaml([
    "modes:",
    "  light:",
    "    tokens:",
    '      background: "#ffffff"',
    "  dark:",
    "    tokens:",
    '      background: "#101827"'
  ].join("\n")), {
    modes: {
      light: { tokens: { background: "#ffffff" } },
      dark: { tokens: { background: "#101827" } }
    }
  });
});

test("folds indented plain scalar continuations", () => {
  assert.deepEqual(parseSpecuxYaml([
    "description: A multi-line value",
    "  that continues on the next line.",
    "items:",
    "  - first item",
    "    with a continuation."
  ].join("\n")), {
    description: "A multi-line value that continues on the next line.",
    items: ["first item with a continuation."]
  });
});

test("reports line and column for YAML syntax errors", () => {
  const document = YAML.parseDocument("name: [");
  assert.equal(document.errors.length, 1);
  assert.equal(document.errors[0].linePos[0].line, 1);
  assert.equal(document.errors[0].linePos[0].col, 8);
});

test("parses native Material transforms in the example Screens", () => {
  for (const screenId of ["home", "sign-in"]) {
    const filePath = path.join(__dirname, "..", "specux", "screens", screenId, "screen.yml");
    const screen = parseSpecuxYaml(readFileSync(filePath, "utf8"));
    assert.ok(Array.isArray(screen.materials), `${screenId} Screen should define Materials.`);
    assert.ok(screen.layers.some((layer) => layer.id === "base"), `${screenId} Screen should define Base.`);
    for (const material of screen.materials) {
      assert.equal(typeof material.layer, "string", `${material.id} should belong to a layer.`);
      assert.equal(typeof material.position.x, "number");
      assert.equal(typeof material.position.y, "number");
      assert.equal(typeof material.size.width, "number");
      assert.equal(typeof material.size.height, "number");
    }
  }
});
