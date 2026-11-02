const COLOR_PICK_DIAMETER = 35;
const COLOR_PICK_RADIUS = COLOR_PICK_DIAMETER / 2;
const COLOR_PICK_SAMPLE_STEP = 1;

export class ThemeEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.scope = "screen";
    this.selectedMaterialPath = "";
    this.colorPopup = null;
    this.radiusCursor = null;
    this.previewPointerHandler = (event) => this.selectPreviewColor(event);
    this.previewPointerMoveHandler = (event) => this.updateRadiusCursor(event);
    this.previewPointerLeaveHandler = () => this.hideRadiusCursor();
    this.outsidePointerHandler = (event) => this.closeColorPopupOutsidePreview(event);
    this.escapeHandler = (event) => {
      if (event.key === "Escape") this.closeColorPopup();
    };
    this.previewPointerBound = false;
  }

  getDefinedModes() {
    const { theme, themeModeNames } = this.state;
    const modes = theme?.modes;
    const definedModes = themeModeNames.filter((mode) =>
      modes && Object.hasOwn(modes, mode)
    );
    if (definedModes.length) return definedModes;
    return theme && Object.hasOwn(theme, "tokens") ? ["light"] : [];
  }

  getActiveMode() {
    const { themeModePreference, systemThemeMode } = this.state;
    const modes = this.getDefinedModes();
    const requestedMode = themeModePreference === "system" ? systemThemeMode : themeModePreference;
    return modes.includes(requestedMode) ? requestedMode : modes[0] || requestedMode;
  }

  getTokens(mode = this.getActiveMode()) {
    const { theme } = this.state;
    const modes = this.getDefinedModes();
    const activeMode = modes.includes(mode) ? mode : modes[0];
    if (!activeMode) return {};
    if (!theme?.modes || !Object.hasOwn(theme.modes, activeMode)) return theme?.tokens || {};

    const fallbackMode = activeMode === "light" ? "dark" : "light";
    return {
      ...(theme.modes[fallbackMode]?.tokens || {}),
      ...(theme.modes[activeMode]?.tokens || {})
    };
  }

  modeLabel(mode) {
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  getMaterialOptions() {
    return [...this.state.materialFiles.entries()]
      .map(([path, material]) => ({
        value: path,
        label: `${material.data.name || path} · ${path}`
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  createSelect(parent, label, value, options, onChange) {
    const wrapper = this.services.element("div", "editor-field");
    const select = this.services.element("select");
    const id = `theme-context-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    select.id = id;
    const fieldLabel = this.services.element("label", "", label);
    fieldLabel.htmlFor = id;
    for (const option of options) {
      const optionElement = this.services.element("option", "", option.label);
      optionElement.value = String(option.value);
      select.append(optionElement);
    }
    select.value = String(value ?? "");
    select.disabled = options.length === 0;
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(fieldLabel, select);
    parent.append(wrapper);
  }

  addTokenUses(usages, value, label) {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/var\(\s*--theme-([a-z0-9][a-z0-9-]*)/gi)) {
      const name = match[1];
      if (!usages.has(name)) usages.set(name, new Set());
      usages.get(name).add(label);
    }
  }

  isColorAttribute(name) {
    return /color|background|border|shadow|fill|stroke|track|gradient|outline|accent/i
      .test(name);
  }

  addMaterialUses(usages, instance, placementLabel) {
    const definition = this.state.materialFiles.get(instance?.src);
    if (!definition) return;
    const materialName = definition.data.name || instance.src;
    for (const [name, attribute] of Object.entries(definition.data.attributes || {})) {
      if (!this.isColorAttribute(name)) continue;
      const value = Object.hasOwn(instance.attributes || {}, name)
        ? instance.attributes[name]
        : attribute.default;
      this.addTokenUses(usages, value, `${placementLabel} · ${name}`);
    }
    this.addTokenUses(usages, definition.html, `${materialName} styles · ${placementLabel}`);
  }

  describePreviewElement(node) {
    const tag = node.localName || node.tagName?.toLowerCase() || "element";
    const className = typeof node.className === "string"
      ? node.className
      : node.getAttribute?.("class") || "";
    const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return `${tag}${classes.length ? `.${classes.join(".")}` : ""}`;
  }

  getDeclarationNames(style) {
    const names = [];
    const cssText = style.cssText || "";
    let start = 0;
    let colon = -1;
    let depth = 0;
    let quote = "";
    let escaped = false;
    const addName = () => {
      if (colon < 0) return;
      const name = cssText.slice(start, colon).trim();
      if (name) names.push(name);
    };

    for (let index = 0; index <= cssText.length; index += 1) {
      const character = cssText[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth = Math.max(0, depth - 1);
      } else if (character === ":" && colon < 0 && depth === 0) {
        colon = index;
      } else if ((character === ";" && depth === 0) || index === cssText.length) {
        addName();
        start = index + 1;
        colon = -1;
      }
    }
    return names;
  }

  getPropertyGroup(property) {
    if (property === "color" || property === "-webkit-text-fill-color") return "text";
    if (property === "background" || property === "background-color") return "background";
    if (/^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(property)) return "border";
    if (property === "fill" || property === "stroke") return "svg";
    return null;
  }

  getDeclarationReferences(value) {
    return [...value.matchAll(/var\(\s*--theme-([a-z0-9][a-z0-9-]*)/gi)]
      .map((match) => match[1]);
  }

  matchesSelector(node, root, selector) {
    if (node === root) return node.matches(selector);
    if (selector.includes(":scope")) {
      return [...root.querySelectorAll(selector)].includes(node);
    }
    return node.matches(selector);
  }

  getNodeColorDeclarations(node, root, group) {
    const inlineDeclarations = [];
    for (const property of this.getDeclarationNames(node.style || {})) {
      if (this.getPropertyGroup(property) !== group) continue;
      inlineDeclarations.push({
        property,
        value: node.style.getPropertyValue(property),
        source: "inline"
      });
    }
    if (inlineDeclarations.length) return inlineDeclarations;

    const declarations = [];
    const visitRules = (rules) => {
      for (const rule of rules) {
        if (rule.media?.mediaText && !window.matchMedia(rule.media.mediaText).matches) {
          continue;
        }
        if (rule.conditionText && rule.constructor?.name === "CSSSupportsRule" &&
            !window.CSS.supports(rule.conditionText)) {
          continue;
        }
        if (rule.selectorText && rule.style &&
            this.matchesSelector(node, root, rule.selectorText)) {
          for (const property of this.getDeclarationNames(rule.style)) {
            if (this.getPropertyGroup(property) !== group) continue;
            declarations.push({
              property,
              value: rule.style.getPropertyValue(property),
              source: "Material CSS"
            });
          }
        }
        if (rule.cssRules) visitRules(rule.cssRules);
      }
    };
    for (const styleElement of root.querySelectorAll("style")) {
      if (styleElement.sheet?.cssRules) visitRules(styleElement.sheet.cssRules);
    }
    return declarations;
  }

  resolveColorDeclarations(declarations, group) {
    if (!declarations.length) return null;
    if (declarations.every(({ value }) =>
      /^(inherit|unset)$/i.test(value.trim()) ||
      (group === "text" && /^currentcolor$/i.test(value.trim()))
    )) {
      return { status: "inherit" };
    }
    const tokenNames = new Set();
    for (const declaration of declarations) {
      const references = this.getDeclarationReferences(declaration.value);
      if (references.length !== 1) return { status: "unmapped" };
      tokenNames.add(references[0]);
    }
    if (tokenNames.size !== 1) return { status: "ambiguous" };
    const declaration = declarations[0];
    return {
      status: "mapped",
      token: [...tokenNames][0],
      property: declaration.property,
      source: declaration.source
    };
  }

  findColorBinding(node, root, group, bindingCache = null) {
    const cachedBindings = bindingCache?.get(node);
    if (cachedBindings?.has(group)) return cachedBindings.get(group);
    for (let current = node; current && root.contains(current); current = current.parentElement) {
      const declarations = this.getNodeColorDeclarations(current, root, group);
      if (declarations.length) {
        const binding = this.resolveColorDeclarations(declarations, group);
        if (binding.status === "inherit") {
          if (current === root) break;
          continue;
        }
        const result = {
          ...binding,
          node: current
        };
        if (bindingCache) {
          if (!bindingCache.has(node)) bindingCache.set(node, new Map());
          bindingCache.get(node).set(group, result);
        }
        return result;
      }
      if (current === root) break;
    }
    if (bindingCache) {
      if (!bindingCache.has(node)) bindingCache.set(node, new Map());
      bindingCache.get(node).set(group, null);
    }
    return null;
  }

  getTextElementAtPoint(event, root) {
    const document = this.services.document;
    const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const rangeAtPoint = position
      ? null
      : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const textNode = position?.offsetNode || rangeAtPoint?.startContainer;
    if (textNode?.nodeType !== 3 || !root.contains(textNode)) return null;
    const textLength = textNode.textContent?.length || 0;
    if (!textLength) return null;
    const offset = Math.min(position?.offset ?? rangeAtPoint.startOffset, textLength - 1);
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    const rect = range.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) return null;
    return textNode.parentElement;
  }

  getBorderSideAtPoint(node, event) {
    const rect = node.getBoundingClientRect();
    const style = this.services.getComputedStyle(node);
    const sides = [
      ["top", event.clientY - rect.top, "borderTopWidth", "borderTopStyle"],
      ["right", rect.right - event.clientX, "borderRightWidth", "borderRightStyle"],
      ["bottom", rect.bottom - event.clientY, "borderBottomWidth", "borderBottomStyle"],
      ["left", event.clientX - rect.left, "borderLeftWidth", "borderLeftStyle"]
    ];
    return sides.some(([, distance, widthProperty, styleProperty]) => {
      const width = Number.parseFloat(style[widthProperty]) || 0;
      return distance >= 0 && distance <= width && width > 0 &&
        style[styleProperty] !== "none" && style[styleProperty] !== "hidden";
    });
  }

  parseComputedColor(value) {
    const match = /^rgba?\((.*)\)$/i.exec(value.trim());
    if (!match) return null;
    const [channels, alphaValue] = match[1].split("/");
    const parts = channels.match(/[\d.]+%?/g) || [];
    if (parts.length < 3) return null;
    const toChannel = (part) => {
      const number = Number.parseFloat(part);
      return Math.round(part.endsWith("%") ? number * 2.55 : number);
    };
    let alpha = alphaValue === undefined
      ? (parts[3] === undefined ? 1 : Number.parseFloat(parts[3]))
      : Number.parseFloat(alphaValue);
    if (alphaValue?.trim().endsWith("%")) alpha *= 0.01;
    const channelsAsHex = parts.slice(0, 3)
      .map((part) => toChannel(part).toString(16).padStart(2, "0"))
      .join("");
    if (alpha > 1) alpha *= 0.01;
    return { hex: `#${channelsAsHex}`, alpha };
  }

  normalizeThemeColor(value, root) {
    const probe = this.services.document.createElement("span");
    probe.style.cssText = "all: initial; position: absolute; visibility: hidden;";
    probe.style.setProperty("color", value, "important");
    root.append(probe);
    const normalized = this.parseComputedColor(this.services.getComputedStyle(probe).color);
    probe.remove();
    return normalized;
  }

  getPointColorBinding(event, target, root, bindingCache = null) {
    const textElement = this.getTextElementAtPoint(event, root);
    if (textElement) return this.findColorBinding(textElement, root, "text", bindingCache);

    if (target.namespaceURI === "http://www.w3.org/2000/svg") {
      return this.findColorBinding(target, root, "svg", bindingCache);
    }

    for (let node = target; node && root.contains(node); node = node.parentElement) {
      if (this.getBorderSideAtPoint(node, event)) {
        return this.findColorBinding(node, root, "border", bindingCache) ||
          { status: "unmapped" };
      }
      const computed = this.services.getComputedStyle(node);
      const backgroundImage = computed.backgroundImage;
      const color = this.parseComputedColor(computed.backgroundColor);
      if ((backgroundImage && backgroundImage !== "none") || (color && color.alpha > 0)) {
        return this.findColorBinding(node, root, "background", bindingCache) ||
          { status: "unmapped" };
      }
      if (node === root) break;
    }
    return { status: "unmapped" };
  }

  isOpaqueColorSurface(node) {
    const style = this.services.getComputedStyle(node);
    if ((Number.parseFloat(style.opacity) || 0) < 1) return false;
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    return this.parseComputedColor(style.backgroundColor)?.alpha === 1;
  }

  getNearbyColorBindings(event) {
    const preview = this.services.byId("screen-preview");
    const bounds = preview.getBoundingClientRect();
    const candidateByToken = new Map();
    const bindingCaches = new Map();
    const sample = (clientX, clientY) => {
      if (clientX < bounds.left || clientX > bounds.right ||
          clientY < bounds.top || clientY > bounds.bottom) return;
      const distance = Math.hypot(clientX - event.clientX, clientY - event.clientY);
      const targets = this.services.document.elementsFromPoint
        ? this.services.document.elementsFromPoint(clientX, clientY)
        : [this.services.document.elementFromPoint(clientX, clientY)].filter(Boolean);
      for (const target of targets) {
        const root = target.closest?.(
          ".material-instance, .material-file-preview-sample"
        );
        if (root) {
          if (!bindingCaches.has(root)) bindingCaches.set(root, new Map());
          const binding = this.getPointColorBinding(
            { clientX, clientY },
            target,
            root,
            bindingCaches.get(root)
          );
          if (binding?.status === "mapped") {
            const existing = candidateByToken.get(binding.token);
            if (!existing || distance < existing.distance) {
              candidateByToken.set(binding.token, { binding, root, distance });
            }
          }
        }
        if (this.isOpaqueColorSurface(target)) break;
      }
    };

    sample(event.clientX, event.clientY);
    for (let y = -COLOR_PICK_RADIUS; y <= COLOR_PICK_RADIUS; y += COLOR_PICK_SAMPLE_STEP) {
      for (let x = -COLOR_PICK_RADIUS; x <= COLOR_PICK_RADIUS; x += COLOR_PICK_SAMPLE_STEP) {
        if (x * x + y * y > COLOR_PICK_RADIUS * COLOR_PICK_RADIUS) continue;
        if (x === 0 && y === 0) continue;
        sample(event.clientX + x, event.clientY + y);
      }
    }
    sample(event.clientX - COLOR_PICK_RADIUS, event.clientY);
    sample(event.clientX + COLOR_PICK_RADIUS, event.clientY);
    sample(event.clientX, event.clientY - COLOR_PICK_RADIUS);
    sample(event.clientX, event.clientY + COLOR_PICK_RADIUS);
    return [...candidateByToken.values()].sort((left, right) =>
      left.distance - right.distance ||
      left.binding.token.localeCompare(right.binding.token)
    );
  }

  bindPreviewPointerPicking() {
    if (this.previewPointerBound) return;
    const preview = this.services.byId("screen-preview");
    preview.addEventListener("pointerdown", this.previewPointerHandler, true);
    preview.addEventListener("pointermove", this.previewPointerMoveHandler);
    preview.addEventListener("pointerleave", this.previewPointerLeaveHandler);
    this.services.document
      .addEventListener("pointerdown", this.outsidePointerHandler, true);
    this.services.document.addEventListener("keydown", this.escapeHandler);
    this.previewPointerBound = true;
  }

  closeColorPopup() {
    this.colorPopup?.remove();
    this.colorPopup = null;
  }

  updateRadiusCursor(event) {
    const preview = this.services.byId("screen-preview");
    if (!this.state.viewingTheme || !preview.contains(event.target)) {
      this.hideRadiusCursor();
      return;
    }
    if (!this.radiusCursor) {
      this.radiusCursor = this.services.document.createElement("div");
      this.radiusCursor.className = "theme-color-radius-cursor";
      this.radiusCursor.setAttribute("aria-hidden", "true");
      this.radiusCursor.style.setProperty(
        "--theme-color-pick-radius",
        `${COLOR_PICK_RADIUS}px`
      );
      this.services.document.body.append(this.radiusCursor);
    }
    this.radiusCursor.style.left = `${event.clientX}px`;
    this.radiusCursor.style.top = `${event.clientY}px`;
    this.radiusCursor.classList.add("is-visible");
  }

  hideRadiusCursor() {
    this.radiusCursor?.classList.remove("is-visible");
  }

  closeColorPopupOutsidePreview(event) {
    const preview = this.services.byId("screen-preview");
    if (!preview.contains(event.target)) this.hideRadiusCursor();
    if (this.colorPopup?.contains(event.target) || preview.contains(event.target)) return;
    this.closeColorPopup();
  }

  updateThemeColor(token, mode, color, alpha) {
    const { state, services } = this;
    const hex = color.slice(1);
    const channels = [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    ];
    const value = alpha < 1
      ? `rgba(${channels.join(", ")}, ${alpha})`
      : color;
    if (state.theme.modes?.[mode]) {
      state.theme.modes[mode].tokens ||= {};
      state.theme.modes[mode].tokens[token] = value;
    } else {
      state.theme.tokens[token] = value;
    }
    services.applyTheme();
    services.markEdited(state.project.theme);
  }

  openColorPopup(event, candidates) {
    this.closeColorPopup();
    const { services } = this;
    const popup = services.element("div", "theme-color-picker-popover");
    popup.setAttribute("role", candidates.length ? "dialog" : "status");
    const title = candidates.length
      ? `Theme colors within a ${COLOR_PICK_DIAMETER}px circle`
      : `No Theme colors within a ${COLOR_PICK_DIAMETER}px circle`;
    popup.append(services.element("div", "theme-color-picker-title", title));
    const mode = this.getActiveMode();
    const tokens = this.getTokens(mode);
    for (const candidate of candidates) {
      const { binding, root, distance } = candidate;
      const tokenValue = tokens[binding.token];
      const color = tokenValue
        ? this.normalizeThemeColor(tokenValue, root)
        : null;
      const row = services.element("div", "theme-color-picker-candidate");
      const details = services.element("div", "theme-color-picker-candidate-details");
      details.append(
        services.element("div", "theme-color-picker-token", `--theme-${binding.token}`),
        services.element(
          "div",
          "theme-color-picker-source",
          `${binding.property} · ${this.describePreviewElement(binding.node)} · ~${Math.round(distance)}px`
        )
      );
      if (color) {
        const input = services.document.createElement("input");
        input.type = "color";
        input.value = color.hex;
        input.setAttribute("aria-label", `Edit Theme color ${binding.token}`);
        const update = () =>
          this.updateThemeColor(binding.token, mode, input.value, color.alpha);
        input.addEventListener("input", update);
        input.addEventListener("change", update);
        row.append(input, details);
      } else {
        row.append(services.element(
          "div",
          "theme-color-picker-unavailable",
          "—"
        ), details);
        details.append(services.element(
          "div",
          "theme-color-picker-source",
          "Not a single solid color."
        ));
      }
      popup.append(row);
    }

    const close = services.element("button", "theme-color-picker-close", "Close");
    close.type = "button";
    close.addEventListener("click", () => this.closeColorPopup());
    popup.append(close);
    this.colorPopup = popup;
    services.document.body.append(popup);
    const viewportWidth = services.document.documentElement.clientWidth;
    const viewportHeight = services.document.documentElement.clientHeight;
    popup.style.left = `${Math.max(8, Math.min(
      event.clientX + 14,
      viewportWidth - popup.offsetWidth - 8
    ))}px`;
    popup.style.top = `${Math.max(8, Math.min(
      event.clientY + 14,
      viewportHeight - popup.offsetHeight - 8
    ))}px`;
  }

  selectPreviewColor(event) {
    if (!this.state.viewingTheme || event.button !== 0) return;
    this.updateRadiusCursor(event);
    event.preventDefault();
    event.stopPropagation();
    const candidates = this.getNearbyColorBindings(event);
    this.openColorPopup(event, candidates);
  }

  getScreenTokenUses() {
    const screen = this.state.screens[this.state.activeScreenIndex];
    const usages = new Map();
    if (!screen) return usages;
    const visit = (instance, path) => {
      const placementLabel = `${instance.src
        ? this.state.materialFiles.get(instance.src)?.data.name || instance.src
        : "Group"} · ${instance.id || path.join(".")}`;
      if (Array.isArray(instance.children)) {
        for (const [index, child] of instance.children.entries()) {
          visit(child, [...path, index]);
        }
      } else {
        this.addMaterialUses(usages, instance, placementLabel);
      }
    };
    for (const [index, instance] of (screen.data.materials || []).entries()) {
      visit(instance, [index]);
    }
    return usages;
  }

  getMaterialTokenUses(path) {
    const definition = this.state.materialFiles.get(path);
    const usages = new Map();
    if (!definition) return usages;
    const defaults = Object.fromEntries(
      Object.entries(definition.data.attributes || {})
        .map(([name, attribute]) => [name, attribute.default])
    );
    this.addMaterialUses(usages, { src: path, attributes: defaults }, definition.data.name || path);
    return usages;
  }

  renderContextControls(panel) {
    const { state, services } = this;
    services.appendSection(panel, "Inspect");
    this.createSelect(
      panel,
      "Context",
      this.scope,
      [
        { value: "screen", label: "Screen" },
        { value: "material", label: "Reusable Material" }
      ],
      (value) => {
        this.closeColorPopup();
        this.scope = value;
        if (value === "material") {
          const options = this.getMaterialOptions();
          if (!options.some((option) => option.value === this.selectedMaterialPath)) {
            this.selectedMaterialPath = options[0]?.value || "";
          }
          if (this.selectedMaterialPath) {
            services.renderThemeMaterial(this.selectedMaterialPath);
          }
          services.renderInspector();
        } else {
          services.renderThemeScreen(state.activeScreenIndex)
            .catch(services.showFatalError);
        }
      }
    );
    if (this.scope === "screen") {
      const screens = state.screens.map((screen, index) => ({
        value: index,
        label: screen.data.name || screen.id
      }));
      this.createSelect(panel, "Screen", state.activeScreenIndex, screens, (value) => {
        this.closeColorPopup();
        services.renderThemeScreen(Number(value)).catch(services.showFatalError);
      });
      panel.append(services.element(
        "div",
        "theme-mode-note",
        "Click in the preview to see Theme colors within a 35px circle, nearest first. Preview clicks never select placements."
      ));
      return this.getScreenTokenUses();
    }

    const materialOptions = this.getMaterialOptions();
    if (!materialOptions.some((option) => option.value === this.selectedMaterialPath)) {
      this.selectedMaterialPath = materialOptions[0]?.value || "";
    }
    this.createSelect(
      panel,
      "Material",
      this.selectedMaterialPath,
      materialOptions,
      (value) => {
        this.closeColorPopup();
        this.selectedMaterialPath = value;
        services.renderThemeMaterial(value);
        services.renderInspector();
      }
    );
    if (materialOptions.length) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        "Click in the Material preview to see Theme colors within a 35px circle, nearest first."
      ));
    }
    if (!materialOptions.length) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        "This project has no reusable Materials."
      ));
    }
    return this.getMaterialTokenUses(this.selectedMaterialPath);
  }

  renderTokenField(panel, name, value, usages, activeMode) {
    const { state, services } = this;
    services.appendEditableField(panel, name, value, (updated) => {
      if (state.theme.modes?.[activeMode]) {
        state.theme.modes[activeMode].tokens ||= {};
        state.theme.modes[activeMode].tokens[name] = updated;
      } else {
        state.theme.tokens[name] = updated;
      }
      services.applyTheme();
      services.markEdited(state.project.theme);
    }, { color: /^#[0-9a-f]{6}$/i.test(String(value)) });
    const labels = [...(usages.get(name) || [])];
    if (labels.length) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Used by: ${labels.join(", ")}`
      ));
    }
  }

  renderDetails(panel) {
    const { state, services } = this;
    services.appendSection(panel, "Theme");
    const definedModes = this.getDefinedModes();
    services.appendSection(panel, "Appearance");
    const modeControls = services.element("div", "theme-mode-controls");
    const systemButton = services.element("button", "theme-mode-button", "System");
    systemButton.type = "button";
    systemButton.setAttribute("aria-pressed", String(state.themeModePreference === "system"));
    systemButton.addEventListener("click", () => {
      this.closeColorPopup();
      state.themeModePreference = "system";
      services.applyTheme();
      services.renderInspector();
    });
    modeControls.append(systemButton);
    for (const mode of state.themeModeNames) {
      if (definedModes.includes(mode)) {
        const button = services.element("button", "theme-mode-button", this.modeLabel(mode));
        button.type = "button";
        button.setAttribute("aria-pressed", String(state.themeModePreference === mode));
        button.addEventListener("click", () => {
          this.closeColorPopup();
          state.themeModePreference = mode;
          services.applyTheme();
          services.renderInspector();
        });
        modeControls.append(button);
      } else {
        const button = services.element(
          "button",
          "theme-mode-button theme-mode-add",
          `Add ${this.modeLabel(mode)}`
        );
        button.type = "button";
        button.addEventListener("click", () => this.addMode(mode));
        modeControls.append(button);
      }
    }
    panel.append(modeControls);
    const activeMode = this.getActiveMode();
    if (state.themeModePreference === "system" && definedModes.length &&
        !definedModes.includes(state.systemThemeMode)) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `System prefers ${this.modeLabel(state.systemThemeMode)}, but only ${this.modeLabel(activeMode)} is defined; using ${this.modeLabel(activeMode)}.`
      ));
    } else if (state.themeModePreference === "system") {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Using ${this.modeLabel(activeMode)} based on the system color scheme.`
      ));
    } else if (definedModes.length === 1) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Only ${this.modeLabel(activeMode)} is defined; it is used when either appearance is requested.`
      ));
    } else {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Showing ${this.modeLabel(activeMode)} in the Screen preview.`
      ));
    }

    const usages = this.renderContextControls(panel);
    const tokens = this.getTokens(activeMode);
    const usedTokenNames = [...usages.keys()].sort();
    services.appendSection(panel, `${this.modeLabel(activeMode)} tokens used in context`);
    if (usedTokenNames.length) {
      for (const name of usedTokenNames) {
        this.renderTokenField(panel, name, tokens[name] ?? "", usages, activeMode);
      }
    } else {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        "No Theme token references were detected in this context."
      ));
    }

    const otherTokenNames = Object.keys(tokens)
      .filter((name) => !usages.has(name))
      .sort();
    services.appendSection(panel, "Other Theme tokens");
    if (otherTokenNames.length) {
      for (const name of otherTokenNames) {
        this.renderTokenField(panel, name, tokens[name], usages, activeMode);
      }
    } else if (!Object.keys(tokens).length) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        "No tokens are defined for this appearance."
      ));
    } else {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        "All defined tokens are used in this context."
      ));
    }
  }

  addMode(mode) {
    const { state, services } = this;
    this.closeColorPopup();
    const sourceTokens = { ...this.getTokens() };
    state.theme.modes ||= {};
    if (Object.hasOwn(state.theme, "tokens")) {
      const lightMode = state.theme.modes.light || {};
      state.theme.modes.light = {
        ...lightMode,
        tokens: { ...state.theme.tokens, ...(lightMode.tokens || {}) }
      };
      delete state.theme.tokens;
    }
    state.theme.modes[mode] = { tokens: sourceTokens };
    state.themeModePreference = mode;
    services.applyTheme();
    services.markEdited(state.project.theme);
    services.renderInspector();
  }

  render(filePath = this.state.project?.theme) {
    const { state, services } = this;
    if (!state.theme) return;
    this.scope = "screen";
    this.closeColorPopup();
    this.bindPreviewPointerPicking();
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = filePath || state.project.theme;
    services.hidePreviewStateControls();
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
    state.previewVersion += 1;
    services.byId("main").classList.remove("material-editing");
    services.byId("main").classList.remove("spec-editing");
    services.byId("material-document-editor-panel").hidden = true;
    services.byId("material-document-source").oninput = null;
    services.byId("spec-editor-panel").hidden = true;
    services.byId("spec-source").oninput = null;
    state.viewingMaterialFile = false;
    state.viewingProject = false;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.activeSpecPath = null;
    state.activeSpecScreenFile = null;
    state.activeSpecInstancePath = [];
    state.activeInstancePath = [];
    services.clearPreviewSelection();
    state.viewingTheme = true;
    services.byId("breadcrumb").textContent = "Project theme";
    services.byId("screen-heading").textContent = "Theme";
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.renderInspector();
    services.renderThemeScreen(state.activeScreenIndex).catch(services.showFatalError);
  }
}
