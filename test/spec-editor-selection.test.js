const assert = require("node:assert/strict");
const test = require("node:test");
const { getSelectedText } = require("../frontend/browser/SpecEditor.mjs");

test("reports exact selected spec text and 1-based multiline source ranges", () => {
  const source = "Alpha\nBeta\nGamma";

  assert.deepEqual(getSelectedText(source, 2, 8), {
    type: "text",
    text: "pha\nBe",
    range: {
      start: { line: 1, column: 3 },
      end: { line: 2, column: 3 }
    }
  });
});

test("does not report an empty or invalid spec text selection", () => {
  assert.equal(getSelectedText("Example", 3, 3), null);
  assert.equal(getSelectedText("Example", -1, 3), null);
  assert.equal(getSelectedText("Example", 3, 20), null);
});
