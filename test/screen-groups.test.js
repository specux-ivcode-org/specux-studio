const assert = require("node:assert/strict");
const test = require("node:test");
const validation = require("../shared/validation");

/** Creates a Material placement fixture with the requested geometry and layer. */
function material(id, position, size = { width: 100, height: 40 }, layer = "base") {
  return {
    id,
    src: `materials/${id}.stml`,
    layer,
    position: { ...position },
    size: { ...size },
    rotation: 0
  };
}

/** Checks placement hierarchy, transforms, and saved state after the operation. */
test("groups consecutive same-layer placements and leaves other layers in place", async () => {
  const {
    canGroupScreenPlacements,
    createScreenPlacementGroup
  } = await import("../shared/ScreenGroups.mjs");
  const placements = [
    material("first", { x: 100, y: 100 }),
    material("overlay", { x: 0, y: 0 }, undefined, "overlay"),
    material("second", { x: 250, y: 100 }),
    material("third", { x: 500, y: 100 })
  ];

  assert.equal(canGroupScreenPlacements(placements, [[0], [2]]), true);
  assert.equal(canGroupScreenPlacements(placements, [[0], [3]]), false);
  assert.equal(canGroupScreenPlacements(placements, [[0], [1]]), false);

  const { group, path } = createScreenPlacementGroup(placements, [[2], [0]], "group");
  assert.deepEqual(path, [0]);
  assert.deepEqual(placements.map(({ id }) => id), ["group", "overlay", "third"]);
  assert.equal(group.layer, "base");
  assert.deepEqual(group.position, { x: 100, y: 100 });
  assert.deepEqual(group.size, { width: 250, height: 40 });
  assert.deepEqual(group.children.map(({ id, position, layer }) => ({
    id,
    position,
    layer
  })), [
    { id: "first", position: { x: 0, y: 0 }, layer: undefined },
    { id: "second", position: { x: 150, y: 0 }, layer: undefined }
  ]);
});

/** Checks placement hierarchy, transforms, and saved state after the operation. */
test("ungroup persists transformed placements and restores the layer", async () => {
  const {
    getScreenPlacementMatrix,
    multiplyAffineMatrices,
    ungroupScreenPlacement
  } = await import("../shared/ScreenGroups.mjs");
  const placements = [
    {
      id: "group",
      type: "group",
      layer: "base",
      position: { x: 100, y: 50 },
      size: { width: 250, height: 40 },
      scale: 2,
      rotation: 90,
      children: [
        material("first", { x: 0, y: 0 }),
        material("second", { x: 150, y: 0 })
      ]
    }
  ];

  const expectedMatrix = multiplyAffineMatrices(
    getScreenPlacementMatrix(placements[0]),
    getScreenPlacementMatrix(placements[0].children[0])
  );
  const childPaths = ungroupScreenPlacement(placements, [0]);
  assert.deepEqual(childPaths, [[0], [1]]);
  assert.deepEqual(placements.map(({ id }) => id), ["first", "second"]);
  assert.deepEqual(placements[0].position, { x: 175, y: -100 });
  assert.deepEqual(placements[0].size, { width: 100, height: 40 });
  assert.equal(placements[0].layer, "base");
  assert.ok(placements[0].affine);
  const actualMatrix = getScreenPlacementMatrix(placements[0]);
  for (const key of ["a", "b", "c", "d"]) {
    assert.ok(Math.abs(actualMatrix[key] - expectedMatrix[key]) < 1e-10, key);
  }
});

