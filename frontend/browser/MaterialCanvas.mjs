import { getScreenPlacementBounds, isScreenGroup } from "../../shared/ScreenGroups.mjs";

const HANDLE_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const MIN_SIZE = 24;

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
    parentTransform = { scale: 1, rotation: 0 },
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
      scale: isScreenGroup(instance) ? (instance.scale ?? 1) : 1,
      isGroup: isScreenGroup(instance)
    };

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
    frame.style.transform = transform.isGroup && transform.scale !== 1
      ? `rotate(${transform.rotation}deg) scale(${transform.scale})`
      : `rotate(${transform.rotation}deg)`;
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

  addControls(frame) {
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
      if (transform.isGroup) {
        startSize.width *= transform.scale;
        startSize.height *= transform.scale;
      }
      const gesture = {
        pointerId: event.pointerId,
        mode,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startPosition: { ...transform.position },
        startSize,
        isGroup: transform.isGroup,
        startRotation: transform.rotation,
        startAngle: Math.atan2(
          event.clientY - (bounds.top + bounds.height / 2),
          event.clientX - (bounds.left + bounds.width / 2)
        ),
        canvasScaleX: canvasScaleX || 1,
        canvasScaleY: canvasScaleY || 1,
        parentScale: parentTransform.scale || 1,
        parentRotation: parentTransform.rotation || 0,
        startScale: transform.scale,
        captured: false,
        changed: false
      };
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
      const parentRadians = gesture.parentRotation * (Math.PI / 180);
      const deltaX = (Math.cos(parentRadians) * canvasDeltaX +
        Math.sin(parentRadians) * canvasDeltaY) / gesture.parentScale;
      const deltaY = (-Math.sin(parentRadians) * canvasDeltaX +
        Math.cos(parentRadians) * canvasDeltaY) / gesture.parentScale;
      if (gesture.mode === "move" && !gesture.changed &&
          Math.abs(canvasDeltaX) < 3 && Math.abs(canvasDeltaY) < 3) {
        return;
      }
      event.preventDefault();
      if (!gesture.captured) {
        frame.setPointerCapture(event.pointerId);
        gesture.captured = true;
      }

      if (gesture.mode === "move") {
        transform.position = {
          x: Math.round(gesture.startPosition.x + deltaX),
          y: Math.round(gesture.startPosition.y + deltaY)
        };
      } else if (gesture.mode === "resize") {
        this.resizeTransform(transform, gesture, deltaX, deltaY);
      } else {
        const bounds = frame.getBoundingClientRect();
        const angle = Math.atan2(
          event.clientY - (bounds.top + bounds.height / 2),
          event.clientX - (bounds.left + bounds.width / 2)
        );
        const degrees = (angle - gesture.startAngle) * (180 / Math.PI);
        transform.rotation = Math.round(gesture.startRotation + degrees);
      }

      gesture.changed = true;
      this.persistTransform(instance, transform);
      this.applyTransform(frame, host, transform);
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

  resizeTransform(transform, gesture, deltaX, deltaY) {
    const radians = gesture.startRotation * (Math.PI / 180);
    const localDeltaX = Math.cos(radians) * deltaX + Math.sin(radians) * deltaY;
    const localDeltaY = -Math.sin(radians) * deltaX + Math.cos(radians) * deltaY;
    const direction = gesture.direction;
    let width = gesture.startSize.width;
    let height = gesture.startSize.height;
    if (direction.includes("e")) width += localDeltaX;
    if (direction.includes("w")) width -= localDeltaX;
    if (direction.includes("s")) height += localDeltaY;
    if (direction.includes("n")) height -= localDeltaY;

    let shiftX = direction.includes("w") ? gesture.startSize.width - width : 0;
    let shiftY = direction.includes("n") ? gesture.startSize.height - height : 0;
    if (gesture.isGroup) {
      const ratios = [];
      if (direction.includes("e") || direction.includes("w")) {
        ratios.push(width / gesture.startSize.width);
      }
      if (direction.includes("n") || direction.includes("s")) {
        ratios.push(height / gesture.startSize.height);
      }
      const factor = Math.max(
        MIN_SIZE / gesture.startSize.width,
        MIN_SIZE / gesture.startSize.height,
        ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
      );
      width = gesture.startSize.width * factor;
      height = gesture.startSize.height * factor;
      transform.scale = gesture.startScale * factor;
      shiftX = direction.includes("w") ? gesture.startSize.width - width : 0;
      shiftY = direction.includes("n") ? gesture.startSize.height - height : 0;
    } else {
      width = Math.max(MIN_SIZE, width);
      height = Math.max(MIN_SIZE, height);
      transform.size = { width: Math.round(width), height: Math.round(height) };
      shiftX = direction.includes("w") ? gesture.startSize.width - width : 0;
      shiftY = direction.includes("n") ? gesture.startSize.height - height : 0;
    }

    transform.position = {
      x: Math.round(gesture.startPosition.x + Math.cos(radians) * shiftX -
        Math.sin(radians) * shiftY),
      y: Math.round(gesture.startPosition.y + Math.sin(radians) * shiftX +
        Math.cos(radians) * shiftY)
    };
  }

  persistTransform(instance, transform) {
    instance.position = { ...transform.position };
    if (transform.isGroup) instance.scale = transform.scale;
    else instance.size = { ...transform.size };
    instance.rotation = transform.rotation;
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
