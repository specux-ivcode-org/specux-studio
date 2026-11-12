const assert = require("node:assert/strict");
const test = require("node:test");
const {
  countScreenPlacementReferences,
  createScreenPlacementUrl,
  rewriteScreenPlacementReferences
} = require(
  "../frontend/browser/PlacementReferenceUpdater.mjs"
);

/** Builds canonical SpecUX URLs for root and nested placements. */
test("creates placement URLs with nested IDs and optional state context", () => {
  const placements = [{
    id: "dialog",
    type: "group",
    children: [{ id: "save" }]
  }];
  assert.equal(
    createScreenPlacementUrl("home", placements, [0, 0]),
    "specux://screen/home/screen.yml?placement=dialog.save"
  );
  assert.equal(
    createScreenPlacementUrl("home", placements, [0, 0], "dialog-open"),
    "specux://screen/home/screen.yml?placement=dialog.save&state=dialog-open"
  );
});

/** Counts references to the group itself without treating descendant links as matches. */
test("counts group references separately from descendant references", () => {
  const placements = [{
    id: "dialog",
    type: "group",
    children: [{ id: "save" }]
  }];
  const spec = [
    "[Dialog](specux://screen/home/screen.yml?placement=dialog&state=open)",
    "[Save](specux://screen/home/screen.yml?placement=dialog.save&state=open)",
    "[Other](specux://screen/other/screen.yml?placement=dialog)",
    "```md",
    "[Example](specux://screen/home/screen.yml?placement=dialog)",
    "```"
  ].join("\n");
  assert.equal(
    countScreenPlacementReferences(spec, "spec", "home", placements, "dialog"),
    1
  );
  assert.equal(
    countScreenPlacementReferences(
      'click dialog href "specux://screen/home/screen.yml?placement=dialog"',
      "workflow",
      "home",
      placements,
      "dialog"
    ),
    1
  );
});

/** Rewrites spec and workflow references when a placement gains a group path. */
test("rewrites placement references after grouping while preserving unrelated source", () => {
  const previousPlacements = [{ id: "save" }];
  const nextPlacements = [{
    id: "dialog",
    type: "group",
    children: [{
      id: "actions",
      type: "group",
      children: [{ id: "save" }]
    }]
  }];
  const spec = [
    "[Save](specux://screen/home/screen.yml?placement=save&state=dialog-open)",
    "",
    "```md",
    "[Example](specux://screen/home/screen.yml?placement=save)",
    "```",
    "[Other Screen](specux://screen/other/screen.yml?placement=save)"
  ].join("\n");
  assert.equal(
    rewriteScreenPlacementReferences(
      spec,
      "spec",
      "home",
      previousPlacements,
      nextPlacements
    ),
    [
      "[Save](specux://screen/home/screen.yml?placement=dialog.actions.save&state=dialog-open)",
      "",
      "```md",
      "[Example](specux://screen/home/screen.yml?placement=save)",
      "```",
      "[Other Screen](specux://screen/other/screen.yml?placement=save)"
    ].join("\n")
  );
  assert.equal(
    rewriteScreenPlacementReferences(
      'click save href "specux://screen/home/screen.yml?placement=save"',
      "workflow",
      "home",
      previousPlacements,
      nextPlacements
    ),
    'click save href "specux://screen/home/screen.yml?placement=dialog.actions.save"'
  );
});

/** Ungrouped links retain state context and drop only a removed group's placement. */
test("rewrites child and group references after ungrouping", () => {
  const previousPlacements = [{
    id: "dialog",
    type: "group",
    children: [{ id: "save" }]
  }];
  const nextPlacements = [{ id: "save" }];
  const source = [
    "[Save](specux://screen/home/screen.yml?placement=dialog.save&state=dialog-open)",
    "[Dialog](specux://screen/home/screen.yml?placement=dialog&state=dialog-open)"
  ].join("\n");
  assert.equal(
    rewriteScreenPlacementReferences(
      source,
      "spec",
      "home",
      previousPlacements,
      nextPlacements
    ),
    [
      "[Save](specux://screen/home/screen.yml?placement=save&state=dialog-open)",
      "[Dialog](specux://screen/home/screen.yml?state=dialog-open)"
    ].join("\n")
  );
});