/** Nested transforms compose for rendering and are converted back to child-local values during ungrouping. */
test("nested group transforms compose and preserve child-local transforms on ungroup", async () => {
  const {
    getScreenParentTransform,
    getScreenPlacementAtPath,
    ungroupScreenPlacement
  } = await import("../shared/ScreenGroups.mjs");
  const nestedChild = material("inside", { x: 4, y: 5 });
  delete nestedChild.layer;
  const placements = [{
    id: "outer",
    type: "group",
    layer: "base",
    position: { x: 10, y: 20 },
    size: { width: 100, height: 100 },
    scale: 2,
    rotation: 0,
    children: [{
      id: "inner",
      type: "group",
      position: { x: 10, y: 10 },
      size: { width: 30, height: 30 },
      scale: 1.5,
      rotation: 15,
      children: [nestedChild]
    }]
  }];

  const parentTransform = getScreenParentTransform(placements, [0, 0, 0]);
  assert.ok(Math.abs(parentTransform.matrix.a - 2.897777478867205) < 1e-10);
  assert.ok(Math.abs(parentTransform.matrix.b - 0.7764571353075622) < 1e-10);
  assert.ok(Math.abs(parentTransform.matrix.c + 0.7764571353075622) < 1e-10);
  assert.ok(Math.abs(parentTransform.matrix.d - 2.897777478867205) < 1e-10);
  ungroupScreenPlacement(placements, [0]);
  assert.deepEqual(placements[0], {
    id: "inner",
    type: "group",
    position: { x: -5, y: 5 },
    size: { width: 30, height: 30 },
    scale: 1.5,
    rotation: 15,
    affine: { a: 2, b: 0, c: 0, d: 2 },
    children: [{
      id: "inside",
      src: "materials/inside.stml",
      position: { x: 4, y: 5 },
      size: { width: 100, height: 40 },
      rotation: 0
    }],
    layer: "base"
  });
  assert.equal(getScreenPlacementAtPath(placements, [0, 0]).id, "inside");
});

/** Checks placement hierarchy, transforms, and saved state after the operation. */
test("ungroup preserves shear from non-uniform group scale and rotated placement", async () => {
  const {
    getScreenPlacementMatrix,
    multiplyAffineMatrices,
    ungroupScreenPlacement
  } = await import("../shared/ScreenGroups.mjs");
  const child = material("rotated", { x: 20, y: 30 }, { width: 80, height: 40 });
  child.rotation = 45;
  const group = {
    id: "outer",
    type: "group",
    layer: "base",
    position: { x: 100, y: 80 },
    size: { width: 200, height: 100 },
    scale: { x: 2, y: 1 },
    children: [child]
  };
  const expectedMatrix = multiplyAffineMatrices(
    getScreenPlacementMatrix(group),
    getScreenPlacementMatrix(child)
  );
  const placements = [group];

  ungroupScreenPlacement(placements, [0]);

  const ungrouped = placements[0];
  const actualMatrix = getScreenPlacementMatrix(ungrouped);
  for (const key of ["a", "b", "c", "d"]) {
    assert.ok(Math.abs(actualMatrix[key] - expectedMatrix[key]) < 1e-10, key);
  }
  assert.deepEqual(ungrouped.size, { width: 80, height: 40 });
  assert.ok(ungrouped.affine);
  assert.deepEqual(ungrouped.position, { x: 80, y: 110 });
});

/** Validation accepts nested groups but rejects child placements that define their own layer. */
test("frontend Screen validation accepts recursive groups and rejects child layer overrides", async () => {
  const { ProjectRepository } = await import("../frontend/browser/ProjectRepository.mjs");
  const repository = new ProjectRepository({
    appRoot: new URL("http://localhost/specux/"),
    validation,
    parseYaml: () => ({}),
    fetcher: async () => ({ ok: true, text: async () => "" }),
    templateFileExtension: ".stml"
  });
  const first = material("first", { x: 0, y: 0 });
  const second = material("second", { x: 100, y: 0 });
  delete first.layer;
  delete second.layer;
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      name: "Home",
      description: "Test Screen",
      layers: [{ id: "base", name: "Base" }],
      materials: [{
        id: "group",
        type: "group",
        layer: "base",
        position: { x: 20, y: 20 },
        size: { width: 200, height: 50 },
        scale: { x: 1.5, y: 2 },
        children: [first, second]
      }]
    }
  };
  first.scale = { x: 2, y: 1 };
  first.affine = { a: 1, b: 0, c: 0, d: 1 };
  const materialFiles = new Map([
    ["materials/first.stml", { data: { attributes: {} } }],
    ["materials/second.stml", { data: { attributes: {} } }]
  ]);
  repository.validateScreenMaterials(screen, materialFiles);

  screen.data.materials[0].children[0].layer = "base";
  assert.throws(
    () => repository.validateScreenMaterials(screen, materialFiles),
    /nested placements inherit their layer from the group/
  );
  delete screen.data.materials[0].children[0].layer;
  screen.data.materials[0].children[0].affine = { a: 1, b: 0, c: 0, d: 0 };
  assert.throws(
    () => repository.validateScreenMaterials(screen, materialFiles),
    /affine must contain a non-singular a\/b\/c\/d matrix/
  );
});

