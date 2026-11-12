import {
  findMarkdownSpecLink,
  getMarkdownSectionRange,
  parseWorkflowSpecReferences
} from "./WorkflowEditor.mjs";
import { getScreenPlacementIdPath } from "../../shared/ScreenGroups.mjs";

/** Returns the reference key. */
function getReferenceKey(reference) {
  return reference?.href ||
    (reference?.workflowPath ? `${reference.workflowPath}?node=${reference.nodeId}` : null);
}

/** Resolves one instance and its dot-separated placement reference path. */
function getInstanceSpecTarget(services, screen, instancePath) {
  if (!screen) return null;
  const instance = services.getInstanceAtPath(screen, instancePath);
  const placementIdPath = getScreenPlacementIdPath(
    screen.data.materials || [],
    instancePath
  )?.join(".");
  return instance && placementIdPath ? { instance, placementIdPath } : null;
}

/** Returns the text currently selected in the editor. */
export function getSelectedText(source, selectionStart, selectionEnd) {
  if (typeof source !== "string" ||
      !Number.isInteger(selectionStart) ||
      !Number.isInteger(selectionEnd) ||
      selectionStart < 0 ||
      selectionEnd <= selectionStart ||
      selectionEnd > source.length) {
    return null;
  }

  /** Updates the at for the current editor state. */
  const positionAt = (offset) => {
    const before = source.slice(0, offset);
    const lineBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
    return {
      line: before.split(/\r\n|\r|\n/).length,
      column: offset - lineBreak
    };
  };
  return {
    type: "text",
    text: source.slice(selectionStart, selectionEnd),
    range: {
      start: positionAt(selectionStart),
      end: positionAt(selectionEnd)
    }
  };
}

/** Manages behavior and Element spec editing and preview interaction. */
export class SpecEditor {

