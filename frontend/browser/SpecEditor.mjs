import { parseWorkflowSpecReferences } from "./WorkflowEditor.mjs";

function getReferenceKey(reference) {
  return reference?.href ||
    (reference?.workflowPath ? `${reference.workflowPath}?node=${reference.nodeId}` : null);
}

export class SpecEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.specValidationErrorFile = null;
    this.previewReferences = [];
    this.previewReferenceIndex = 0;
    this.previewQueue = Promise.resolve();
    this.previewVersion = 0;
    const sourceEditor = services.byId("spec-source");
    const sourceContainer = services.byId("spec-source-container");
    const sourceHighlight = services.byId("spec-source-highlight");
    if (sourceEditor && sourceContainer && sourceHighlight) {
      sourceEditor.addEventListener("scroll", () => {
        sourceHighlight.scrollTop = sourceEditor.scrollTop;
        sourceHighlight.scrollLeft = sourceEditor.scrollLeft;
      });
    }
    services.byId("spec-reference-previous").addEventListener("click", () =>
      this.movePreviewReference(-1)
    );
    services.byId("spec-reference-next").addEventListener("click", () =>
      this.movePreviewReference(1)
    );
  }

  async render(filePath, instancePath = this.state.activeInstancePath, owner = "instance") {
    const { state, services } = this;
    services.hidePreviewStateControls();
    services.validation.validateSpecPath(filePath);
    const screen = state.screens[state.activeScreenIndex];
    const draft = state.createdSpecDrafts.get(filePath);
    const isProjectSpec = owner === "project";
    const isScreenSpec = owner === "screen";
    state.activeProjectFilePath = filePath;
    const isScreenDraft = isScreenSpec && draft?.owner === "screen" && draft.screenFile === screen?.file;
    const instance = !isProjectSpec && !isScreenSpec && screen
      ? services.getInstanceAtPath(screen, instancePath)
      : null;
    const elementSpecOwner = state.elementSpecOwners.get(filePath);
    if (isProjectSpec) {
      if (state.project.spec !== filePath && draft?.owner !== "project") {
        throw new Error(`Behavior spec "${filePath}" is not attached to the project.`);
      }
    } else if (isScreenSpec) {
      if (!screen || (screen.data.spec !== filePath && !isScreenDraft)) {
        throw new Error(`Behavior spec "${filePath}" is not attached to the selected Screen.`);
      }
    } else if (!instance ||
        (draft?.owner !== "instance" &&
         (elementSpecOwner?.screenFile !== screen?.file ||
          !services.sameInstancePath(elementSpecOwner.instancePath, instancePath)))) {
      throw new Error(`Behavior spec "${filePath}" is not attached to the selected Element.`);
    }
    if (!state.specSources.has(filePath)) {
      state.specSources.set(filePath, await services.loadText(filePath));
    }
    if (state.viewingSpec && state.activeSpecPath !== filePath) {
      this.discardUneditedActiveDraft();
    }

    const main = services.byId("main");
    main.classList.remove("material-editing");
    main.classList.add("spec-editing");
    services.byId("material-document-editor-panel").hidden = true;
    services.byId("material-document-source").oninput = null;
    services.byId("spec-editor-panel").hidden = false;
    services.setSpecViewMode("split");
    state.viewingMaterialFile = false;
    state.viewingTheme = false;
    state.viewingProject = false;
    state.viewingPreviewState = false;
    state.viewingSpec = true;
    state.activeSpecPath = filePath;
    state.activeSpecOwner = owner;
    state.activeSpecScreenFile = isProjectSpec ? null : screen?.file || null;
    state.activeSpecInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
    state.activeInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
    this.updatePreviewFocus(null);
    this.renderSourceHighlight(null);
    services.hideEditorMessage();
    this.specValidationErrorFile = null;
    services.updateNavigationSelection();
    services.byId("screen-stage").setAttribute(
      "aria-label",
      isProjectSpec
        ? "Project overview linked to its behavior spec"
        : isScreenSpec
          ? "Screen preview linked to its behavior spec"
          : "Screen preview linked to the selected placement behavior spec"
    );
    services.byId("screen-heading").textContent = `Spec: ${filePath}`;
    services.byId("breadcrumb").textContent = "Behavior spec";
    services.byId("spec-editor-heading").textContent = filePath;
    const editor = services.byId("spec-source");
    editor.setAttribute("aria-label", `Markdown source for ${filePath}`);
    editor.value = state.specSources.get(filePath);
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    const sourceHighlight = services.byId("spec-source-highlight");
    if (sourceHighlight) {
      sourceHighlight.scrollTop = 0;
      sourceHighlight.scrollLeft = 0;
    }
    editor.disabled = state.isSaving;
    editor.oninput = () => this.handleSourceInput(filePath, editor.value);
    services.renderInspector();
    await this.setPreviewReferences(filePath, editor.value, true);
  }

  setPreviewReferences(filePath, source, reset = false) {
    const screenReferences = this.services.validation
      .parseSpecScreenReferences(source, filePath)
      .map((reference) => ({ ...reference, kind: "screen" }));
    const workflowReferences = parseWorkflowSpecReferences(source)
      .map((reference) => ({ ...reference, kind: "workflow" }));
    const references = [...screenReferences, ...workflowReferences]
      .sort((left, right) =>
        left.lineIndex - right.lineIndex || left.columnIndex - right.columnIndex
      );
    const activeKey = getReferenceKey(this.previewReferences[this.previewReferenceIndex]);
    this.previewReferences = references;
    if (reset) {
      this.previewReferenceIndex = 0;
    } else {
      const activeIndex = references.findIndex((reference) =>
        getReferenceKey(reference) === activeKey
      );
      this.previewReferenceIndex = activeIndex >= 0
        ? activeIndex
        : Math.min(this.previewReferenceIndex, Math.max(0, references.length - 1));
    }
    this.updateReferenceNavigation();
    return this.previewCurrentReference(filePath);
  }

  updateReferenceNavigation() {
    const { services } = this;
    const count = this.previewReferences.length;
    const active = this.state.viewingSpec && count > 0;
    services.byId("spec-reference-navigation").hidden = !active;
    services.byId("spec-reference-position").textContent = active
      ? `${this.previewReferenceIndex + 1} of ${count}`
      : "";
    services.byId("spec-reference-previous").disabled = !active || count < 2;
    services.byId("spec-reference-next").disabled = !active || count < 2;
  }

  movePreviewReference(offset) {
    if (this.previewReferences.length < 2) return;
    this.previewReferenceIndex =
      (this.previewReferenceIndex + offset + this.previewReferences.length) %
      this.previewReferences.length;
    this.updateReferenceNavigation();
    this.previewCurrentReference(this.state.activeSpecPath);
  }

  previewCurrentReference(filePath) {
    const { state, services } = this;
    const reference = this.previewReferences[this.previewReferenceIndex] || null;
    const version = ++this.previewVersion;
    this.previewQueue = this.previewQueue.then(async () => {
      if (version !== this.previewVersion ||
          !state.viewingSpec ||
          state.activeSpecPath !== filePath) return;
      this.renderSourceHighlight(reference);
      if (reference?.kind === "workflow") {
        this.updatePreviewFocus(null);
        await services.showSpecWorkflowReference(reference, filePath);
        return;
      }
      services.clearSpecWorkflowPreview();
      const instancePath = await services.showSpecReference(reference, filePath);
      if (version !== this.previewVersion ||
          !state.viewingSpec ||
          state.activeSpecPath !== filePath) return;
      this.updatePreviewFocus(instancePath);
      if (instancePath?.length) services.selectInstanceInPreview(instancePath);
    }).catch((error) => {
      if (version !== this.previewVersion || state.activeSpecPath !== filePath) return;
      services.showEditorMessage("Invalid SpecUX preview link", error.message || String(error));
      this.specValidationErrorFile = filePath;
    });
    return this.previewQueue;
  }

  renderSourceHighlight(reference) {
    const { state, services } = this;
    const highlight = services.byId("spec-source-highlight");
    if (!highlight) return;
    highlight.replaceChildren();
    if (!reference) return;

    const source = state.specSources.get(state.activeSpecPath) || "";
    const lines = source.split(/\r?\n/);
    const linkLine = lines[reference.lineIndex] || "";
    const link = [...linkLine.matchAll(
      /\[[^\]]*\]\(specux:\/\/[^)\s]+(?:\s+"[^"]*")?\)/g
    )].find((match) => match.index === reference.columnIndex);
    const sectionLine = reference.sectionLineIndex;
    const sectionHeading = lines[sectionLine]?.match(/^\s*(#{1,6})\s+.+?\s*#*\s*$/);
    let sectionStart = sectionHeading ? sectionLine : reference.lineIndex;
    let sectionEnd = sectionStart;
    if (sectionHeading) {
      const sectionLevel = sectionHeading[1].length;
      let codeFence = null;
      sectionEnd = lines.length - 1;
      for (let lineIndex = sectionLine + 1; lineIndex < lines.length; lineIndex += 1) {
        const fence = lines[lineIndex].match(/^\s*(`{3,}|~{3,})/);
        if (codeFence) {
          if (fence &&
              fence[1][0] === codeFence.character &&
              fence[1].length >= codeFence.length &&
              /^\s*$/.test(lines[lineIndex].slice(fence[0].length))) {
            codeFence = null;
          }
          continue;
        }
        if (fence) {
          codeFence = { character: fence[1][0], length: fence[1].length };
          continue;
        }
        const heading = lines[lineIndex].match(/^\s*(#{1,6})\s+.+?\s*#*\s*$/);
        if (heading && heading[1].length <= sectionLevel) {
          sectionEnd = lineIndex - 1;
          break;
        }
      }
    }
    const { ownerDocument } = highlight;

    lines.forEach((text, lineIndex) => {
      const line = ownerDocument.createElement("span");
      line.className = "workflow-spec-line";
      if (lineIndex >= sectionStart && lineIndex <= sectionEnd) {
        line.classList.add("workflow-spec-section-target");
      }

      if (lineIndex === reference.lineIndex && link) {
        const before = ownerDocument.createElement("span");
        before.textContent = text.slice(0, link.index);
        line.append(before);
        const target = ownerDocument.createElement("span");
        target.className = "workflow-spec-link-target";
        target.textContent = link[0];
        line.append(target);
        const after = ownerDocument.createElement("span");
        after.textContent = text.slice(link.index + link[0].length);
        line.append(after);
      } else {
        line.textContent = text;
      }
      highlight.append(line);
    });
  }

  updatePreviewFocus(instancePath) {
    const preview = this.services.byId("screen-preview");
    const instances = [];
    const visit = (root, parentInstance = null) => {
      for (const element of root.children || []) {
        const isInstance = element.classList?.contains("material-instance") === true ||
          element.classList?.contains("material-group") === true;
        if (isInstance) instances.push({ element, parentInstance });
        const nextParent = isInstance ? element : parentInstance;
        if (element.shadowRoot) visit(element.shadowRoot, nextParent);
        visit(element, nextParent);
      }
    };
    visit(preview);

    const focusPath = Array.isArray(instancePath) && instancePath.length
      ? JSON.stringify(instancePath)
      : null;
    const focusPrefix = focusPath?.slice(0, -1);
    const ancestorPaths = new Set();
    if (focusPath) {
      for (let length = 1; length < instancePath.length; length += 1) {
        ancestorPaths.add(JSON.stringify(instancePath.slice(0, length)));
      }
    }

    const dimmedBranches = new Set();
    for (const { element, parentInstance } of instances) {
      element.classList.remove(
        "spec-focus-target",
        "spec-focus-ancestor",
        "spec-focus-descendant",
        "spec-focus-dimmed"
      );
      element.style.removeProperty("filter");
      element.style.removeProperty("transition");
      element.style.removeProperty("z-index");
      if (!focusPath) continue;

      const path = element.dataset.instancePath;
      if (path === focusPath) {
        element.classList.add("spec-focus-target");
        element.style.setProperty("z-index", "1");
        element.style.setProperty("transition", "filter 180ms ease");
      } else if (ancestorPaths.has(path)) {
        element.classList.add("spec-focus-ancestor");
      } else if (focusPrefix && path.startsWith(`${focusPrefix},`)) {
        element.classList.add("spec-focus-descendant");
      } else if (!parentInstance || !dimmedBranches.has(parentInstance)) {
        element.classList.add("spec-focus-dimmed");
        element.style.setProperty("filter", "blur(1.5px)");
        element.style.setProperty("transition", "filter 180ms ease");
        dimmedBranches.add(element);
      }
    }
  }

  handleSourceInput(filePath, source) {
    const { state, services } = this;
    state.specSources.set(filePath, source);
    let elementSpecError = "";
    let referenceError = "";
    if (state.screens.some((entry) => filePath.startsWith(`screens/${entry.id}/specs/element-`))) {
      try {
        services.refreshElementSpecOwner(filePath, source);
      } catch (error) {
        elementSpecError = error.message || String(error);
      }
    }
    try {
      this.setPreviewReferences(filePath, source);
    } catch (error) {
      referenceError = error.message || String(error);
      this.renderSourceHighlight(null);
    }
    const pendingDraft = state.createdSpecDrafts.get(filePath);
    if (pendingDraft) {
      const draftScreen = state.screens.find((entry) => entry.file === pendingDraft.screenFile);
      if (source === pendingDraft.initialContent) {
        if (pendingDraft.owner === "project") {
          if (state.project.spec === filePath) delete state.project.spec;
        } else if (pendingDraft.owner === "screen") {
          if (draftScreen?.data.spec === filePath) delete draftScreen.data.spec;
        } else {
          state.elementSpecOwners.delete(filePath);
        }
        state.createdSpecFiles.delete(filePath);
        services.clearEdited(filePath);
        return;
      }
      if (pendingDraft.owner === "project") state.project.spec = filePath;
      else if (pendingDraft.owner === "screen" && draftScreen) draftScreen.data.spec = filePath;
      state.createdSpecFiles.add(filePath);
    }
    services.markEdited(filePath);
    if (elementSpecError) {
      services.showEditorMessage("Invalid behavior spec", elementSpecError);
      this.specValidationErrorFile = filePath;
    } else if (referenceError) {
      services.showEditorMessage("Invalid SpecUX preview link", referenceError);
      this.specValidationErrorFile = filePath;
    } else if (this.specValidationErrorFile === filePath) {
      services.hideEditorMessage();
      this.specValidationErrorFile = null;
    }
  }

  discardUneditedActiveDraft() {
    const { state, services } = this;
    if (!state.viewingSpec || !state.activeSpecPath) return;
    const filePath = state.activeSpecPath;
    const draft = state.createdSpecDrafts.get(filePath);
    if (!draft || state.createdSpecFiles.has(filePath) ||
        state.specSources.get(filePath) !== draft.initialContent) {
      return;
    }

    state.createdSpecDrafts.delete(filePath);
    state.createdSpecFiles.delete(filePath);
    state.specSources.delete(filePath);
    state.elementSpecOwners.delete(filePath);
    if (draft.owner === "project" && state.project.spec === filePath) {
      delete state.project.spec;
    } else if (draft.owner === "screen") {
      const screen = state.screens.find((entry) => entry.file === draft.screenFile);
      if (screen?.data.spec === filePath) delete screen.data.spec;
    }
    services.clearEdited(filePath);
    services.renderNavigation();
  }

  async createForInstance(instancePath) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const instance = screen && services.getInstanceAtPath(screen, instancePath);
    if (!screen || !instance) throw new Error("The selected Element is no longer available.");
    const linkedSpecPath = services.getElementSpecPath(screen, instance);
    if (linkedSpecPath) {
      await this.render(linkedSpecPath, instancePath);
      return;
    }
    const pendingDraft = [...state.createdSpecDrafts.entries()].find(([, draft]) =>
      draft.screenFile === screen.file && services.sameInstancePath(draft.instancePath, instancePath)
    );
    if (pendingDraft) {
      await this.render(pendingDraft[0], instancePath);
      return;
    }
    const filePath = `screens/${screen.id}/specs/element-${instance.id}.md`;
    services.validation.validateElementSpecPath(filePath, instance.id);
    if (state.specSources.has(filePath)) {
      throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Element.`);
    }
    const response = await services.fetcher(services.safeProjectUrl(filePath));
    if (response.status !== 404) {
      if (!response.ok) {
        throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
      }
      throw new Error(`Behavior spec "${filePath}" already exists but is not loaded.`);
    }
    const heading = services.getElementLabel(instance)
      .replace(/\r?\n/g, " ")
      .trim() || instance.id;
    const source = `# ${heading}\n\n[Referenced Element](specux://screen/${screen.id}/screen.yml?placement=${instance.id})\n\n## Purpose\n\nDescribe the behavior this Element is responsible for.\n\n## Requirements\n\n### Requirement: Perform the intended action\nThe system SHALL perform the intended behavior for this Element.\n\n#### Scenario: User interacts with this Element\n- **WHEN** the user interacts with this Element\n- **THEN** describe the expected observable outcome.\n`;
    state.specSources.set(filePath, source);
    state.createdSpecDrafts.set(filePath, {
      owner: "instance",
      initialContent: source,
      screenFile: screen.file,
      instancePath: [...instancePath]
    });
    services.projectFileTree.expandPath(filePath);
    services.renderNavigation();
    await this.render(filePath, instancePath);
  }

  async createForProject() {
    const { state, services } = this;
    if (state.project.spec) {
      await this.render(state.project.spec, [], "project");
      return;
    }
    const pendingDraft = [...state.createdSpecDrafts.entries()]
      .find(([, draft]) => draft.owner === "project");
    if (pendingDraft) {
      await this.render(pendingDraft[0], [], "project");
      return;
    }

    let filePath;
    for (let suffix = 1; ; suffix += 1) {
      const name = suffix === 1 ? "project-behavior" : `project-behavior-${suffix}`;
      filePath = `specs/${name}.md`;
      services.validation.validateSpecPath(filePath);
      if (state.specSources.has(filePath)) continue;
      const response = await services.fetcher(services.safeProjectUrl(filePath));
      if (response.status === 404) break;
      if (!response.ok) {
        throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
      }
    }
    const heading = typeof state.project.name === "string" && state.project.name.trim()
      ? state.project.name.replace(/\r?\n/g, " ").trim()
      : "Project behavior";
    const source = `# ${heading}\n\n## Purpose\n\nDescribe the behavior and constraints shared across this project.\n\n## Requirements\n\n### Requirement: Follow project-wide behavior\nThe system SHALL follow the behavior specified for this project.\n\n#### Scenario: A project-wide behavior applies\n- **WHEN** a user action is covered by this requirement\n- **THEN** the application follows the specified project-wide behavior.\n`;
    state.specSources.set(filePath, source);
    state.createdSpecDrafts.set(filePath, {
      owner: "project",
      initialContent: source,
      projectFile: "project.yml"
    });
    services.projectFileTree.expandPath(filePath);
    services.renderNavigation();
    await this.render(filePath, [], "project");
  }

  async createForScreen() {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    if (!screen) throw new Error("The selected Screen is no longer available.");
    if (screen.data.spec) {
      await this.render(screen.data.spec, [], "screen");
      return;
    }
    const pendingDraft = [...state.createdSpecDrafts.entries()].find(([, draft]) =>
      draft.owner === "screen" && draft.screenFile === screen.file
    );
    if (pendingDraft) {
      await this.render(pendingDraft[0], [], "screen");
      return;
    }

    const filePath = `screens/${screen.id}/specs/screen.md`;
    services.validation.validateSpecPath(filePath);
    if (state.specSources.has(filePath)) {
      throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Screen.`);
    }
    const response = await services.fetcher(services.safeProjectUrl(filePath));
    if (response.status !== 404) {
      if (!response.ok) {
        throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
      }
      throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Screen.`);
    }
    const heading = (screen.data.name || screen.id).replace(/\r?\n/g, " ").trim();
    const states = services.getScreenPreviewStates(screen.data)
      .filter((state) => state.id !== "default");
    const scenarios = states.length ? states.map((state) => [
      `#### Scenario: ${state.name.replace(/\r?\n/g, " ").trim() || state.id} is active`,
      `- **WHEN** the condition for ${state.id} occurs`,
      "- **THEN** the Screen reflects that condition.",
      `- **SHOW** ${state.id}`
    ].join("\n")).join("\n\n") : [
      "#### Scenario: The Screen is displayed",
      "- **WHEN** the user navigates to this Screen",
      "- **THEN** the Screen is displayed."
    ].join("\n");
    const previewLinks = [
      `[${heading} Screen](specux://screen/${screen.id}/screen.yml)`,
      ...states.map((previewState) =>
        `[${previewState.name}](specux://screen/${screen.id}/screen.yml?state=${previewState.id})`
      )
    ].join("\n");
    const source = `# ${heading} behavior\n\n${previewLinks}\n\n## Purpose\n\nDescribe when this Screen's named visual states become active.\n\n## Requirements\n\n### Requirement: Show the matching preview state\nThe Screen SHALL show each named preview state when its activation condition is met.\n\n${scenarios}\n`;
    state.specSources.set(filePath, source);
    state.createdSpecDrafts.set(filePath, {
      owner: "screen",
      initialContent: source,
      screenFile: screen.file
    });
    services.projectFileTree.expandPath(filePath);
    services.renderNavigation();
    await this.render(filePath, [], "screen");
  }
}