/** Group actions use selected instance paths and update the Screen placement tree. */
test("ScreenMaterialController groups and ungroups selected placement paths", async () => {
  const { ScreenMaterialController } = await import(
    "../frontend/browser/ScreenMaterialController.mjs"
  );
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [{ id: "base", name: "Base" }],
      materials: [
        material("first", { x: 10, y: 20 }),
        material("second", { x: 120, y: 20 })
      ]
    }
  };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [0]
  };
  const controller = new ScreenMaterialController({
    state,
    services: {
      markEdited() {},
      async renderScreen() {},
      selectInstance(path) {
        state.activeInstancePath = path;
      }
    }
  });

  const groupPath = await controller.group([[0], [1]]);
  assert.deepEqual(groupPath, [0]);
  assert.equal(screen.data.materials[0].type, "group");
  assert.equal(screen.data.materials[0].layer, "base");
  assert.deepEqual(state.activeInstancePath, [0]);

  screen.data.materials[0].rotation = 90;
  const childPaths = await controller.ungroup([0]);
  assert.deepEqual(childPaths, [[0], [1]]);
  assert.equal(screen.data.materials[0].layer, "base");
  assert.equal(screen.data.materials[1].layer, "base");
  assert.deepEqual(state.activeInstancePath, [0]);
});

/** Group geometry changes retain named-state transforms and visibility overrides. */
test("grouping and ungrouping preserve named-state transforms and hidden groups", async () => {
  const { PreviewStateController } = await import(
    "../frontend/browser/PreviewStateController.mjs"
  );
  const { ScreenMaterialController } = await import(
    "../frontend/browser/ScreenMaterialController.mjs"
  );
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [{ id: "base", name: "Base" }],
      "preview-states": [
        { id: "default", name: "Default" },
        {
          id: "dialog",
          name: "Dialog",
          description: "Show the dialog.",
          placements: { first: { position: { x: 20, y: 20 } } }
        }
      ],
      materials: [
        material("first", { x: 10, y: 20 }),
        material("second", { x: 120, y: 20 })
      ]
    }
  };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [0],
    activePreviewStateIds: new Map()
  };
  const previewStates = new PreviewStateController({
    state,
    services: { getScreenPreviewStates: validation.getPreviewStates }
  });
  const screenController = new ScreenMaterialController({
    state,
    services: {
      getScreenPreviewStates: validation.getPreviewStates,
      getActivePreviewStateId: () => "default",
      resolvePlacementForState: (...args) => previewStates.resolvePlacement(...args),
      persistStatePlacements: (target, placements, stateId) => {
        placements.forEach((placement) =>
          previewStates.savePlacement(target, placement, stateId)
        );
      },
      isInstanceVisible: (...args) => previewStates.isInstanceVisible(...args),
      setInstanceVisible: (...args) => previewStates.setInstanceVisible(...args),
      removePlacementStateOverrides: (target, placementIds, layerIds) =>
        previewStates.removeStructuralOverrides(target.data, placementIds, layerIds),
      markEdited() {},
      async renderScreen() {},
      selectInstance(path) {
        state.activeInstancePath = path;
      }
    }
  });

  const originalResolved = screen.data.materials.map((placement) =>
    previewStates.resolvePlacement(placement, "dialog", screen.data)
  );
  await screenController.group([[0], [1]]);
  let stateGroup = previewStates.resolvePlacement(
    screen.data.materials[0],
    "dialog",
    screen.data
  );
  assert.equal(stateGroup.position.x + stateGroup.children[0].position.x, originalResolved[0].position.x);
  assert.equal(stateGroup.position.x + stateGroup.children[1].position.x, originalResolved[1].position.x);

  previewStates.setInstanceVisible({ data: screen.data }, screen.data.materials[0], false, "dialog");
  await screenController.ungroup([0]);
  const resolvedChildren = screen.data.materials.map((placement) =>
    previewStates.resolvePlacement(placement, "dialog", screen.data)
  );
  assert.deepEqual(resolvedChildren.map((placement) => placement.visible), [undefined, undefined]);
  assert.deepEqual(resolvedChildren.map((placement) =>
    previewStates.isInstanceVisible(placement, "dialog", screen.data)
  ), [false, false]);
  assert.equal(screen.data["preview-states"][1].placements.group, undefined);
  assert.equal(resolvedChildren[0].position.x, originalResolved[0].position.x);
  assert.equal(resolvedChildren[1].position.x, originalResolved[1].position.x);
});

