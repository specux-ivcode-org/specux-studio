const MIN_SIZE = 24;

export function isScreenGroup(instance) {
  return instance?.type === "group";
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

export function getScreenPlacementPathById(placements, id, parentPath = []) {
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const path = [...parentPath, index];
    if (placement.id === id) return path;
    if (isScreenGroup(placement)) {
      const childPath = getScreenPlacementPathById(placement.children, id, path);
      if (childPath) return childPath;
    }
  }
  return null;
}

export function getScreenPlacementBounds(placement) {
  const { x, y } = placement.position;
  const { width, height } = placement.size;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radians = (placement.rotation || 0) * (Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scale = isScreenGroup(placement) ? (placement.scale ?? 1) : 1;
  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 }
  ].map((point) => ({
    x: centerX + scale * (cosine * point.x - sine * point.y),
    y: centerY + scale * (sine * point.x + cosine * point.y)
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
  const selectedSiblingIndexes = new Set(
    sortedPaths.map((path) => path[path.length - 1])
  );
  const siblings = parentPath.length
    ? getScreenPlacementAtPath(placements, parentPath)?.children
    : placements;
  const layerIndexes = (siblings || [])
    .map((placement, index) => ({ placement, index }))
    .filter(({ placement }) =>
      parentPath.length > 0 || placement.layer === layer
    )
    .map(({ index }) => index);
  const selectedPositions = layerIndexes
    .map((siblingIndex, layerIndex) =>
      selectedSiblingIndexes.has(siblingIndex) ? layerIndex : -1
    )
    .filter((layerIndex) => layerIndex >= 0);
  for (let index = 0; index < selectedPositions.length; index += 1) {
    if (selectedPositions[index] !== selectedPositions[0] + index) return false;
  }
  return selectedPositions.length === sortedPaths.length;
}

export function createScreenPlacementGroup(placements, paths, id) {
  if (!canGroupScreenPlacements(placements, paths)) {
    throw new Error("Select at least two consecutive placements from the same layer to group them.");
  }
  const orderedPaths = [...paths].sort((left, right) =>
    left[left.length - 1] - right[right.length - 1]
  );
  const { parentPath, siblings } = getScreenPlacementLocation(placements, orderedPaths[0]);
  const firstIndex = orderedPaths[0][orderedPaths[0].length - 1];
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
  siblings.splice(firstIndex, 0, group);
  return { group, path: [...parentPath, firstIndex] };
}

function transformChildForUngroup(group, child) {
  const pivot = { x: group.size.width / 2, y: group.size.height / 2 };
  const size = child.size;
  const center = {
    x: child.position.x + size.width / 2,
    y: child.position.y + size.height / 2
  };
  const groupScale = group.scale ?? 1;
  const radians = (group.rotation || 0) * (Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localX = (center.x - pivot.x) * groupScale;
  const localY = (center.y - pivot.y) * groupScale;
  const transformedCenter = {
    x: group.position.x + pivot.x + cosine * localX - sine * localY,
    y: group.position.y + pivot.y + sine * localX + cosine * localY
  };
  const scaledSize = isScreenGroup(child)
    ? size
    : { width: size.width * groupScale, height: size.height * groupScale };
  child.position = {
    x: transformedCenter.x - scaledSize.width / 2,
    y: transformedCenter.y - scaledSize.height / 2
  };
  if (!isScreenGroup(child)) child.size = scaledSize;
  child.rotation = (child.rotation || 0) + (group.rotation || 0);
  if (isScreenGroup(child)) child.scale = (child.scale ?? 1) * groupScale;
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
  let scale = 1;
  let rotation = 0;
  for (const index of path.slice(0, -1)) {
    const parent = siblings[index];
    if (!isScreenGroup(parent)) break;
    scale *= parent.scale ?? 1;
    rotation += parent.rotation || 0;
    siblings = parent.children;
  }
  return { scale, rotation };
}

export function getScreenPlacementCount(placements) {
  return placements.reduce((count, placement) =>
    count + 1 + (isScreenGroup(placement) ? getScreenPlacementCount(placement.children) : 0), 0);
}
