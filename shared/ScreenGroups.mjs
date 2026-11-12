const MIN_SIZE = 24;
const IDENTITY_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1 });

export function isScreenGroup(instance) {
  return instance?.type === "group";
}

export function getScaleComponents(scale = 1) {
  if (typeof scale === "number") return { x: scale, y: scale };
  return { x: scale?.x ?? 1, y: scale?.y ?? 1 };
}

export function isValidScale(scale) {
  if (typeof scale === "number") return Number.isFinite(scale) && scale > 0;
  return scale && typeof scale === "object" && !Array.isArray(scale) &&
    Object.keys(scale).every((key) => key === "x" || key === "y") &&
    Number.isFinite(scale.x) && scale.x > 0 &&
    Number.isFinite(scale.y) && scale.y > 0;
}

export function isValidAffineMatrix(matrix) {
  return matrix && typeof matrix === "object" && !Array.isArray(matrix) &&
    ["a", "b", "c", "d"].every((key) => Number.isFinite(matrix[key])) &&
    Object.keys(matrix).every((key) => ["a", "b", "c", "d"].includes(key)) &&
    Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) >= Number.EPSILON;
}

export function serializeScale(scale) {
  return Math.abs(scale.x - scale.y) < 1e-10
    ? (scale.x + scale.y) / 2
    : { x: scale.x, y: scale.y };
}

export function multiplyAffineMatrices(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d
  };
}

export function invertAffineMatrix(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < Number.EPSILON) {
    throw new Error("Cannot invert a singular placement transform.");
  }
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant
  };
}

export function getScreenPlacementMatrix(placement) {
  const radians = (placement.rotation || 0) * (Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scale = getScaleComponents(placement.scale ?? 1);
  const rotationScale = {
    a: cosine * scale.x,
    b: sine * scale.x,
    c: -sine * scale.y,
    d: cosine * scale.y
  };
  return multiplyAffineMatrices(rotationScale, placement.affine || IDENTITY_MATRIX);
}

export function getScreenPlacementAtPath(placements, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let siblings = placements;
  let placement = null;
  for (const index of path) {
    if (!Number.isInteger(index) || !Array.isArray(siblings)) return null;
    placement = siblings[index];
    if (!placement) return null;
    siblings = isScreenGroup(placement) ? placement.children : null;
  }
  return placement;
}

export function getScreenPlacementLocation(placements, path) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new Error("Select a placement before editing it.");
  }
  const parentPath = path.slice(0, -1);
  const siblings = parentPath.length
    ? getScreenPlacementAtPath(placements, parentPath)?.children
    : placements;
  const index = path[path.length - 1];
  if (!Array.isArray(siblings) || !Number.isInteger(index) || index < 0 || index >= siblings.length) {
    throw new Error("The placement is no longer available.");
  }
  return { parentPath, siblings, index, placement: siblings[index] };
}

export function getScreenPlacementLayer(placements, path) {
  const root = getScreenPlacementAtPath(placements, [path?.[0]]);
  return typeof root?.layer === "string" ? root.layer : null;
}

export function getScreenPlacementPathById(placements, id) {
  const segments = typeof id === "string" ? id.split(".") : [];
  if (segments.length > 1) {
    let siblings = placements;
    const path = [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      if (!Array.isArray(siblings)) return null;
      const index = siblings.findIndex((placement) => placement.id === segments[segmentIndex]);
      if (index < 0) return null;
      const placement = siblings[index];
      path.push(index);
      if (segmentIndex < segments.length - 1 && !isScreenGroup(placement)) return null;
      siblings = placement.children;
    }
    return path;
  }
  return findPlacementPathByLeafId(placements, id);
}

function findPlacementPathByLeafId(placements, id, parentPath = []) {
  if (!Array.isArray(placements)) return null;
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const path = [...parentPath, index];
    if (placement.id === id) return path;
    if (isScreenGroup(placement)) {
      const childPath = findPlacementPathByLeafId(placement.children, id, path);
      if (childPath) return childPath;
    }
  }
  return null;
}

export function getScreenPlacementIdPath(placements, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let siblings = placements;
  const ids = [];
  for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
    const index = path[pathIndex];
    if (!Array.isArray(siblings) || !Number.isInteger(index)) return null;
    const placement = siblings[index];
    if (!placement || (pathIndex < path.length - 1 && !isScreenGroup(placement))) return null;
    ids.push(placement.id);
    siblings = placement.children;
  }
  return ids;
}

export function getSelectedGroupAncestorPath(placements, selectedPaths, path) {
  if (!Array.isArray(selectedPaths) || !Array.isArray(path)) return null;
  return selectedPaths.find((selectedPath) =>
    Array.isArray(selectedPath) &&
    selectedPath.length <= path.length &&
    selectedPath.every((part, index) => part === path[index]) &&
    isScreenGroup(getScreenPlacementAtPath(placements, selectedPath))
  ) || null;
}

export function getScreenPlacementBounds(placement) {
  const { x, y } = placement.position;
  const { width, height } = placement.size;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const matrix = getScreenPlacementMatrix(placement);
  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 }
  ].map((point) => ({
    x: centerX + matrix.a * point.x + matrix.c * point.y,
    y: centerY + matrix.b * point.x + matrix.d * point.y
  }));
  const left = Math.min(...corners.map((corner) => corner.x));
  const right = Math.max(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y));
  const bottom = Math.max(...corners.map((corner) => corner.y));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function canGroupScreenPlacements(placements, paths) {
  if (!Array.isArray(paths) || paths.length < 2 ||
      paths.some((path) => !Array.isArray(path) || path.length === 0)) return false;
  const sortedPaths = [...paths].sort((left, right) =>
    left[left.length - 1] - right[right.length - 1]
  );
  const firstPath = sortedPaths[0];
  if (!Array.isArray(firstPath) || firstPath.length === 0) return false;
  const parentPath = firstPath.slice(0, -1);
  const layer = getScreenPlacementLayer(placements, firstPath);
  if (!layer) return false;
  for (const path of sortedPaths) {
    if (path.length !== firstPath.length ||
        !path.slice(0, -1).every((part, partIndex) => part === parentPath[partIndex]) ||
        !getScreenPlacementAtPath(placements, path) ||
        getScreenPlacementLayer(placements, path) !== layer) {
      return false;
    }
  }
  return true;
}

