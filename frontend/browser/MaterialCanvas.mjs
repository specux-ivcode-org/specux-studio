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

/** Returns a non-overlapping starting position for a Material placement. */
export function defaultMaterialPosition(index) {
  return {
    x: 36 + (index % 4) * 240,
    y: 36 + Math.floor(index / 4) * 190
  };
}

/** Finds the next available Material position for the requested size. */
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

/** Renders and manipulates Material placements on the Screen canvas. */
export class MaterialCanvas {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  /** Creates a positioned canvas frame for a Material instance or group. */
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
    const frame = this.createFrameElement(host, instance, index, screen, path);
    const transform = this.getFrameTransform(instance, index);
    this.registerFrame(rootContent, frame, host, instance, transform, path);
    this.applyTransform(frame, host, transform);
    this.configureFrameInteractions(
      frame, host, instance, index, content, rootContent, screen, transform, path, parentTransform
    );
    return frame;
  }

  /** Builds the frame DOM, including transform and layer metadata. */
  createFrameElement(host, instance, index, screen, path) {
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
    return frame;
  }

  /** Returns the frame transform. */
  getFrameTransform(instance, index) {
    this.validateFrameInstance(instance, index);
    const isGroup = isScreenGroup(instance);
    const position = this.getFramePosition(instance, index, isGroup);
    const size = instance.size || null;
    return {
      position: { x: position.x, y: position.y },
      size: size ? { width: size.width, height: size.height } : null,
      fillCanvasWidth: isGroup && !size,
      rotation: instance.rotation ?? 0,
      scale: getScaleComponents(instance.scale ?? 1),
      affine: instance.affine || IDENTITY_MATRIX,
      isGroup
    };
  }

  /** Validates the frame instance before it is applied or saved. */
  validateFrameInstance(instance, index) {
    if (instance.position !== undefined && !this.validPosition(instance.position)) {
      throw new Error(`Material "${instance.id || index}" position must contain numeric x and y values.`);
    }
    if (instance.size !== undefined && !this.validSize(instance.size)) {
      throw new Error(`Material "${instance.id || index}" size must contain positive width and height values.`);
    }
    if (instance.rotation !== undefined && !Number.isFinite(instance.rotation)) {
      throw new Error(`Material "${instance.id || index}" rotation must be a number.`);
    }
  }

  /** Returns the frame position. */
  getFramePosition(instance, index, isGroup) {
    return instance.position || (isGroup ? { x: 0, y: 0 } : defaultMaterialPosition(index));
  }

  /** Updates the frame for the current editor state. */
  registerFrame(rootContent, frame, host, instance, transform, path) {
    rootContent._materialFrames ||= new Map();
    rootContent._materialFrames.set(JSON.stringify(path), {
      frame,
      host,
      instance,
      transform,
      path
    });
  }

  /** Updates the frame interactions for the current editor state. */
  configureFrameInteractions(
    frame, host, instance, index, content, rootContent, screen, transform, path, parentTransform
  ) {
    if (this.shouldConfigureInteractions()) {
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
  }

  /** Checks whether the configure interactions for the current editor state. */
  shouldConfigureInteractions() {
    return !this.state.isRenderOnly &&
        !this.state.viewingSpec &&
        !this.state.viewingWorkflow &&
        !this.state.viewingTheme;
  }

  /** Checks that both coordinates are finite numeric values. */
  validPosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y);
  }

  /** Checks that width and height are finite, positive numeric values. */
  validSize(size) {
    return size &&
      Number.isFinite(size.width) && size.width >= MIN_SIZE &&
      Number.isFinite(size.height) && size.height >= MIN_SIZE;
  }

  /** Applies the transform to the current editor state. */
  applyTransform(frame, host, transform) {
    frame.style.left = `${transform.position.x}px`;
    frame.style.top = `${transform.position.y}px`;
    const scale = getScaleComponents(transform.scale);
    const affine = transform.affine || IDENTITY_MATRIX;
    frame.style.transform = this.getTransformCss(transform.rotation, scale, affine);
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
    this.applyFrameSize(frame, host, transform);
    this.updateSelectionOutline(frame);
  }

  /** Returns the transform css. */
  getTransformCss(rotation, scale, affine) {
    const scaleTransform = scale.x === 1 && scale.y === 1
      ? ""
      : ` scale(${scale.x}, ${scale.y})`;
    const affineTransform = affine.a === 1 && affine.b === 0 &&
      affine.c === 0 && affine.d === 1
      ? ""
      : ` matrix(${affine.a}, ${affine.b}, ${affine.c}, ${affine.d}, 0, 0)`;
    return `rotate(${rotation}deg)${scaleTransform}${affineTransform}`;
  }

  /** Applies the frame size to the current editor state. */
  applyFrameSize(frame, host, transform) {
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
  }

  /** Adds the controls for the current editor state. */
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

  /** Updates the selection outline to reflect the latest editor state. */
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
    this.updateResizeControlAnchors(frame, center, boundsCenter, boundsWidth, boundsHeight);
    this.positionControlAnchor(
      frame.querySelector(".material-rotate-control"),
      { x: boundsCenter.x, y: -ROTATE_HANDLE_OFFSET },
      frame,
      center,
      boundsCenter
    );
  }

  /** Repositions resize handles at the transformed selection bounds. */
  updateResizeControlAnchors(frame, center, boundsCenter, boundsWidth, boundsHeight) {
    for (const handle of frame.querySelectorAll(".material-control")) {
      const direction = handle.dataset.resizeDirection;
      if (!direction) continue;
      const anchor = {
        x: direction.includes("w") ? 0 : direction.includes("e") ? boundsWidth : boundsCenter.x,
        y: direction.includes("n") ? 0 : direction.includes("s") ? boundsHeight : boundsCenter.y
      };
      this.positionControlAnchor(handle, anchor, frame, center, boundsCenter);
    }
  }

  /** Updates the control anchor for the current editor state. */
  positionControlAnchor(handle, anchor, frame, center, boundsCenter) {
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
  }

  /** Updates the interactions for the current editor state. */
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
    const context = {
      frame, host, instance, index, content, rootContent, screen,
      transform, path, parentTransform
    };

    /** Updates the gesture for the current editor state. */
    const beginGesture = (event, mode, direction = "") =>
      this.beginGesture(context, event, mode, direction);

    frame._beginMaterialGesture = beginGesture;
    if (isScreenGroup(instance)) {
      frame.addEventListener("pointerdown", (event) =>
        this.handleGroupPointerDown(event, frame, path), true);
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

    frame.addEventListener("pointermove", (event) => this.handlePointerMove(context, event));

    /** Ends the gesture for the current editor state. */
    const endGesture = (event) => this.endGesture(context, event);
    frame.addEventListener("pointerup", endGesture);
    frame.addEventListener("pointercancel", endGesture);
  }

  /** Handles group pointer down events and applies the corresponding editor action. */
  handleGroupPointerDown(event, frame, path) {
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
    gestureFrame._beginMaterialGesture?.(event, "move");
  }

  /** Updates the gesture for the current editor state. */
  beginGesture(context, event, mode, direction) {
    if (!this.canBeginGesture(event, mode)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.selectPlacementForGesture(context, event, mode)) return;
    const geometry = this.getGestureGeometry(context, event);
    const gesture = this.createGestureState(context, event, mode, direction, geometry);
    this.initializeGestureSelection(gesture, event, geometry.canvasBounds);
    context.frame._materialGesture = gesture;
    if (mode !== "move") {
      context.frame.setPointerCapture(event.pointerId);
      gesture.captured = true;
    }
  }

  /** Checks whether the current preview context allows a pointer gesture. */
  canBeginGesture(event, mode) {
    if (event.button !== 0) return false;
    if (mode === "move" && this.state.viewingSpec) return false;
    return mode !== "move" || !this.isInteractiveTarget(event);
  }

  /** Selects the placement for gesture and updates the related editor state. */
  selectPlacementForGesture({ instance, path }, event, mode) {
    if (mode !== "move") return true;
    const selected = this.state.activeInstancePaths?.some((selectedPath) =>
      this.samePath(selectedPath, path)
    ) || this.samePath(this.state.activeInstancePath || [], path);
    if (event.ctrlKey) {
      this.services.selectInstance(path, instance.src || null, { toggle: true });
      return false;
    }
    if (!selected) this.services.selectInstance(path, instance.src || null);
    return true;
  }

  /** Returns the captured bounds and transform for the active canvas gesture. */
  getGestureGeometry({ frame, rootContent, parentTransform }, event) {
    const bounds = frame.getBoundingClientRect();
    const canvasBounds = rootContent.getBoundingClientRect();
    const canvasScaleX = canvasBounds.width / (rootContent.offsetWidth || canvasBounds.width || 1);
    const canvasScaleY = canvasBounds.height / (rootContent.offsetHeight || canvasBounds.height || 1);
    const inverseParentMatrix = invertAffineMatrix(parentTransform.matrix || IDENTITY_MATRIX);
    const startPointer = this.pointerVectorInParent(
      event.clientX - (bounds.left + bounds.width / 2),
      event.clientY - (bounds.top + bounds.height / 2),
      canvasScaleX || 1,
      canvasScaleY || 1,
      inverseParentMatrix
    );
    return { bounds, canvasBounds, canvasScaleX, canvasScaleY, inverseParentMatrix, startPointer };
  }

  /** Stores the initial pointer, selection, and geometry for a canvas gesture. */
  createGestureState(context, event, mode, direction, geometry) {
    const { frame, instance, path, transform, rootContent } = context;
    const startSize = transform.size
      ? { ...transform.size }
      : {
        width: frame.offsetWidth || geometry.bounds.width,
        height: frame.offsetHeight || geometry.bounds.height
      };
    return {
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
      startAngle: Math.atan2(geometry.startPointer.y, geometry.startPointer.x),
      canvasScaleX: geometry.canvasScaleX || 1,
      canvasScaleY: geometry.canvasScaleY || 1,
      inverseParentMatrix: geometry.inverseParentMatrix,
      startPlacementMatrix: getScreenPlacementMatrix({ ...instance, ...transform }),
      startScale: getScaleComponents(transform.scale),
      groupGeometry: transform.isGroup ? this.captureGroupGeometry(instance, frame, path) : [],
      multiSelection: mode !== "move" ? this.captureMultiSelection(rootContent, path) : null,
      captured: false,
      changed: false
    };
  }

  /** Initializes the gesture selection for the current editor state. */
  initializeGestureSelection(gesture, event, canvasBounds) {
    if (!(gesture.multiSelection?.items.length > 1)) return;
    if (gesture.mode === "resize") {
      gesture.startSelectionPointer = this.getCanvasPointer(event, canvasBounds, gesture);
      return;
    }
    if (gesture.mode !== "rotate") return;
    const selection = gesture.multiSelection;
    const center = {
      x: selection.bounds.x + selection.bounds.width / 2,
      y: selection.bounds.y + selection.bounds.height / 2
    };
    gesture.selectionCenter = center;
    const pointer = this.getCanvasPointer(event, canvasBounds, gesture);
    gesture.startAngle = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  }

  /** Converts the pointer event to coordinates relative to the Screen canvas. */
  getCanvasPointer(event, canvasBounds, gesture) {
    return {
      x: (event.clientX - canvasBounds.left) / gesture.canvasScaleX,
      y: (event.clientY - canvasBounds.top) / gesture.canvasScaleY
    };
  }

  /** Handles pointer move events and applies the corresponding editor action. */
  handlePointerMove(context, event) {
    const { frame } = context;
    const gesture = frame._materialGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const pointerDelta = this.getGesturePointerDelta(context, event, gesture);
    const isMultiSelection = gesture.multiSelection?.items.length > 1 &&
      gesture.mode !== "move";
    if (this.isGestureBelowMoveThreshold(gesture, pointerDelta.canvasDelta)) return;
    event.preventDefault();
    this.captureGesturePointer(frame, event, gesture);
    this.applyGesturePointerChange(context, event, gesture, pointerDelta, isMultiSelection);
    gesture.changed = true;
    this.persistGestureChanges(context, gesture, isMultiSelection);
  }

  /** Calculates the pointer displacement since the gesture began. */
  getGesturePointerDelta({ rootContent }, event, gesture) {
    const canvasDelta = {
      x: (event.clientX - gesture.startX) / gesture.canvasScaleX,
      y: (event.clientY - gesture.startY) / gesture.canvasScaleY
    };
    return {
      canvasDelta,
      parentDelta: this.transformVector(gesture.inverseParentMatrix, canvasDelta),
      canvasBounds: rootContent.getBoundingClientRect()
    };
  }

  /** Checks whether pointer movement remains below the drag-start threshold. */
  isGestureBelowMoveThreshold(gesture, delta) {
    return gesture.mode === "move" && !gesture.changed &&
      Math.abs(delta.x) < 3 && Math.abs(delta.y) < 3;
  }

  /** Captures the gesture pointer for the current editor state. */
  captureGesturePointer(frame, event, gesture) {
    if (gesture.captured) return;
    frame.setPointerCapture(event.pointerId);
    gesture.captured = true;
  }

  /** Applies the gesture pointer change to the current editor state. */
  applyGesturePointerChange(context, event, gesture, pointerDelta, isMultiSelection) {
    if (isMultiSelection) {
      this.applyMultiSelectionPointerChange(gesture, event, pointerDelta.canvasBounds);
      return;
    }
    if (gesture.mode === "move") {
      context.transform.position = {
        x: Math.round(gesture.startPosition.x + pointerDelta.parentDelta.x),
        y: Math.round(gesture.startPosition.y + pointerDelta.parentDelta.y)
      };
      return;
    }
    if (gesture.mode === "resize") {
      const localDelta = this.transformVector(
        invertAffineMatrix(gesture.startPlacementMatrix),
        pointerDelta.parentDelta
      );
      this.resizeTransform(context.transform, gesture, localDelta);
      return;
    }
    this.applyRotationPointerChange(context.frame, context.transform, event, gesture);
  }

  /** Applies the multi selection pointer change to the current editor state. */
  applyMultiSelectionPointerChange(gesture, event, canvasBounds) {
    const pointer = this.getCanvasPointer(event, canvasBounds, gesture);
    if (gesture.mode === "resize") this.resizeSelection(gesture, pointer);
    else this.rotateSelection(gesture, pointer);
  }

  /** Applies the rotation pointer change to the current editor state. */
  applyRotationPointerChange(frame, transform, event, gesture) {
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

  /** Updates the gesture changes for the current editor state. */
  persistGestureChanges(context, gesture, isMultiSelection) {
    if (isMultiSelection) {
      for (const item of gesture.multiSelection.items) {
        this.persistMultiSelectionItem(item, gesture);
      }
      return;
    }
    const { frame, host, instance, transform } = context;
    this.persistTransform(instance, transform);
    this.services.persistPlacementState?.(instance);
    this.applyTransform(frame, host, transform);
    if (this.shouldUpdateGroupGeometry(gesture, transform.isGroup)) {
      this.updateGroupGeometryFrames(gesture.groupGeometry);
    }
  }

  /** Updates the multi selection item for the current editor state. */
  persistMultiSelectionItem(item, gesture) {
    Object.assign(item.liveTransform, item.transform);
    this.persistTransform(item.instance, item.transform);
    this.services.persistPlacementState?.(item.instance);
    this.applyTransform(item.frame, item.host, item.liveTransform);
    if (this.shouldUpdateGroupGeometry(gesture, item.transform.isGroup)) {
      this.updateGroupGeometryFrames(item.groupGeometry);
    }
  }

  /** Checks whether the gesture changed group geometry that must be persisted. */
  shouldUpdateGroupGeometry(gesture, isGroup) {
    return gesture.mode === "resize" && gesture.scaleType === "xy" && isGroup;
  }

  /** Ends the gesture for the current editor state. */
  endGesture(context, event) {
    const { frame, screen } = context;
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
  }

  /** Resizes the transform within its configured bounds. */
  resizeTransform(transform, gesture, localDelta) {
    if (gesture.scaleType === "transform") {
      this.resizeUsingTransformScale(transform, gesture, localDelta);
      return;
    }
    this.resizeUsingDimensions(transform, gesture, localDelta);
  }

  /** Resizes the using transform scale within its configured bounds. */
  resizeUsingTransformScale(transform, gesture, localDelta) {
    const direction = gesture.direction;
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
  }

  /** Resizes the using dimensions within its configured bounds. */
  resizeUsingDimensions(transform, gesture, localDelta) {
    const direction = gesture.direction;
    let width = gesture.startSize.width;
    let height = gesture.startSize.height;
    if (direction.includes("e")) width += localDelta.x;
    if (direction.includes("w")) width -= localDelta.x;
    if (direction.includes("s")) height += localDelta.y;
    if (direction.includes("n")) height -= localDelta.y;
    width = Math.max(MIN_SIZE, width);
    height = Math.max(MIN_SIZE, height);
    if (gesture.isGroup && gesture.groupGeometry.length) {
      ({ width, height } = this.ensureGroupMinimumSize(width, height, gesture));
    }
    this.applyDimensionResize(transform, gesture, width, height);
  }

  /** Ensures the group minimum size for the current editor state. */
  ensureGroupMinimumSize(width, height, gesture) {
    const minimumRatioX = Math.max(
      MIN_SIZE / gesture.startSize.width,
      ...gesture.groupGeometry.map((entry) => MIN_SIZE / entry.size.width)
    );
    const minimumRatioY = Math.max(
      MIN_SIZE / gesture.startSize.height,
      ...gesture.groupGeometry.map((entry) => MIN_SIZE / entry.size.height)
    );
    return {
      width: Math.max(width, gesture.startSize.width * minimumRatioX),
      height: Math.max(height, gesture.startSize.height * minimumRatioY)
    };
  }

  /** Applies the dimension resize to the current editor state. */
  applyDimensionResize(transform, gesture, width, height) {
    transform.size = { width: Math.round(width), height: Math.round(height) };
    const ratioX = width / gesture.startSize.width;
    const ratioY = height / gesture.startSize.height;
    if (gesture.isGroup) {
      this.applyGroupGeometryScale(gesture.groupGeometry, ratioX, ratioY);
    }
    const oldCenter = { x: gesture.startSize.width / 2, y: gesture.startSize.height / 2 };
    const newCenter = { x: width / 2, y: height / 2 };
    const oldAnchor = this.resizeAnchor(gesture.startSize, gesture.direction);
    const newAnchor = this.resizeAnchor(transform.size, gesture.direction);
    const oldOffset = this.transformVector(gesture.startPlacementMatrix, oldAnchor);
    const newOffset = this.transformVector(gesture.startPlacementMatrix, newAnchor);
    transform.position = {
      x: Math.round(gesture.startPosition.x + oldCenter.x - newCenter.x +
        oldOffset.x - newOffset.x),
      y: Math.round(gesture.startPosition.y + oldCenter.y - newCenter.y +
        oldOffset.y - newOffset.y)
    };
  }

  /** Captures the multi selection for the current editor state. */
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

    const items = [...uniquePaths.values()]
      .map((path) => this.createMultiSelectionItem(frames, path))
      .filter(Boolean);
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

  /** Stores the selected placement geometry used to calculate multi-resize changes. */
  createMultiSelectionItem(frames, path) {
    const entry = frames.get(JSON.stringify(path));
    if (!entry) return null;
    const { frame, host, instance } = entry;
    const transform = this.createMultiSelectionTransform(entry, frame);
    if (!transform) return null;
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
  }

  /** Calculates the shared transform for the current set of selected placements. */
  createMultiSelectionTransform(entry, frame) {
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
    return transform;
  }

  /** Resizes the selection within its configured bounds. */
  resizeSelection(gesture, pointer) {
    const { bounds, items } = gesture.multiSelection;
    const ratios = this.getSelectionResizeRatios(gesture, pointer, bounds, items);
    const anchor = this.getSelectionResizeAnchor(gesture.direction, bounds);
    for (const item of items) this.resizeSelectionItem(item, ratios, anchor, gesture.scaleType);
  }

  /** Calculates width and height ratios from the selection resize bounds. */
  getSelectionResizeRatios(gesture, pointer, bounds, items) {
    let width = bounds.width;
    let height = bounds.height;
    const deltaX = pointer.x - gesture.startSelectionPointer.x;
    const deltaY = pointer.y - gesture.startSelectionPointer.y;
    if (gesture.direction.includes("e")) width += deltaX;
    if (gesture.direction.includes("w")) width -= deltaX;
    if (gesture.direction.includes("s")) height += deltaY;
    if (gesture.direction.includes("n")) height -= deltaY;
    return {
      x: Math.max(
        ...items.map((item) => MIN_SIZE / item.startSize.width),
        width / bounds.width
      ),
      y: Math.max(
        ...items.map((item) => MIN_SIZE / item.startSize.height),
        height / bounds.height
      )
    };
  }

  /** Returns the fixed corner or edge used by selection resizing. */
  getSelectionResizeAnchor(direction, bounds) {
    return {
      x: direction.includes("e")
        ? bounds.x
        : direction.includes("w") ? bounds.x + bounds.width : bounds.x + bounds.width / 2,
      y: direction.includes("s")
        ? bounds.y
        : direction.includes("n") ? bounds.y + bounds.height : bounds.y + bounds.height / 2
    };
  }

  /** Resizes the selection item within its configured bounds. */
  resizeSelectionItem(item, ratios, anchor, scaleType) {
    const { transform } = item;
    const center = {
      x: item.startPosition.x + item.startSize.width / 2,
      y: item.startPosition.y + item.startSize.height / 2
    };
    const nextCenter = {
      x: anchor.x + (center.x - anchor.x) * ratios.x,
      y: anchor.y + (center.y - anchor.y) * ratios.y
    };
    if (scaleType === "xy") this.resizeSelectionItemDimensions(item, ratios);
    else this.resizeSelectionItemTransform(item, ratios);
    transform.position = {
      x: nextCenter.x - transform.size.width / 2,
      y: nextCenter.y - transform.size.height / 2
    };
  }

  /** Resizes the selection item dimensions within its configured bounds. */
  resizeSelectionItemDimensions(item, ratios) {
    const { transform } = item;
    transform.size = {
      width: Math.max(MIN_SIZE, item.startSize.width * ratios.x),
      height: Math.max(MIN_SIZE, item.startSize.height * ratios.y)
    };
    if (transform.isGroup) {
      this.applyGroupGeometryScale(item.groupGeometry, ratios.x, ratios.y);
    }
  }

  /** Resizes the selection item transform within its configured bounds. */
  resizeSelectionItemTransform(item, ratios) {
    const { transform } = item;
    const scale = {
      x: item.startScale.x * ratios.x,
      y: item.startScale.y * ratios.y
    };
    const baseMatrix = getScreenPlacementMatrix({
      rotation: transform.rotation,
      scale,
      affine: IDENTITY_MATRIX
    });
    const worldScale = { a: ratios.x, b: 0, c: 0, d: ratios.y };
    const nextMatrix = multiplyAffineMatrices(worldScale, item.startMatrix);
    transform.scale = scale;
    transform.affine = multiplyAffineMatrices(
      invertAffineMatrix(baseMatrix),
      nextMatrix
    );
  }

  /** Updates the selection for the current editor state. */
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

  /** Stores the computed transform on the selected placement. */
  persistTransform(instance, transform) {
    instance.position = { ...transform.position };
    instance.scale = serializeScale(getScaleComponents(transform.scale));
    instance.size = { ...transform.size };
    instance.rotation = transform.rotation;
    if (transform.affine) instance.affine = { ...transform.affine };
    else delete instance.affine;
  }

  /** Applies the current affine transform to a vector. */
  transformVector(matrix, vector) {
    return {
      x: matrix.a * vector.x + matrix.c * vector.y,
      y: matrix.b * vector.x + matrix.d * vector.y
    };
  }

  /** Converts pointer movement into the parent frame coordinate space. */
  pointerVectorInParent(clientX, clientY, scaleX, scaleY, inverseParentMatrix) {
    return this.transformVector(inverseParentMatrix, {
      x: clientX / scaleX,
      y: clientY / scaleY
    });
  }

  /** Returns the fixed point used as the anchor during resizing. */
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

  /** Snapshots descendant frames before the group transform changes. */
  captureGroupGeometry(group, frame, path) {
    const frameByPath = new Map(
      [...frame.querySelectorAll(".material-frame")].map((candidate) => [
        candidate.dataset.instancePath,
        candidate
      ])
    );
    const geometry = [];

    /** Walks nested Screen placements to collect their geometry and instance paths. */
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

  /** Scales captured descendant geometry by the requested group factors. */
  applyGroupGeometryScale(geometry, scaleX, scaleY) {

    /** Updates the geometry for the current editor state. */
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

  /** Refreshes canvas frames after a group child geometry change. */
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

  /** Checks whether two placement paths contain the same indices. */
  samePath(left, right) {
    return left.length === right.length && left.every((part, index) => part === right[index]);
  }

  /** Parses the instance path stored on a canvas frame. */
  readPlacementPath(frame) {
    try {
      const path = JSON.parse(frame?.dataset?.instancePath || "null");
      return Array.isArray(path) ? path : null;
    } catch {
      return null;
    }
  }

  /** Checks whether the event target is a canvas control that should receive interaction. */
  isInteractiveTarget(event) {
    return event.composedPath().some((node) =>
      node?.matches?.(
        "a, button, input, select, textarea, [contenteditable='true']"
      )
    );
  }
}
