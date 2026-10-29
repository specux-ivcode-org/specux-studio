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
    const materialSize = material.size || size;
    const rotation = (material.rotation || 0) * (Math.PI / 180);
    const rotatedHeight = Math.abs(Math.cos(rotation)) * materialSize.height +
      Math.abs(Math.sin(rotation)) * materialSize.width;
    const bottom = position.y + (materialSize.height + rotatedHeight) / 2;
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

  createFrame(host, instance, index, content, screen) {
    const frame = this.services.document.createElement("div");
    frame.className = "material-frame";
    frame.dataset.materialId = instance.id || "";
    const layers = screen?.data?.layers || [];
    const layerIndex = layers.findIndex((layer) => layer.id === instance.layer);
    const layerRank = layerIndex < 0 ? 0 : layers.length - layerIndex;
    frame.style.zIndex = String(
      layerRank * ((screen?.data?.materials?.length || 0) + 1) + index
    );
    frame.append(host);

    const fallbackPosition = defaultMaterialPosition(index);
    const hasNestedChildren = Object.values(instance.slots || {}).some(
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
      rotation
    };

    this.applyTransform(frame, host, transform);
    if (!this.state.isRenderOnly && !this.state.viewingSpec) {
      this.addControls(frame);
      this.configureInteractions(frame, host, instance, index, content, screen, transform);
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
    frame.style.transform = `rotate(${transform.rotation}deg)`;
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
      handle.setAttribute("aria-label", `Resize material from ${direction}`);
      frame.append(handle);
    }

    const rotateHandle = this.services.document.createElement("button");
    rotateHandle.type = "button";
    rotateHandle.className = "material-control material-rotate-control";
    rotateHandle.setAttribute("aria-label", "Rotate material");
    frame.append(rotateHandle);
  }

  configureInteractions(frame, host, instance, index, content, screen, transform) {
    const beginGesture = (event, mode, direction = "") => {
      if (event.button !== 0) return;
      if (mode === "move" && this.state.viewingSpec) return;
      if (mode === "move" && this.isInteractiveTarget(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "move") {
        this.services.selectInstance([index], instance.src || null);
      }

      const bounds = frame.getBoundingClientRect();
      const canvasBounds = content.getBoundingClientRect();
      const canvasScaleX = canvasBounds.width / (content.offsetWidth || canvasBounds.width || 1);
      const canvasScaleY = canvasBounds.height / (content.offsetHeight || canvasBounds.height || 1);
      const gesture = {
        pointerId: event.pointerId,
        mode,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startPosition: { ...transform.position },
        startSize: transform.size
          ? { ...transform.size }
          : {
            width: frame.offsetWidth || bounds.width,
            height: frame.offsetHeight || bounds.height
          },
        startRotation: transform.rotation,
        startAngle: Math.atan2(
          event.clientY - (bounds.top + bounds.height / 2),
          event.clientX - (bounds.left + bounds.width / 2)
        ),
        canvasScaleX: canvasScaleX || 1,
        canvasScaleY: canvasScaleY || 1,
        captured: false,
        changed: false
      };
      frame._materialGesture = gesture;
      if (mode !== "move") {
        frame.setPointerCapture(event.pointerId);
        gesture.captured = true;
      }
    };

    host.addEventListener("pointerdown", (event) => beginGesture(event, "move"));
    frame.querySelectorAll(".material-resize-control").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) =>
        beginGesture(event, "resize", handle.dataset.resizeDirection)
      );
    });
    frame.querySelector(".material-rotate-control")
      .addEventListener("pointerdown", (event) => beginGesture(event, "rotate"));

    frame.addEventListener("pointermove", (event) => {
      const gesture = frame._materialGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const deltaX = (event.clientX - gesture.startX) / gesture.canvasScaleX;
      const deltaY = (event.clientY - gesture.startY) / gesture.canvasScaleY;
      if (gesture.mode === "move" && !gesture.changed && Math.abs(deltaX) < 3 && Math.abs(deltaY) < 3) {
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
    const rotation = gesture.startRotation * (Math.PI / 180);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const localDeltaX = deltaX * cosine + deltaY * sine;
    const localDeltaY = -deltaX * sine + deltaY * cosine;
    let { width, height } = gesture.startSize;
    const direction = gesture.direction;
    if (direction.includes("e")) width += localDeltaX;
    if (direction.includes("s")) height += localDeltaY;
    if (direction.includes("w")) width -= localDeltaX;
    if (direction.includes("n")) height -= localDeltaY;
    width = Math.max(MIN_SIZE, width);
    height = Math.max(MIN_SIZE, height);

    const localShiftX = direction.includes("w") ? gesture.startSize.width - width : 0;
    const localShiftY = direction.includes("n") ? gesture.startSize.height - height : 0;
    const x = gesture.startPosition.x + localShiftX * cosine - localShiftY * sine;
    const y = gesture.startPosition.y + localShiftX * sine + localShiftY * cosine;
    transform.position = { x: Math.round(x), y: Math.round(y) };
    transform.size = { width: Math.round(width), height: Math.round(height) };
  }

  persistTransform(instance, transform) {
    instance.position = { ...transform.position };
    if (transform.size) instance.size = { ...transform.size };
    else delete instance.size;
    instance.rotation = transform.rotation;
  }

  isInteractiveTarget(event) {
    return event.composedPath().some((node) =>
      node?.matches?.(
        "a, button, input, select, textarea, [contenteditable='true']"
      )
    );
  }
}