export function createScreenPlacementGroup(placements, paths, id) {
  if (!canGroupScreenPlacements(placements, paths)) {
    throw new Error("Select at least two sibling placements from the same layer to group them.");
  }
  const orderedPaths = [...paths].sort((left, right) =>
    left[left.length - 1] - right[right.length - 1]
  );
  const { parentPath, siblings } = getScreenPlacementLocation(placements, orderedPaths[0]);
  const highestSelectedIndex = orderedPaths[orderedPaths.length - 1].at(-1);
  const groupIndex = highestSelectedIndex - orderedPaths.length + 1;
  const children = orderedPaths.map((path) => getScreenPlacementAtPath(placements, path));
  const bounds = children
    .map(getScreenPlacementBounds)
    .reduce((current, next) => {
      const left = Math.min(current.x, next.x);
      const top = Math.min(current.y, next.y);
      const right = Math.max(current.x + current.width, next.x + next.width);
      const bottom = Math.max(current.y + current.height, next.y + next.height);
      return { x: left, y: top, width: right - left, height: bottom - top };
    });
  const width = Math.max(MIN_SIZE, bounds.width);
  const height = Math.max(MIN_SIZE, bounds.height);
  const groupPosition = {
    x: bounds.x - (width - bounds.width) / 2,
    y: bounds.y - (height - bounds.height) / 2
  };
  const group = {
    id,
    type: "group",
    position: groupPosition,
    size: { width, height },
    rotation: 0,
    scale: 1,
    children
  };
  if (parentPath.length === 0) {
    group.layer = getScreenPlacementLayer(placements, orderedPaths[0]);
  }
  for (const child of children) {
    child.position = {
      x: child.position.x - groupPosition.x,
      y: child.position.y - groupPosition.y
    };
    delete child.layer;
  }
  for (const path of orderedPaths.slice().reverse()) {
    siblings.splice(path[path.length - 1], 1);
  }
  siblings.splice(groupIndex, 0, group);
  return { group, path: [...parentPath, groupIndex] };
}

function transformChildForUngroup(group, child) {
  const pivot = { x: group.size.width / 2, y: group.size.height / 2 };
  const size = child.size;
  const center = {
    x: child.position.x + size.width / 2,
    y: child.position.y + size.height / 2
  };
  const groupMatrix = getScreenPlacementMatrix(group);
  const transformedCenter = {
    x: group.position.x + pivot.x +
      groupMatrix.a * (center.x - pivot.x) + groupMatrix.c * (center.y - pivot.y),
    y: group.position.y + pivot.y +
      groupMatrix.b * (center.x - pivot.x) + groupMatrix.d * (center.y - pivot.y)
  };
  const childMatrix = getScreenPlacementMatrix(child);
  const combinedMatrix = multiplyAffineMatrices(groupMatrix, childMatrix);
  const scaleComponents = getScaleComponents(child.scale ?? 1);
  const radians = (child.rotation || 0) * (Math.PI / 180);
  const childBaseMatrix = {
    a: Math.cos(radians) * scaleComponents.x,
    b: Math.sin(radians) * scaleComponents.x,
    c: -Math.sin(radians) * scaleComponents.y,
    d: Math.cos(radians) * scaleComponents.y
  };
  child.affine = multiplyAffineMatrices(
    invertAffineMatrix(childBaseMatrix),
    combinedMatrix
  );
  if (
    Math.abs(child.affine.a - 1) < 1e-10 &&
    Math.abs(child.affine.b) < 1e-10 &&
    Math.abs(child.affine.c) < 1e-10 &&
    Math.abs(child.affine.d - 1) < 1e-10
  ) delete child.affine;
  child.position = {
    x: transformedCenter.x - size.width / 2,
    y: transformedCenter.y - size.height / 2
  };
}

export function ungroupScreenPlacement(placements, path) {
  const { parentPath, siblings, index, placement } = getScreenPlacementLocation(placements, path);
  if (!isScreenGroup(placement)) throw new Error("Select a group before ungrouping it.");
  const children = placement.children;
  for (const child of children) {
    transformChildForUngroup(placement, child);
    if (parentPath.length === 0) child.layer = placement.layer;
    else delete child.layer;
  }
  siblings.splice(index, 1, ...children);
  return children.map((child, childIndex) => [...parentPath, index + childIndex]);
}

export function getScreenParentTransform(placements, path) {
  let siblings = placements;
  let matrix = IDENTITY_MATRIX;
  for (const index of path.slice(0, -1)) {
    const parent = siblings[index];
    if (!isScreenGroup(parent)) break;
    matrix = multiplyAffineMatrices(matrix, getScreenPlacementMatrix(parent));
    siblings = parent.children;
  }
  return { matrix };
}

export function getScreenPlacementCount(placements) {
  return placements.reduce((count, placement) =>
    count + 1 + (isScreenGroup(placement) ? getScreenPlacementCount(placement.children) : 0), 0);
}