/** Ungrouping does not hide a group that a named preview state explicitly shows. */
test("ungrouping preserves a named state that shows a hidden Default group", async () => {
  const { PreviewStateController } = await import(
    "../frontend/browser/PreviewStateController.mjs"
  );
  const { ScreenMaterialController } = await import(
    "../frontend/browser/ScreenMaterialController.mjs"
  );
  const screen = {
    file: "screens/home/screen.yml",
    data: {
      layers: [{ id: "base", name: "Base" }],
      "preview-states": [
        { id: "default", name: "Default" },
        {
          id: "dialog",
          name: "Dialog",
          description: "Show the placements."
        }
      ],
      materials: [
        material("first", { x: 10, y: 20 }),
        material("second", { x: 120, y: 20 })
      ]
    }
  };
  const state = {
    screens: [screen],
    activeScreenIndex: 0,
    activeInstancePath: [0],
    activePreviewStateIds: new Map()
  };
  const previewStates = new PreviewStateController({
    state,
    services: { getScreenPreviewStates: validation.getPreviewStates }
  });
  const screenController = new ScreenMaterialController({
    state,
    services: {
      getScreenPreviewStates: validation.getPreviewStates,
      getActivePreviewStateId: () => "default",
      resolvePlacementForState: (...args) => previewStates.resolvePlacement(...args),
      persistStatePlacements: (target, placements, stateId) => {
        placements.forEach((placement) =>
          previewStates.savePlacement(target, placement, stateId)
        );
      },
      isInstanceVisible: (...args) => previewStates.isInstanceVisible(...args),
      setInstanceVisible: (...args) => previewStates.setInstanceVisible(...args),
      removePlacementStateOverrides: (target, placementIds, layerIds) =>
        previewStates.removeStructuralOverrides(target.data, placementIds, layerIds),
      markEdited() {},
      async renderScreen() {},
      selectInstance(path) {
        state.activeInstancePath = path;
      }
    }
  });

  await screenController.group([[0], [1]]);
  screen.data.materials[0].visible = false;
  previewStates.setInstanceVisible(
    screen,
    screen.data.materials[0],
    true,
    "dialog"
  );
  assert.equal(screen.data["preview-states"][1].placements.group.visible, true);

  await screenController.ungroup([0]);
  assert.deepEqual(screen.data.materials.map((placement) =>
    previewStates.isInstanceVisible(placement, "dialog", screen.data)
  ), [true, true]);
});
