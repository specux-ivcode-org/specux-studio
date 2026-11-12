import {
  getScreenPlacementAtPath,
  getScreenPlacementPathById,
  getScreenPlacementIdPath
} from "../../shared/ScreenGroups.mjs";

/** Rewrites Screen placement links after a Screen placement hierarchy changes. */
export function rewriteScreenPlacementReferences(
  source,
  sourceType,
  screenId,
  previousPlacements,
  nextPlacements
) {
  const replacements = getScreenLinkRanges(source, sourceType)
    .map(({ start, end, href }) => ({
      start,
      end,
      href: rewriteScreenPlacementHref(
        href,
        screenId,
        previousPlacements,
        nextPlacements
      )
    }))
    .filter((replacement) => replacement.href !== source.slice(replacement.start, replacement.end))
    .sort((left, right) => right.start - left.start);

  for (const replacement of replacements) {
    source = source.slice(0, replacement.start) +
      replacement.href +
      source.slice(replacement.end);
  }
  return source;
}

/** Counts links targeting one placement in a Markdown or Mermaid source. */
export function countScreenPlacementReferences(
  source,
  sourceType,
  screenId,
  placements,
  placementId
) {
  return getScreenLinkRanges(source, sourceType).reduce((count, { href }) =>
    count + Number(isReferenceToPlacement(href, screenId, placements, placementId)), 0);
}

/** Builds the SpecUX URL for a placement and optional named Screen State. */
export function createScreenPlacementUrl(screenId, placements, path, stateId = "default") {
  const placementIdPath = getScreenPlacementIdPath(placements, path)?.join(".");
  if (!placementIdPath) throw new Error("The selected placement is no longer available.");
  const parameters = new URLSearchParams({ placement: placementIdPath });
  if (stateId && stateId !== "default") parameters.set("state", stateId);
  return `specux://screen/${encodeURIComponent(screenId)}/screen.yml?${parameters}`;
}

/** Finds Screen links in Markdown or Mermaid source while preserving source offsets. */
function getScreenLinkRanges(source, sourceType) {
  const ranges = [];
  const lines = source.split(/(\r\n|\n|\r)/);
  let offset = 0;
  let codeFence = null;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    const lineEnding = lines[index + 1] || "";
    if (sourceType === "spec") {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (codeFence) {
        if (isClosingFence(line, fence, codeFence)) codeFence = null;
        offset += line.length + lineEnding.length;
        continue;
      }
      if (fence) {
        codeFence = { character: fence[1][0], length: fence[1].length };
        offset += line.length + lineEnding.length;
        continue;
      }
      const markdownLink = /\[[^\]]*\]\((specux:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
      for (const match of line.matchAll(markdownLink)) {
        const href = match[1];
        const start = offset + match.index + match[0].indexOf(href);
        ranges.push({ start, end: start + href.length, href });
      }
    } else if (sourceType === "workflow") {
      const directive = /^\s*click\s+\S+\s+href\s+"([^"]+)"(?:\s+"[^"]*")?\s*$/i.exec(line);
      if (directive) {
        const href = directive[1];
        const start = offset + line.indexOf(href);
        ranges.push({ start, end: start + href.length, href });
      }
    }
    offset += line.length + lineEnding.length;
  }
  return ranges;
}

/** Checks whether one URL targets the requested Screen placement. */
function isReferenceToPlacement(href, screenId, placements, placementId) {
  const url = getTargetScreenUrl(href, screenId);
  if (!url || url.searchParams.getAll("placement").length !== 1) return false;
  const referenceId = url.searchParams.get("placement");
  if (!referenceId) return false;
  const path = getScreenPlacementPathById(placements, referenceId);
  const target = path && getScreenPlacementAtPath(placements, path);
  return target?.id === placementId;
}

/** Checks whether a Markdown fence closes the active code block. */
function isClosingFence(line, fence, codeFence) {
  return Boolean(fence &&
    fence[1][0] === codeFence.character &&
    fence[1].length >= codeFence.length &&
    /^\s*$/.test(line.slice(fence[0].length)));
}

/** Rewrites one Screen URL to follow its stable placement ID after a tree change. */
function rewriteScreenPlacementHref(href, screenId, previousPlacements, nextPlacements) {
  const url = getTargetScreenUrl(href, screenId);
  if (!url || url.searchParams.getAll("placement").length !== 1) return href;
  const oldPlacementId = url.searchParams.get("placement");
  if (!oldPlacementId) return href;
  const newPlacementId = getNextPlacementId(
    previousPlacements,
    nextPlacements,
    oldPlacementId
  );
  if (newPlacementId === undefined) return href;
  if (newPlacementId === null) {
    url.searchParams.delete("placement");
  } else {
    if (newPlacementId === oldPlacementId) return href;
    url.searchParams.set("placement", newPlacementId);
  }
  return url.toString();
}

/** Returns the parsed URL when it targets this Screen's local Screen file. */
function getTargetScreenUrl(href, screenId) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "specux:" || url.hostname !== "screen" ||
      url.username || url.password || url.port || url.hash) return null;
  return isScreenFileUrl(url, screenId) ? url : null;
}

/** Checks whether a URL resolves to the requested Screen file. */
function isScreenFileUrl(url, screenId) {
  let pathSegments;
  try {
    pathSegments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return false;
  }
  return pathSegments.length === 2 &&
    pathSegments[0] === screenId &&
    pathSegments[1] === "screen.yml";
}

/** Returns the target's next ID path, null if removed, or undefined if unresolved. */
function getNextPlacementId(previousPlacements, nextPlacements, oldPlacementId) {
  const oldPath = getScreenPlacementPathById(previousPlacements, oldPlacementId);
  const oldPlacement = oldPath && getScreenPlacementAtPath(previousPlacements, oldPath);
  if (!oldPlacement) return undefined;
  const newPath = getScreenPlacementPathById(nextPlacements, oldPlacement.id);
  if (!newPath) return null;
  return getScreenPlacementIdPath(nextPlacements, newPath)?.join(".");
}
