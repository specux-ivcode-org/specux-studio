const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const parseSpecuxYaml = require("../shared/yaml");

test("parses empty flow mappings and sequences", () => {
  assert.deepEqual(parseSpecuxYaml([
    "assets:",
    "  - attributes: {}",
    "    slots: {}",
    "empty-list: []"
  ].join("\n")), {
    assets: [{ attributes: {}, slots: {} }],
    "empty-list": []
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

test("parses light and dark theme color modes", () => {
  assert.deepEqual(parseSpecuxYaml([
    "modes:",
    "  light:",
    "    colors:",
    '      background: "#ffffff"',
    "  dark:",
    "    colors:",
    '      background: "#101827"'
  ].join("\n")), {
    modes: {
      light: { colors: { background: "#ffffff" } },
      dark: { colors: { background: "#101827" } }
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

test("parses native Material transforms in the example Screens", () => {
  for (const screenId of ["home", "sign-in"]) {
    const filePath = path.join(__dirname, "..", "specux", "screens", screenId, "screen.yml");
    const screen = parseSpecuxYaml(readFileSync(filePath, "utf8"));
    assert.ok(Array.isArray(screen.materials), `${screenId} Screen should define Materials.`);
    for (const material of screen.materials) {
      assert.equal(typeof material.position.x, "number");
      assert.equal(typeof material.position.y, "number");
      assert.equal(typeof material.size.width, "number");
      assert.equal(typeof material.size.height, "number");
    }
  }
});