  /** Stores the injected collaborators and initializes the instance state. */
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
        if (sourceHighlight.scrollTop !== sourceEditor.scrollTop) {
          sourceHighlight.scrollTop = sourceEditor.scrollTop;
        }
        if (sourceHighlight.scrollLeft !== sourceEditor.scrollLeft) {
          sourceHighlight.scrollLeft = sourceEditor.scrollLeft;
        }
      });
      sourceHighlight.addEventListener("scroll", () => {
        if (sourceEditor.scrollTop !== sourceHighlight.scrollTop) {
          sourceEditor.scrollTop = sourceHighlight.scrollTop;
        }
        if (sourceEditor.scrollLeft !== sourceHighlight.scrollLeft) {
          sourceEditor.scrollLeft = sourceHighlight.scrollLeft;
        }
      });
    }
    if (sourceEditor) {

      /** Publishes the text selection for the current editor state. */
      const publishTextSelection = () => {
        if (this.state.viewingSpec) this.services.publishSelection();
      };
      sourceEditor.addEventListener("select", publishTextSelection);
      sourceEditor.addEventListener("keyup", publishTextSelection);
      sourceEditor.addEventListener("mouseup", publishTextSelection);
      sourceEditor.addEventListener("input", publishTextSelection);
      sourceEditor.addEventListener("blur", () => {
        if (!this.state.viewingSpec) return;
        this.renderSourceHighlight(
          this.previewReferences[this.previewReferenceIndex] || null,
          true
        );
        this.services.publishSelection();
      });
    }
    services.byId("spec-reference-previous").addEventListener("click", () =>
      this.movePreviewReference(-1)
    );
    services.byId("spec-reference-next").addEventListener("click", () =>
      this.movePreviewReference(1)
    );
  }

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  async render(filePath, instancePath = this.state.activeInstancePath, owner = "instance") {
    const { state, services } = this;
    services.hidePreviewStateControls();
    services.validation.validateSpecPath(filePath);
    const context = this.getSpecRenderContext(filePath, instancePath, owner);
    state.activeProjectFilePath = filePath;
    if (!state.specSources.has(filePath)) {
      state.specSources.set(filePath, await services.loadText(filePath));
    }
    if (state.viewingSpec && state.activeSpecPath !== filePath) {
      this.discardUneditedActiveDraft();
    }

    this.configureSpecView(context);
    this.renderSpecSource(context);
    services.publishSelection();
    services.renderInspector();
    await this.setPreviewReferences(filePath, services.byId("spec-source").value, true);
  }

  /** Returns the spec render context. */
  getSpecRenderContext(filePath, instancePath, owner) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const draft = state.createdSpecDrafts.get(filePath);
    const isProjectSpec = owner === "project";
    const isScreenSpec = owner === "screen";
    const instance = !isProjectSpec && !isScreenSpec && screen
      ? services.getInstanceAtPath(screen, instancePath)
      : null;
    const elementSpecOwner = state.elementSpecOwners.get(filePath);
    this.validateSpecAttachment(filePath, owner, screen, draft, instance, elementSpecOwner, instancePath);
    return {
      filePath,
      screen,
      instancePath,
      isProjectSpec,
      isScreenSpec,
      owner
    };
  }

  /** Validates the spec attachment before it is applied or saved. */
  validateSpecAttachment(filePath, owner, screen, draft, instance, elementSpecOwner, instancePath) {
    if (owner === "project") {
      if (this.state.project.spec !== filePath && draft?.owner !== "project") {
        throw new Error(`Behavior spec "${filePath}" is not attached to the project.`);
      }
      return;
    }
    if (owner === "screen") {
      const isScreenDraft = draft?.owner === "screen" && draft.screenFile === screen?.file;
      if (!screen || (screen.data.spec !== filePath && !isScreenDraft)) {
        throw new Error(`Behavior spec "${filePath}" is not attached to the selected Screen.`);
      }
      return;
    }
    if (!this.isElementSpecAttached(filePath, screen, draft, instance, elementSpecOwner, instancePath)) {
      throw new Error(`Behavior spec "${filePath}" is not attached to the selected Element.`);
    }
  }

  /** Checks whether the Element spec is attached to the current Screen. */
  isElementSpecAttached(filePath, screen, draft, instance, elementSpecOwner, instancePath) {
    if (!instance || draft?.owner === "instance") return Boolean(instance);
    return elementSpecOwner?.screenFile === screen?.file &&
      this.services.sameInstancePath(elementSpecOwner.instancePath, instancePath);
  }

  /** Updates the spec view for the current editor state. */
  configureSpecView(context) {
    const { state, services } = this;
    const { filePath, screen, instancePath, isProjectSpec, isScreenSpec, owner } = context;
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
  }

  /** Renders the spec source from the current editor data. */
  renderSpecSource({ filePath }) {
    const { state, services } = this;
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
  }

  /** Sets the preview references from the supplied data. */
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

  /** Updates the reference navigation to reflect the latest editor state. */
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

  /** Moves the preview reference for the current editor state. */
  movePreviewReference(offset) {
    if (this.previewReferences.length < 2) return;
    this.previewReferenceIndex =
      (this.previewReferenceIndex + offset + this.previewReferences.length) %
      this.previewReferences.length;
    this.updateReferenceNavigation();
    this.previewCurrentReference(this.state.activeSpecPath);
  }

  /** Updates the current reference for the current editor state. */
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

  /** Renders the source highlight from the current editor data. */
  renderSourceHighlight(reference, preserveSelection = false) {
    const highlight = this.services.byId("spec-source-highlight");
    if (!highlight) return;
    const context = this.getSourceHighlightContext(reference, preserveSelection, highlight);
    highlight.replaceChildren();
    this.renderHighlightedLines(highlight, context);
    if (preserveSelection) this.restoreHighlightScroll(highlight, context);
  }

  /** Returns the source highlight context. */
  getSourceHighlightContext(reference, preserveSelection, highlight) {
    const sourceEditor = this.services.byId("spec-source");
    const storedSource = this.state.specSources.get(this.state.activeSpecPath) || "";
    const source = preserveSelection && sourceEditor ? sourceEditor.value : storedSource;
    const selection = this.getHighlightSelection(sourceEditor, source, preserveSelection);
    const link = this.getHighlightLink(reference, source.split(/\r?\n/));
    const scroll = this.getHighlightScroll(sourceEditor, highlight, preserveSelection);
    return {
      source,
      lines: source.split(/\r?\n/),
      reference,
      link,
      sectionRange: reference
        ? getMarkdownSectionRange(source, reference.sectionLineIndex, reference.lineIndex)
        : null,
      ...selection,
      ownerDocument: highlight.ownerDocument,
      ...scroll
    };
  }

  /** Returns the highlight selection. */
  getHighlightSelection(sourceEditor, source, preserveSelection) {
    const selectionStart = preserveSelection && Number.isInteger(sourceEditor?.selectionStart)
      ? sourceEditor.selectionStart : -1;
    const selectionEnd = preserveSelection && Number.isInteger(sourceEditor?.selectionEnd)
      ? sourceEditor.selectionEnd : -1;
    return {
      selectionStart,
      selectionEnd,
      hasSelection: selectionStart >= 0 && selectionEnd > selectionStart &&
        selectionEnd <= source.length
    };
  }

  /** Returns the highlight link. */
  getHighlightLink(reference, lines) {
    if (!reference) return null;
    const linkLine = lines[reference.lineIndex] || "";
    return findMarkdownSpecLink(linkLine, reference.columnIndex);
  }

  /** Returns the highlight scroll. */
  getHighlightScroll(sourceEditor, highlight, preserveSelection) {
    return {
      scrollTop: preserveSelection && Number.isFinite(sourceEditor?.scrollTop)
        ? sourceEditor.scrollTop : highlight.scrollTop,
      scrollLeft: preserveSelection && Number.isFinite(sourceEditor?.scrollLeft)
        ? sourceEditor.scrollLeft : highlight.scrollLeft
    };
  }

  /** Renders the highlighted lines from the current editor data. */
  renderHighlightedLines(highlight, context) {
    let lineOffset = 0;
    context.lines.forEach((text, lineIndex) => {
      this.renderHighlightedLine(highlight, context, text, lineIndex, lineOffset);
      const lineEnd = lineOffset + text.length;
      const separator = context.source.slice(lineEnd).match(/^\r\n|^\r|\n/)?.[0] || "";
      lineOffset = lineEnd + separator.length;
    });
  }

  /** Renders the highlighted line from the current editor data. */
  renderHighlightedLine(highlight, context, text, lineIndex, lineOffset) {
    const { ownerDocument, reference, link, sectionRange } = context;
    const line = ownerDocument.createElement("span");
    line.className = "workflow-spec-line";
    if (sectionRange && lineIndex >= sectionRange.start && lineIndex <= sectionRange.end) {
      line.classList.add("workflow-spec-section-target");
    }
    const linkRange = lineIndex === reference?.lineIndex && link
      ? { start: link.index, end: link.index + link[0].length } : null;
    const selectedOnLine = context.hasSelection &&
      context.selectionStart < lineOffset + text.length &&
      context.selectionEnd > lineOffset;
    if (selectedOnLine) {
      this.appendTextSegments(line, text, lineOffset, linkRange, context);
    } else if (linkRange) {
      this.appendLinkSegments(line, text, linkRange, ownerDocument);
    } else {
      line.textContent = text;
    }
    highlight.append(line);
  }

  /** Adds the text segments for the current editor state. */
  appendTextSegments(line, text, lineOffset, linkRange, context) {
    const { selectionStart, selectionEnd, hasSelection, ownerDocument } = context;
    const boundaries = [0, text.length];
    if (hasSelection) {
      for (const offset of [selectionStart, selectionEnd]) {
        if (offset > lineOffset && offset < lineOffset + text.length) {
          boundaries.push(offset - lineOffset);
        }
      }
    }
    if (linkRange) boundaries.push(linkRange.start, linkRange.end);
    boundaries.sort((left, right) => left - right);
    const uniqueBoundaries = [...new Set(boundaries)];
    for (let index = 0; index < uniqueBoundaries.length - 1; index += 1) {
      const start = uniqueBoundaries[index];
      const end = uniqueBoundaries[index + 1];
      const segment = ownerDocument.createElement("span");
      segment.className = this.getTextSegmentClasses(
        start,
        end,
        lineOffset,
        linkRange,
        selectionStart,
        selectionEnd
      );
      segment.textContent = text.slice(start, end);
      line.append(segment);
    }
  }

  /** Returns the source-highlight classes for a segment of selected text. */
  getTextSegmentClasses(start, end, lineOffset, linkRange, selectionStart, selectionEnd) {
    const classes = [];
    if (linkRange && start >= linkRange.start && end <= linkRange.end) {
      classes.push("workflow-spec-link-target");
    }
    if (selectionStart < lineOffset + end && selectionEnd > lineOffset + start) {
      classes.push("spec-source-text-selection");
    }
    return classes.join(" ");
  }

  /** Adds the link segments for the current editor state. */
  appendLinkSegments(line, text, linkRange, ownerDocument) {
    const before = ownerDocument.createElement("span");
    before.textContent = text.slice(0, linkRange.start);
    line.append(before);
    const target = ownerDocument.createElement("span");
    target.className = "workflow-spec-link-target";
    target.textContent = text.slice(linkRange.start, linkRange.end);
    line.append(target);
    const after = ownerDocument.createElement("span");
    after.textContent = text.slice(linkRange.end);
    line.append(after);
  }

  /** Restores the highlight scroll for the current editor state. */
  restoreHighlightScroll(highlight, context) {
    highlight.scrollTop = context.scrollTop;
    highlight.scrollLeft = context.scrollLeft;
  }

  /** Highlights the selected preview branch and dims unrelated branches. */
  updatePreviewFocus(instancePath) {
    const preview = this.services.byId("screen-preview");
    const instances = [];
    this.collectPreviewInstances(preview, null, instances);
    const focus = this.getPreviewFocusContext(instancePath, instances);
    const dimmedBranches = new Set();
    for (const { element, parentInstance } of instances) {
      this.resetPreviewFocus(element);
      this.applyPreviewFocus(element, parentInstance, focus, dimmedBranches);
    }
  }

  /** Collects the preview instances for the current editor state. */
  collectPreviewInstances(root, parentInstance, instances) {
    for (const element of root.children || []) {
      const isInstance = element.classList?.contains("material-instance") === true ||
        element.classList?.contains("material-group") === true;
      if (isInstance) instances.push({ element, parentInstance });
      const nextParent = isInstance ? element : parentInstance;
      if (element.shadowRoot) this.collectPreviewInstances(element.shadowRoot, nextParent, instances);
      this.collectPreviewInstances(element, nextParent, instances);
    }
  }

  /** Returns the preview instance paths affected by the current spec focus. */
  getPreviewFocusContext(instancePath, instances) {
    const focusPath = Array.isArray(instancePath) && instancePath.length
      ? JSON.stringify(instancePath)
      : null;
    const ancestorPaths = new Set();
    if (focusPath) {
      for (let length = 1; length < instancePath.length; length += 1) {
        ancestorPaths.add(JSON.stringify(instancePath.slice(0, length)));
      }
    }
    const focusTarget = focusPath
      ? instances.find(({ element }) => element.dataset.instancePath === focusPath)?.element
      : null;
    return {
      focusPath,
      focusPrefix: focusPath?.slice(0, -1),
      ancestorPaths,
      focusBounds: focusTarget?.getBoundingClientRect?.(),
      isInsideFocusArea: (element) => this.isInsideFocusArea(element, focusTarget)
    };
  }

  /** Checks whether the point falls within the preview focus area. */
  isInsideFocusArea(element, focusTarget) {
    const focusBounds = focusTarget?.getBoundingClientRect?.();
    if (!focusBounds) return false;
    const bounds = element.getBoundingClientRect?.();
    return bounds && bounds.left >= focusBounds.left && bounds.top >= focusBounds.top &&
      bounds.right <= focusBounds.right && bounds.bottom <= focusBounds.bottom;
  }

  /** Resets the preview focus for the current editor state. */
  resetPreviewFocus(element) {
    element.classList.remove(
      "spec-focus-target",
      "spec-focus-ancestor",
      "spec-focus-descendant",
      "spec-focus-dimmed"
    );
    element.style.removeProperty("filter");
    element.style.removeProperty("transition");
    element.style.removeProperty("z-index");
  }

  /** Applies the preview focus to the current editor state. */
  applyPreviewFocus(element, parentInstance, focus, dimmedBranches) {
    if (!focus.focusPath) return;
    const path = element.dataset.instancePath;
    if (path === focus.focusPath) {
      element.classList.add("spec-focus-target");
      element.style.setProperty("z-index", "1");
      element.style.setProperty("transition", "filter 180ms ease");
    } else if (focus.ancestorPaths.has(path)) {
      element.classList.add("spec-focus-ancestor");
    } else if (focus.focusPrefix && path.startsWith(`${focus.focusPrefix},`)) {
      element.classList.add("spec-focus-descendant");
    } else if (!focus.isInsideFocusArea(element) &&
        (!parentInstance || !dimmedBranches.has(parentInstance))) {
      this.markPreviewFocusDimmed(element, dimmedBranches);
    }
  }

  /** Marks the preview focus dimmed for the current editor state. */
  markPreviewFocusDimmed(element, dimmedBranches) {
    element.classList.add("spec-focus-dimmed");
    element.style.setProperty("filter", "blur(1.5px)");
    element.style.setProperty("transition", "filter 180ms ease");
    dimmedBranches.add(element);
  }

  /** Handles source input events and applies the corresponding editor action. */
  handleSourceInput(filePath, source) {
    const { state, services } = this;
    state.specSources.set(filePath, source);
    const elementSpecError = this.validateEditedElementSpec(filePath, source);
    const referenceError = this.refreshEditedSpecReferences(filePath, source);
    if (this.updatePendingDraft(filePath, source)) return;
    services.markEdited(filePath);
    this.showSpecInputError(filePath, elementSpecError, referenceError);
  }

  /** Validates the edited element spec before it is applied or saved. */
  validateEditedElementSpec(filePath, source) {
    const isElementSpec = this.state.screens.some((entry) =>
      filePath.startsWith(`screens/${entry.id}/specs/element-`)
    );
    if (!isElementSpec) return "";
    try {
      this.services.refreshElementSpecOwner(filePath, source);
      return "";
    } catch (error) {
      return error.message || String(error);
    }
  }

  /** Updates the edited spec references for the current editor state. */
  refreshEditedSpecReferences(filePath, source) {
    try {
      this.setPreviewReferences(filePath, source);
      return "";
    } catch (error) {
      this.renderSourceHighlight(null);
      return error.message || String(error);
    }
  }

  /** Updates the pending draft to reflect the latest editor state. */
  updatePendingDraft(filePath, source) {
    const { state, services } = this;
    const pendingDraft = state.createdSpecDrafts.get(filePath);
    if (!pendingDraft) return false;
    const draftScreen = state.screens.find((entry) => entry.file === pendingDraft.screenFile);
    if (source === pendingDraft.initialContent) {
      this.unlinkPendingDraft(filePath, pendingDraft, draftScreen);
      services.clearEdited(filePath);
      return true;
    }
    if (pendingDraft.owner === "project") state.project.spec = filePath;
    else if (pendingDraft.owner === "screen" && draftScreen) draftScreen.data.spec = filePath;
    state.createdSpecFiles.add(filePath);
    return false;
  }

  /** Updates the pending draft for the current editor state. */
  unlinkPendingDraft(filePath, draft, draftScreen) {
    const { state } = this;
    if (draft.owner === "project") {
      if (state.project.spec === filePath) delete state.project.spec;
    } else if (draft.owner === "screen") {
      if (draftScreen?.data.spec === filePath) delete draftScreen.data.spec;
    } else {
      state.elementSpecOwners.delete(filePath);
    }
    state.createdSpecFiles.delete(filePath);
  }

  /** Shows the spec input error for the current editor state. */
  showSpecInputError(filePath, elementSpecError, referenceError) {
    const { services } = this;
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

  /** Updates the unedited active draft for the current editor state. */
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

  /** Builds the Element spec draft and ownership data for one Screen instance. */
  async createForInstance(instancePath) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const target = getInstanceSpecTarget(services, screen, instancePath);
    if (!screen || !target) throw new Error("The selected Element is no longer available.");
    const { instance, placementIdPath } = target;
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
    const source = `# ${heading}\n\n[Referenced Element](specux://screen/${screen.id}/screen.yml?placement=${placementIdPath})\n\n## Purpose\n\nDescribe the behavior this Element is responsible for.\n\n## Requirements\n\n### Requirement: Perform the intended action\nThe system SHALL perform the intended behavior for this Element.\n\n#### Scenario: User interacts with this Element\n- **WHEN** the user interacts with this Element\n- **THEN** describe the expected observable outcome.\n`;
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

  /** Builds a project-level behavior spec draft with its initial source. */
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

  /** Builds the Screen-level spec draft and associates it with the selected Screen. */
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
    const source = `# ${heading} behavior\n\n${previewLinks}\n\n## Purpose\n\nDescribe when this Screen's named visual states become active.\n\n## Requirements\n\n### Requirement: Show the matching Screen State\nThe Screen SHALL show each named Screen State when its activation condition is met.\n\n${scenarios}\n`;
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
