import {
  getScaleComponents,
  getScreenPlacementBounds,
  getScreenPlacementMatrix,
  invertAffineMatrix,
  isScreenGroup,
  multiplyAffineMatrices,
  serializeScale
} from "../../shared/ScreenGroups.mjs";

const HANDLE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const MIN_SIZE = 24;
const CONTROL_SIZE = 10;
const ROTATE_HANDLE_OFFSET = 21;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1 };

export function defaultMaterialPosition(index) {
  return {
    x: 36 + (index % 4) * 240,
    y: 36 + Math.floor(index / 4) * 190
  };
}

export function nextMaterialPosition(materials, size) {
  let lowestBottom = null;
  for (const [index, material] of materials.entries()) {
    const position = material.position || defaultMaterialPosition(index);
    const materialBounds = material.size && material.position
      ? getScreenPlacementBounds(material)
      : { y: position.y, height: size.height };
    const bottom = materialBounds.y + materialBounds.height;
    lowestBottom = Math.max(lowestBottom ?? bottom, bottom);
  }
  return {
    x: 36,
    y: lowestBottom === null ? 36 : Math.ceil(lowestBottom + 24)
  };
}

export class MaterialCanvas {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  createFrame(
    host,
    instance,
    index,
    content,
    screen,
    path = [index],
    parentTransform = { matrix: IDENTITY_MATRIX },
    rootContent = content
  ) {
    const frame = this.services.document.createElement("div");
    frame.className = `material-frame${isScreenGroup(instance) ? " material-group-frame" : ""}`;
    frame.dataset.materialId = instance.id || "";
    frame.dataset.instancePath = JSON.stringify(path);
    frame.dataset.placementType = isScreenGroup(instance) ? "group" : "material";
    const layers = screen?.data?.layers || [];
    const rootPlacement = screen?.data?.materials?.[path[0]];
    const layerIndex = layers.findIndex((layer) => layer.id === rootPlacement?.layer);
    const layerRank = layerIndex < 0 ? 0 : layers.length - layerIndex;
    frame.style.zIndex = String(path.length === 1
      ? layerRank * ((screen?.data?.materials?.length || 0) + 1) + index
      : index);
    frame.append(host);

    const fallbackPosition = defaultMaterialPosition(index);
    const hasNestedChildren = isScreenGroup(instance) ||
      Object.values(instance.slots || {}).some(
        (children) => Array.isArray(children) && children.length > 0
      );
    if (instance.position !== undefined && !this.validPosition(instance.position)) {
      throw new Error(`Material "${instance.id || index}" position must contain numeric x and y values.`);
    }
    if (instance.size !== undefined && !this.validSize(instance.size)) {
      throw new Error(`Material "${instance.id || index}" size must contain positive width and height values.`);
    }
    if (instance.rotation !== undefined && !Number.isFinite(instance.rotation)) {
      throw new Error(`Material "${instance.id || index}" rotation must be a number.`);
    }
    const position = instance.position || (hasNestedChildren ? { x: 0, y: 0 } : fallbackPosition);
    const size = instance.size || null;
    const rotation = instance.rotation ?? 0;
    const transform = {
      position: { x: position.x, y: position.y },
      size: size ? { width: size.width, height: size.height } : null,
      fillCanvasWidth: hasNestedChildren && !size,
      rotation,
      scale: getScaleComponents(instance.scale ?? 1),
      affine: instance.affine || IDENTITY_MATRIX,
      isGroup: isScreenGroup(instance)
    };

    rootContent._materialFrames ||= new Map();
    rootContent._materialFrames.set(JSON.stringify(path), {
      frame,
      host,
      instance,
      transform,
      path
    });
    this.applyTransform(frame, host, transform);
    if (!this.state.isRenderOnly && !this.state.viewingSpec) {
      const isNestedPlacement = path.length > 1;
      if (!isNestedPlacement) this.addControls(frame);
      this.configureInteractions(
        frame,
        host,
        instance,
        index,
        content,
        rootContent,
        screen,
        transform,
        path,
        parentTransform
      );
    }
    return frame;
  }

  validPosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y);
  }

  validSize(size) {
    return size &&
      Number.isFinite(size.width) && size.width >= MIN_SIZE &&
      Number.isFinite(size.height) && size.height >= MIN_SIZE;
  }

  applyTransform(frame, host, transform) {
    frame.style.left = `${transform.position.x}px`;
    frame.style.top = `${transform.position.y}px`;
    const scale = getScaleComponents(transform.scale);
    const affine = transform.affine || IDENTITY_MATRIX;
    const scaleTransform = scale.x === 1 && scale.y === 1
      ? ""
      : ` scale(${scale.x}, ${scale.y})`;
    const affineTransform = affine.a === 1 && affine.b === 0 &&
      affine.c === 0 && affine.d === 1
      ? ""
      : ` matrix(${affine.a}, ${affine.b}, ${affine.c}, ${affine.d}, 0, 0)`;
    frame.style.transform = `rotate(${transform.rotation}deg)${scaleTransform}${affineTransform}`;
    const placementMatrix = getScreenPlacementMatrix({
      rotation: transform.rotation,
      scale,
      affine
    });
    const controlCounterTransform = invertAffineMatrix(placementMatrix);
    frame.selectionCounterMatrix = controlCounterTransform;
    frame.selectionBoundsMatrix = placementMatrix;
    frame.style.setProperty(
      "--material-control-counter-transform",
      `matrix(${controlCounterTransform.a}, ${controlCounterTransform.b}, ${controlCounterTransform.c}, ${controlCounterTransform.d}, 0, 0)`
    );
    if (frame.selectionOutline) {
      frame.selectionOutline.style.transform =
        `matrix(${controlCounterTransform.a}, ${controlCounterTransform.b}, ${controlCounterTransform.c}, ${controlCounterTransform.d}, 0, 0)`;
    }
    frame.classList.toggle("sized", Boolean(transform.size));
    frame.classList.toggle("legacy-layout", transform.fillCanvasWidth);
    if (transform.size) {
      frame.style.width = `${transform.size.width}px`;
      frame.style.height = `${transform.size.height}px`;
      host.style.width = "100%";
      host.style.height = "100%";
    } else {
      frame.style.width = transform.fillCanvasWidth ? "100%" : "";
      frame.style.height = "";
      host.style.width = transform.fillCanvasWidth ? "100%" : "";
      host.style.height = "";
    }
    this.updateSelectionOutline(frame);
  }

  addControls(frame) {
    const outline = this.services.document.createElementNS(SVG_NAMESPACE, "svg");
    outline.setAttribute("class", "material-selection-outline");
    outline.setAttribute("aria-hidden", "true");
    const outlineRect = this.services.document.createElementNS(SVG_NAMESPACE, "rect");
    outlineRect.setAttribute("vector-effect", "non-scaling-stroke");
    outline.append(outlineRect);
    outline.selectionRect = outlineRect;
    frame.selectionOutline = outline;
    frame.append(outline);
    this.updateSelectionOutline(frame);

    for (const direction of HANDLE_DIRECTIONS) {
      const handle = this.services.document.createElement("button");
      handle.type = "button";
      handle.className = "material-control material-resize-control";
      handle.dataset.resizeDirection = direction;
      handle.setAttribute("aria-label", `Resize placement from ${direction}`);
      frame.append(handle);
    }

    const rotateHandle = this.services.document.createElement("button");
    rotateHandle.type = "button";
    rotateHandle.className = "material-control material-rotate-control";
    rotateHandle.setAttribute("aria-label", "Rotate material");
    frame.append(rotateHandle);
    this.updateSelectionOutline(frame);
  }

  updateSelectionOutline(frame) {
    const outline = frame.selectionOutline;
    if (!outline) return;
    const width = frame.offsetWidth || Number.parseFloat(frame.style.width);
    const height = frame.offsetHeight || Number.parseFloat(frame.style.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
      return;
    }

    const matrix = frame.selectionBoundsMatrix || IDENTITY_MATRIX;
    const boundsWidth = Math.round(
      (Math.abs(matrix.a) * width + Math.abs(matrix.c) * height) * 1000
    ) / 1000;
    const boundsHeight = Math.round(
      (Math.abs(matrix.b) * width + Math.abs(matrix.d) * height) * 1000
    ) / 1000;
    outline.style.left = `${(width - boundsWidth) / 2}px`;
    outline.style.top = `${(height - boundsHeight) / 2}px`;
    outline.style.right = "auto";
    outline.style.bottom = "auto";
    outline.style.width = `${boundsWidth}px`;
    outline.style.height = `${boundsHeight}px`;
    outline.setAttribute("viewBox", `0 0 ${boundsWidth} ${boundsHeight}`);
    outline.selectionRect.setAttribute("x", "0.5");
    outline.selectionRect.setAttribute("y", "0.5");
    outline.selectionRect.setAttribute("width", String(boundsWidth - 1));
    outline.selectionRect.setAttribute("height", String(boundsHeight - 1));

    const center = { x: width / 2, y: height / 2 };
    const boundsCenter = { x: boundsWidth / 2, y: boundsHeight / 2 };
    const setControlAnchor = (handle, anchor) => {
      if (!handle) return;
      const localOffset = this.transformVector(
        frame.selectionCounterMatrix || IDENTITY_MATRIX,
        { x: anchor.x - boundsCenter.x, y: anchor.y - boundsCenter.y }
      );
      const left = Math.round(
        (center.x + localOffset.x - CONTROL_SIZE / 2) * 1000
      ) / 1000;
      const top = Math.round(
        (center.y + localOffset.y - CONTROL_SIZE / 2) * 1000
      ) / 1000;
      handle.style.left = `${left}px`;
      handle.style.top = `${top}px`;
      handle.style.right = "auto";
      handle.style.bottom = "auto";
    };
    for (const handle of frame.querySelectorAll(".material-control")) {
      const direction = handle.dataset.resizeDirection;
      if (!direction) continue;
      const anchor = {
        x: direction.includes("w") ? 0 : direction.includes("e") ? boundsWidth : boundsCenter.x,
        y: direction.includes("n") ? 0 : direction.includes("s") ? boundsHeight : boundsCenter.y
      };
      setControlAnchor(handle, anchor);
    }
    setControlAnchor(frame.querySelector(".material-rotate-control"), {
      x: boundsCenter.x,
      y: -ROTATE_HANDLE_OFFSET
    });
  }

  configureInteractions(
    frame,
    host,
    instance,
    index,
    content,
    rootContent,
    screen,
    transform,
    path,
    parentTransform
  ) {
    const beginGesture = (event, mode, direction = "") => {
      if (event.button !== 0) return;
      if (mode === "move" && this.state.viewingSpec) return;
      if (mode === "move" && this.isInteractiveTarget(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "move") {
        const selected = this.state.activeInstancePaths?.some((selectedPath) =>
          this.samePath(selectedPath, path)
        ) || this.samePath(this.state.activeInstancePath || [], path);
        if (event.ctrlKey) {
          this.services.selectInstance(path, instance.src || null, { toggle: true });
          return;
        }
        if (!selected) this.services.selectInstance(path, instance.src || null);
      }

      const bounds = frame.getBoundingClientRect();
      const canvasBounds = rootContent.getBoundingClientRect();
      const canvasScaleX = canvasBounds.width / (rootContent.offsetWidth || canvasBounds.width || 1);
      const canvasScaleY = canvasBounds.height / (rootContent.offsetHeight || canvasBounds.height || 1);
      const startSize = transform.size
        ? { ...transform.size }
        : {
          width: frame.offsetWidth || bounds.width,
          height: frame.offsetHeight || bounds.height
        };
      const parentMatrix = parentTransform.matrix || IDENTITY_MATRIX;
      const startPlacementMatrix = getScreenPlacementMatrix({
        ...instance,
        ...transform
      });
      const inverseParentMatrix = invertAffineMatrix(parentMatrix);
      const startPointer = this.pointerVectorInParent(
        event.clientX - (bounds.left + bounds.width / 2),
        event.clientY - (bounds.top + bounds.height / 2),
        canvasScaleX || 1,
        canvasScaleY || 1,
        inverseParentMatrix
      );
      const gesture = {
        pointerId: event.pointerId,
        mode,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startPosition: { ...transform.position },
        startSize,
        isGroup: transform.isGroup,
        scaleType: this.state.scaleType || "xy",
        startRotation: transform.rotation,
        startAngle: Math.atan2(startPointer.y, startPointer.x),
        canvasScaleX: canvasScaleX || 1,
        canvasScaleY: canvasScaleY || 1,
        inverseParentMatrix,
        startPlacementMatrix,
        startScale: getScaleComponents(transform.scale),
        groupGeometry: transform.isGroup
          ? this.captureGroupGeometry(instance, frame, path)
          : [],
        multiSelection: mode !== "move"
          ? this.captureMultiSelection(rootContent, path)
          : null,
        captured: false,
        changed: false
      };
      if (gesture.multiSelection?.items.length > 1) {
        const selection = gesture.multiSelection;
        if (mode === "resize") {
          gesture.startSelectionPointer = {
            x: (event.clientX - canvasBounds.left) / gesture.canvasScaleX,
            y: (event.clientY - canvasBounds.top) / gesture.canvasScaleY
          };
        } else if (mode === "rotate") {
          const center = {
            x: selection.bounds.x + selection.bounds.width / 2,
            y: selection.bounds.y + selection.bounds.height / 2
          };
          gesture.selectionCenter = center;
          const pointer = {
            x: (event.clientX - canvasBounds.left) / gesture.canvasScaleX,
            y: (event.clientY - canvasBounds.top) / gesture.canvasScaleY
          };
          gesture.startAngle = Math.atan2(pointer.y - center.y, pointer.x - center.x);
        }
      }
      frame._materialGesture = gesture;
      if (mode !== "move") {
        frame.setPointerCapture(event.pointerId);
        gesture.captured = true;
      }
    };

    frame._beginMaterialGesture = beginGesture;
    if (isScreenGroup(instance)) {
      frame.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target?.closest?.(".material-control")) return;
        const frames = event.composedPath().filter((node) =>
          node?.classList?.contains("material-frame")
        );
        const targetFrame = frames[0] || frame;
        const targetPath = this.readPlacementPath(targetFrame) || path;
        if (event.ctrlKey) {
          this.services.selectInstance(
            targetPath,
            targetFrame.dataset.materialSrc || null,
            { toggle: true }
          );
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const groupFrames = frames.filter((candidate) =>
          candidate.classList.contains("material-group-frame")
        );
        const gestureFrame = groupFrames.at(-1) || frame;
        const gesture = gestureFrame._beginMaterialGesture;
        gesture?.(event, "move");
      }, true);
    } else if (path.length === 1) {
      host.addEventListener("pointerdown", (event) => beginGesture(event, "move"));
    }

    frame.querySelectorAll(".material-resize-control").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) =>
        beginGesture(event, "resize", handle.dataset.resizeDirection)
      );
    });
    frame.querySelector(".material-rotate-control")
      ?.addEventListener("pointerdown", (event) => beginGesture(event, "rotate"));

    frame.addEventListener("pointermove", (event) => {
      const gesture = frame._materialGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const canvasDeltaX = (event.clientX - gesture.startX) / gesture.canvasScaleX;
      const canvasDeltaY = (event.clientY - gesture.startY) / gesture.canvasScaleY;
      const currentCanvasBounds = rootContent.getBoundingClientRect();
      const parentDelta = this.transformVector(
        gesture.inverseParentMatrix,
        { x: canvasDeltaX, y: canvasDeltaY }
      );
      const isMultiSelection = gesture.multiSelection?.items.length > 1 &&
        gesture.mode !== "move";
      if (gesture.mode === "move" && !gesture.changed &&
          Math.abs(canvasDeltaX) < 3 && Math.abs(canvasDeltaY) < 3) {
        return;
      }
      event.preventDefault();
      if (!gesture.captured) {
        frame.setPointerCapture(event.pointerId);
        gesture.captured = true;
      }

      if (isMultiSelection && gesture.mode === "resize") {
        const pointer = {
          x: (event.clientX - currentCanvasBounds.left) / gesture.canvasScaleX,
          y: (event.clientY - currentCanvasBounds.top) / gesture.canvasScaleY
        };
        this.resizeSelection(gesture, pointer);
      } else if (isMultiSelection && gesture.mode === "rotate") {
        const pointer = {
          x: (event.clientX - currentCanvasBounds.left) / gesture.canvasScaleX,
          y: (event.clientY - currentCanvasBounds.top) / gesture.canvasScaleY
        };
        this.rotateSelection(gesture, pointer);
      } else if (gesture.mode === "move") {
        transform.position = {
          x: Math.round(gesture.startPosition.x + parentDelta.x),
          y: Math.round(gesture.startPosition.y + parentDelta.y)
        };
      } else if (gesture.mode === "resize") {
        const pointerLocalDelta = this.transformVector(
          invertAffineMatrix(gesture.startPlacementMatrix),
          parentDelta
        );
        this.resizeTransform(transform, gesture, pointerLocalDelta);
      } else {
        const bounds = frame.getBoundingClientRect();
        const pointerVector = this.pointerVectorInParent(
          event.clientX - (bounds.left + bounds.width / 2),
          event.clientY - (bounds.top + bounds.height / 2),
          gesture.canvasScaleX,
          gesture.canvasScaleY,
          gesture.inverseParentMatrix
        );
        const angle = Math.atan2(pointerVector.y, pointerVector.x);
        const degrees = (angle - gesture.startAngle) * (180 / Math.PI);
        transform.rotation = Math.round(gesture.startRotation + degrees);
      }

      gesture.changed = true;
      if (isMultiSelection) {
        for (const item of gesture.multiSelection.items) {
          Object.assign(item.liveTransform, item.transform);
          this.persistTransform(item.instance, item.transform);
          this.applyTransform(item.frame, item.host, item.liveTransform);
          if (gesture.mode === "resize" && gesture.scaleType === "xy" && item.transform.isGroup) {
            this.updateGroupGeometryFrames(item.groupGeometry);
          }
        }
      } else {
        this.persistTransform(instance, transform);
        this.applyTransform(frame, host, transform);
        if (gesture.mode === "resize" && gesture.scaleType === "xy" && gesture.isGroup) {
          this.updateGroupGeometryFrames(gesture.groupGeometry);
        }
      }
    });

    const endGesture = (event) => {
      const gesture = frame._materialGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      frame._materialGesture = null;
      if (gesture.captured && frame.hasPointerCapture(event.pointerId)) {
        frame.releasePointerCapture(event.pointerId);
      }
      if (gesture.changed) {
        this.services.markEdited(screen.file);
        this.services.renderInspector();
      }
    };
    frame.addEventListener("pointerup", endGesture);
    frame.addEventListener("pointercancel", endGesture);
  }

  resizeTransform(transform, gesture, localDelta) {
    const direction = gesture.direction;
    if (gesture.scaleType === "transform") {
      const scale = { ...gesture.startScale };
      if (direction.includes("e") || direction.includes("w")) {
        const signedDeltaX = direction.includes("w") ? -localDelta.x : localDelta.x;
        scale.x = Math.max(
          MIN_SIZE / gesture.startSize.width,
          scale.x * (1 + signedDeltaX / gesture.startSize.width)
        );
      }
      if (direction.includes("s") || direction.includes("n")) {
        const signedDeltaY = direction.includes("n") ? -localDelta.y : localDelta.y;
        scale.y = Math.max(
          MIN_SIZE / gesture.startSize.height,
          scale.y * (1 + signedDeltaY / gesture.startSize.height)
        );
      }
      transform.scale = scale;
      const newMatrix = getScreenPlacementMatrix(transform);
      const anchor = this.resizeAnchor(gesture.startSize, direction);
      const oldOffset = this.transformVector(gesture.startPlacementMatrix, anchor);
      const newOffset = this.transformVector(newMatrix, anchor);
      transform.position = {
        x: Math.round(gesture.startPosition.x + oldOffset.x - newOffset.x),
        y: Math.round(gesture.startPosition.y + oldOffset.y - newOffset.y)
      };
    } else {
      let width = gesture.startSize.width;
      let height = gesture.startSize.height;
      if (direction.includes("e")) width += localDelta.x;
      if (direction.includes("w")) width -= localDelta.x;
      if (direction.includes("s")) height += localDelta.y;
      if (direction.includes("n")) height -= localDelta.y;
      width = Math.max(MIN_SIZE, width);
      height = Math.max(MIN_SIZE, height);
      if (gesture.isGroup && gesture.groupGeometry.length) {
        const minimumRatioX = Math.max(
          MIN_SIZE / gesture.startSize.width,
          ...gesture.groupGeometry.map((entry) => MIN_SIZE / entry.size.width)
        );
        const minimumRatioY = Math.max(
          MIN_SIZE / gesture.startSize.height,
          ...gesture.groupGeometry.map((entry) => MIN_SIZE / entry.size.height)
        );
        width = Math.max(width, gesture.startSize.width * minimumRatioX);
        height = Math.max(height, gesture.startSize.height * minimumRatioY);
      }
      transform.size = { width: Math.round(width), height: Math.round(height) };
      const ratioX = width / gesture.startSize.width;
      const ratioY = height / gesture.startSize.height;
      if (gesture.isGroup) {
        this.applyGroupGeometryScale(gesture.groupGeometry, ratioX, ratioY);
      }
      const oldCenter = { x: gesture.startSize.width / 2, y: gesture.startSize.height / 2 };
      const newCenter = { x: width / 2, y: height / 2 };
      const oldAnchor = this.resizeAnchor(gesture.startSize, direction);
      const newAnchor = this.resizeAnchor(transform.size, direction);
      const oldOffset = this.transformVector(gesture.startPlacementMatrix, oldAnchor);
      const newOffset = this.transformVector(gesture.startPlacementMatrix, newAnchor);
      transform.position = {
        x: Math.round(gesture.startPosition.x + oldCenter.x - newCenter.x +
          oldOffset.x - newOffset.x),
        y: Math.round(gesture.startPosition.y + oldCenter.y - newCenter.y +
          oldOffset.y - newOffset.y)
      };
    }
  }

  captureMultiSelection(rootContent, activePath) {
    const selectedPaths = this.state.activeInstancePaths || [];
    const paths = selectedPaths.length ? selectedPaths : [activePath];
    const frames = rootContent._materialFrames;
    if (!frames) return null;
    const uniquePaths = new Map();
    for (const path of paths) {
      if (!Array.isArray(path) || path.length !== 1) continue;
      uniquePaths.set(JSON.stringify(path), path);
    }
    if (!uniquePaths.has(JSON.stringify(activePath)) && activePath.length === 1) {
      uniquePaths.set(JSON.stringify(activePath), activePath);
    }

    const items = [...uniquePaths.values()].map((path) => {
      const entry = frames.get(JSON.stringify(path));
      if (!entry) return null;
      const { frame, host, instance } = entry;
      const transform = {
        ...entry.transform,
        position: { ...entry.transform.position },
        size: entry.transform.size
          ? { ...entry.transform.size }
          : {
            width: frame.offsetWidth || Number.parseFloat(frame.style.width),
            height: frame.offsetHeight || Number.parseFloat(frame.style.height)
          },
        scale: getScaleComponents(entry.transform.scale),
        affine: { ...(entry.transform.affine || IDENTITY_MATRIX) }
      };
      if (!transform.size || !Number.isFinite(transform.size.width) ||
          !Number.isFinite(transform.size.height)) return null;
      const startPlacement = {
        ...transform,
        ...instance,
        position: { ...transform.position },
        size: { ...transform.size },
        scale: transform.scale,
        affine: transform.affine
      };
      return {
        frame,
        host,
        instance,
        liveTransform: entry.transform,
        transform,
        startPosition: { ...transform.position },
        startSize: { ...transform.size },
        startScale: { ...transform.scale },
        rotationStart: transform.rotation,
        startMatrix: getScreenPlacementMatrix(startPlacement),
        groupGeometry: transform.isGroup
          ? this.captureGroupGeometry(instance, frame, path)
          : []
      };
    }).filter(Boolean);
    if (items.length < 2) return { items, bounds: null };

    const bounds = items.map((item) => getScreenPlacementBounds({
      ...item.transform,
      position: item.startPosition,
      size: item.startSize
    })).reduce((result, next) => {
      const left = Math.min(result.x, next.x);
      const top = Math.min(result.y, next.y);
      const right = Math.max(result.x + result.width, next.x + next.width);
      const bottom = Math.max(result.y + result.height, next.y + next.height);
      return { x: left, y: top, width: right - left, height: bottom - top };
    });
    return { items, bounds };
  }

  resizeSelection(gesture, pointer) {
    const { bounds, items } = gesture.multiSelection;
    let width = bounds.width;
    let height = bounds.height;
    const deltaX = pointer.x - gesture.startSelectionPointer.x;
    const deltaY = pointer.y - gesture.startSelectionPointer.y;
    if (gesture.direction.includes("e")) width += deltaX;
    if (gesture.direction.includes("w")) width -= deltaX;
    if (gesture.direction.includes("s")) height += deltaY;
    if (gesture.direction.includes("n")) height -= deltaY;

    let ratioX = width / bounds.width;
    let ratioY = height / bounds.height;
    const minimumRatioX = Math.max(
      ...items.map((item) => MIN_SIZE / item.startSize.width)
    );
    const minimumRatioY = Math.max(
      ...items.map((item) => MIN_SIZE / item.startSize.height)
    );
    ratioX = Math.max(minimumRatioX, ratioX);
    ratioY = Math.max(minimumRatioY, ratioY);
    const anchor = {
      x: gesture.direction.includes("e")
        ? bounds.x
        : gesture.direction.includes("w") ? bounds.x + bounds.width : bounds.x + bounds.width / 2,
      y: gesture.direction.includes("s")
        ? bounds.y
        : gesture.direction.includes("n") ? bounds.y + bounds.height : bounds.y + bounds.height / 2
    };

    for (const item of items) {
      const { transform } = item;
      const center = {
        x: item.startPosition.x + item.startSize.width / 2,
        y: item.startPosition.y + item.startSize.height / 2
      };
      const nextCenter = {
        x: anchor.x + (center.x - anchor.x) * ratioX,
        y: anchor.y + (center.y - anchor.y) * ratioY
      };
      if (gesture.scaleType === "xy") {
        transform.size = {
          width: Math.max(MIN_SIZE, item.startSize.width * ratioX),
          height: Math.max(MIN_SIZE, item.startSize.height * ratioY)
        };
        if (transform.isGroup) {
          this.applyGroupGeometryScale(item.groupGeometry, ratioX, ratioY);
        }
      } else {
        const scale = {
          x: item.startScale.x * ratioX,
          y: item.startScale.y * ratioY
        };
        const baseMatrix = getScreenPlacementMatrix({
          rotation: transform.rotation,
          scale,
          affine: IDENTITY_MATRIX
        });
        const worldScale = { a: ratioX, b: 0, c: 0, d: ratioY };
        const nextMatrix = multiplyAffineMatrices(worldScale, item.startMatrix);
        transform.scale = scale;
        transform.affine = multiplyAffineMatrices(
          invertAffineMatrix(baseMatrix),
          nextMatrix
        );
      }
      transform.position = {
        x: nextCenter.x - transform.size.width / 2,
        y: nextCenter.y - transform.size.height / 2
      };
    }
  }

  rotateSelection(gesture, pointer) {
    const center = gesture.selectionCenter;
    const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x);
    let radians = angle - gesture.startAngle;
    while (radians > Math.PI) radians -= Math.PI * 2;
    while (radians < -Math.PI) radians += Math.PI * 2;
    const degrees = radians * (180 / Math.PI);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    for (const item of gesture.multiSelection.items) {
      const placementCenter = {
        x: item.startPosition.x + item.startSize.width / 2,
        y: item.startPosition.y + item.startSize.height / 2
      };
      const offsetX = placementCenter.x - center.x;
      const offsetY = placementCenter.y - center.y;
      const nextCenter = {
        x: center.x + cosine * offsetX - sine * offsetY,
        y: center.y + sine * offsetX + cosine * offsetY
      };
      item.transform.position = {
        x: nextCenter.x - item.startSize.width / 2,
        y: nextCenter.y - item.startSize.height / 2
      };
      item.transform.rotation = item.rotationStart + degrees;
    }
  }

  persistTransform(instance, transform) {
    instance.position = { ...transform.position };
    instance.scale = serializeScale(getScaleComponents(transform.scale));
    instance.size = { ...transform.size };
    instance.rotation = transform.rotation;
  }

  transformVector(matrix, vector) {
    return {
      x: matrix.a * vector.x + matrix.c * vector.y,
      y: matrix.b * vector.x + matrix.d * vector.y
    };
  }

  pointerVectorInParent(clientX, clientY, scaleX, scaleY, inverseParentMatrix) {
    return this.transformVector(inverseParentMatrix, {
      x: clientX / scaleX,
      y: clientY / scaleY
    });
  }

  resizeAnchor(size, direction) {
    return {
      x: direction.includes("e")
        ? -size.width / 2
        : direction.includes("w") ? size.width / 2 : 0,
      y: direction.includes("s")
        ? -size.height / 2
        : direction.includes("n") ? size.height / 2 : 0
    };
  }

  captureGroupGeometry(group, frame, path) {
    const frameByPath = new Map(
      [...frame.querySelectorAll(".material-frame")].map((candidate) => [
        candidate.dataset.instancePath,
        candidate
      ])
    );
    const geometry = [];
    const visit = (placement, placementPath) => {
      const childFrame = frameByPath.get(JSON.stringify(placementPath));
      geometry.push({
        placement,
        frame: childFrame || null,
        position: { ...placement.position },
        size: { ...placement.size }
      });
      if (isScreenGroup(placement)) {
        placement.children.forEach((child, index) =>
          visit(child, [...placementPath, index])
        );
      }
    };
    group.children.forEach((child, index) => visit(child, [...path, index]));
    return geometry;
  }

  applyGroupGeometryScale(geometry, scaleX, scaleY) {
    const roundGeometry = (value) => Math.round(value * 1000) / 1000;
    for (const entry of geometry) {
      entry.placement.position = {
        x: roundGeometry(entry.position.x * scaleX),
        y: roundGeometry(entry.position.y * scaleY)
      };
      entry.placement.size = {
        width: roundGeometry(entry.size.width * scaleX),
        height: roundGeometry(entry.size.height * scaleY)
      };
    }
  }

  updateGroupGeometryFrames(geometry) {
    for (const { placement, frame } of geometry) {
      if (!frame) continue;
      this.applyTransform(frame, frame.children[0], {
        position: placement.position,
        size: placement.size,
        fillCanvasWidth: false,
        rotation: placement.rotation || 0,
        scale: getScaleComponents(placement.scale ?? 1),
        affine: placement.affine || IDENTITY_MATRIX,
        isGroup: isScreenGroup(placement)
      });
    }
  }

  samePath(left, right) {
    return left.length === right.length && left.every((part, index) => part === right[index]);
  }

  readPlacementPath(frame) {
    try {
      const path = JSON.parse(frame?.dataset?.instancePath || "null");
      return Array.isArray(path) ? path : null;
    } catch {
      return null;
    }
  }

  isInteractiveTarget(event) {
    return event.composedPath().some((node) =>
      node?.matches?.(
        "a, button, input, select, textarea, [contenteditable='true']"
      )
    );
  }
}
