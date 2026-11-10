/** Returns the source range for the Markdown section containing a link. */
export function getMarkdownSectionRange(source, sectionLineIndex, fallbackLineIndex) {
  const lines = source.split(/\r?\n/);
  const sectionHeading = lines[sectionLineIndex]?.match(/^\s*(#{1,6})\s+.+?\s*#*\s*$/);
  if (!sectionHeading) {
    return { start: fallbackLineIndex, end: fallbackLineIndex };
  }

  const sectionLevel = sectionHeading[1].length;
  let codeFence = null;
  let end = lines.length - 1;
  for (let lineIndex = sectionLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const fence = lines[lineIndex].match(/^\s*(`{3,}|~{3,})/);
    if (advanceMarkdownCodeFence(codeFence, fence, lines[lineIndex])) {
      if (isMarkdownCodeFenceClosed(codeFence, fence, lines[lineIndex])) codeFence = null;
      else if (!codeFence && fence) codeFence = createCodeFence(fence);
      continue;
    }
    const heading = lines[lineIndex].match(/^\s*(#{1,6})\s+.+?\s*#*\s*$/);
    if (heading && heading[1].length <= sectionLevel) {
      end = lineIndex - 1;
      break;
    }
  }
  return { start: sectionLineIndex, end };
}

/** Updates the markdown code fence for the current editor state. */
function advanceMarkdownCodeFence(codeFence, fence, line) {
  return Boolean(codeFence || fence);
}

/** Checks whether the current Markdown code fence has a matching closing line. */
function isMarkdownCodeFenceClosed(codeFence, fence, line) {
  return Boolean(codeFence && fence &&
    fence[1][0] === codeFence.character &&
    fence[1].length >= codeFence.length &&
    /^\s*$/.test(line.slice(fence[0].length)));
}

/** Returns the Markdown code-fence state for the current source line. */
function createCodeFence(fence) {
  return { character: fence[1][0], length: fence[1].length };
}

/** Finds the markdown spec link in the current project data. */
export function findMarkdownSpecLink(line, columnIndex) {
  return [...line.matchAll(
    /\[[^\]]*\]\(specux:\/\/[^)\s]+(?:\s+"[^"]*")?\)/g
  )].find((match) => match.index === columnIndex) || null;
}

/** Parses the workflow link into structured editor data. */
export function parseWorkflowLink(href) {
  const url = getRequiredWorkflowUrl(href);
  const pathSegments = getRequiredDecodedPath(url, href);
  validateWorkflowScreenPath(pathSegments, href);
  validateWorkflowQueryParameters(url, href);
  const placementId = url.searchParams.get("placement");
  const stateId = url.searchParams.get("state") ?? "default";
  if (!isValidWorkflowId(placementId) && placementId !== null ||
      !isValidWorkflowId(stateId)) {
    throw new Error(`Invalid placement or Screen State in workflow link "${href}".`);
  }
  return {
    screenId: pathSegments[0],
    placementId,
    stateId
  };
}

/** Returns the required workflow url. */
function getRequiredWorkflowUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    throw new Error(`Invalid workflow link "${href}".`);
  }
  if (isInvalidWorkflowUrl(url)) throw new Error(`Invalid workflow link "${href}".`);
  return url;
}

/** Checks whether a workflow URL fails the supported local-link rules. */
function isInvalidWorkflowUrl(url) {
  return url.protocol !== "specux:" || url.hostname !== "screen" ||
    Boolean(url.username || url.password || url.port || url.hash);
}

/** Returns the required decoded path. */
function getRequiredDecodedPath(url, href) {
  try {
    return url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new Error(`Invalid workflow link path "${href}".`);
  }
}

/** Checks whether the value is a supported workflow node ID. */
function isValidWorkflowId(id) {
  return typeof id === "string" && /^[a-z][a-z0-9-]*$/.test(id);
}

/** Validates the workflow screen path before it is applied or saved. */
function validateWorkflowScreenPath(pathSegments, href) {
  if (pathSegments.length === 2 &&
      isValidWorkflowId(pathSegments[0]) &&
      pathSegments[1] === "screen.yml") return;
  throw new Error(`Workflow link path must be screen/<screen-id>/screen.yml: "${href}".`);
}

/** Validates the workflow query parameters before it is applied or saved. */
function validateWorkflowQueryParameters(url, href) {
  const queryEntries = [...url.searchParams.entries()];
  const hasUnsupportedKey = queryEntries.some(([key]) => !["placement", "state"].includes(key));
  const hasDuplicateKey = ["placement", "state"].some((key) =>
    url.searchParams.getAll(key).length > 1
  );
  if (hasUnsupportedKey || hasDuplicateKey) {
    throw new Error(
      `Workflow links support one placement and one state query parameter: "${href}".`
    );
  }
}

/** Parses the workflow spec reference into structured editor data. */
export function parseWorkflowSpecReference(href, workflowPath = null) {
  const url = getOptionalWorkflowUrl(href);
  if (!url) return null;
  const pathSegments = getOptionalDecodedPath(url);
  if (!pathSegments) return null;
  if (pathSegments[1] !== "workflows") return null;
  if (pathSegments.length !== 3 ||
      !isValidWorkflowId(pathSegments[0]) ||
      !/^[a-z][a-z0-9-]*\.mmd$/.test(pathSegments[2])) {
    throw new Error(`Invalid Screen workflow link in behavior spec: "${href}".`);
  }
  const targetWorkflowPath =
    `screens/${pathSegments[0]}/workflows/${pathSegments[2]}`;
  if (workflowPath && targetWorkflowPath !== workflowPath) return null;
  validateWorkflowNodeQuery(url, href);
  const nodeId = url.searchParams.get("node");
  return workflowPath ? { nodeId } : { workflowPath: targetWorkflowPath, nodeId };
}

/** Returns the optional workflow url. */
function getOptionalWorkflowUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return isInvalidWorkflowUrl(url) ? null : url;
}

/** Returns the optional decoded path. */
function getOptionalDecodedPath(url) {
  try {
    return url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Validates the workflow node query before it is applied or saved. */
function validateWorkflowNodeQuery(url, href) {
  const queryEntries = [...url.searchParams.entries()];
  const isValidNode = /^[A-Za-z][A-Za-z0-9_-]*$/.test(url.searchParams.get("node") || "");
  if (queryEntries.length !== 1 ||
      queryEntries.some(([key]) => key !== "node") ||
      url.searchParams.getAll("node").length !== 1 ||
      !isValidNode) {
    throw new Error(
      `Workflow links in behavior specs must include one valid node parameter: "${href}".`
    );
  }
}

/** Parses the workflow spec references into structured editor data. */
export function parseWorkflowSpecReferences(source, workflowPath = null) {
  const references = [];
  const context = { references, headings: [], codeFence: null, workflowPath };
  for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
    processWorkflowSpecLine(line, lineIndex, context);
  }
  return references;
}

/** Updates the workflow spec line for the current editor state. */
function processWorkflowSpecLine(line, lineIndex, context) {
  if (advanceWorkflowCodeFence(context, line)) return;
  updateWorkflowHeadings(line, lineIndex, context.headings);
  collectWorkflowSpecLineReferences(line, lineIndex, context);
}

/** Updates the workflow code fence for the current editor state. */
function advanceWorkflowCodeFence(context, line) {
  const fence = line.match(/^\s*(`{3,}|~{3,})/);
  if (!context.codeFence && !fence) return false;
  if (isMarkdownCodeFenceClosed(context.codeFence, fence, line)) {
    context.codeFence = null;
  } else if (!context.codeFence && fence) {
    context.codeFence = createCodeFence(fence);
  }
  return true;
}

/** Updates the workflow headings to reflect the latest editor state. */
function updateWorkflowHeadings(line, lineIndex, headings) {
  const heading = line.match(/^\s*(#{1,6})\s+.+?\s*#*\s*$/);
  if (!heading) return;
  const level = heading[1].length;
  while (headings.length && headings[headings.length - 1].level >= level) {
    headings.pop();
  }
  headings.push({ level, lineIndex });
}

/** Collects the workflow spec line references for the current editor state. */
function collectWorkflowSpecLineReferences(line, lineIndex, context) {
  const markdownLink = /\[[^\]]*\]\((specux:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of line.matchAll(markdownLink)) {
    const reference = parseLocatedWorkflowSpecReference(
      match, lineIndex, context.workflowPath
    );
    if (!reference) continue;
    context.references.push({
      ...("workflowPath" in reference ? { workflowPath: reference.workflowPath } : {}),
      nodeId: reference.nodeId,
      lineIndex,
      columnIndex: match.index,
      sectionLineIndex: context.headings.at(-1)?.lineIndex ?? lineIndex
    });
  }
}

/** Parses the located workflow spec reference into structured editor data. */
function parseLocatedWorkflowSpecReference(match, lineIndex, workflowPath) {
  try {
    return parseWorkflowSpecReference(match[1], workflowPath);
  } catch (error) {
    throw new Error(
      `${error.message || String(error)} (line ${lineIndex + 1}, column ${match.index + 1})`,
      { cause: error }
    );
  }
}

/** Collects the workflow spec links for the current editor state. */
export function collectWorkflowSpecLinks(documents, workflowPath) {
  const linksByNode = new Map();
  for (const document of documents) {
    let references;
    try {
      references = parseWorkflowSpecReferences(document.source, workflowPath);
    } catch (error) {
      const source = document.filePath ? `${document.filePath}: ` : "";
      throw new Error(`${source}${error.message || String(error)}`, { cause: error });
    }
    for (const reference of references) {
      const links = linksByNode.get(reference.nodeId) || [];
      let linkedSpec = links.find((link) => link.filePath === document.filePath);
      if (!linkedSpec) {
        linkedSpec = {
          filePath: document.filePath,
          source: document.source,
          references: []
        };
        links.push(linkedSpec);
        linksByNode.set(reference.nodeId, links);
      }
      linkedSpec.references.push(reference);
    }
  }
  return linksByNode;
}

/** Parses the workflow click directives into structured editor data. */
export function parseWorkflowClickDirectives(source) {
  const links = new Map();
  const diagramLines = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!/^\s*click\b/i.test(line) || !/\bspecux:/i.test(line)) {
      diagramLines.push(line);
      continue;
    }

    const match = line.match(
      /^\s*click\s+([A-Za-z0-9_-]+)\s+href\s+"([^"]+)"(?:\s+"[^"]*")?\s*$/i
    );
    if (!match) {
      throw new Error(
        `Invalid SpecUX click link on line ${index + 1}, column ${line.search(/\S/) + 1}; expected click <node-id> href "specux://...".`
      );
    }
    if (links.has(match[1])) {
      throw new Error(
        `Workflow node "${match[1]}" has more than one SpecUX link (line ${index + 1}, column ${line.search(/\S/) + 1}).`
      );
    }
    links.set(match[1], parseWorkflowLink(match[2]));
  }
  return { diagramSource: diagramLines.join("\n"), links };
}

/** Updates the workflow error location for the current editor state. */
function withWorkflowErrorLocation(filePath, source, error, token = null) {
  const message = error.message || String(error);
  if (message.startsWith(`${filePath}:`)) return error;
  const location = getWorkflowErrorLocation(filePath, source, message, token);
  return new Error(`${location}: ${message}`, { cause: error });
}

/** Maps a Mermaid parse error to its source line and column. */
function getWorkflowErrorLocation(filePath, source, message, token) {
  const explicit = message.match(/line (\d+), column (\d+)/i);
  if (explicit) return `${filePath}:${Number(explicit[1])}:${Number(explicit[2]) || 1}`;
  const parseLocation = getMermaidParseErrorLocation(message);
  if (parseLocation.line !== null) {
    return `${filePath}:${parseLocation.line}:${parseLocation.column || 1}`;
  }
  const tokenLocation = token ? findWorkflowTokenLocation(source, token) : null;
  if (!tokenLocation) return filePath;
  return `${filePath}:${tokenLocation.line}:${tokenLocation.column}`;
}

/** Extracts line and column details from a Mermaid parse error. */
function getMermaidParseErrorLocation(message) {
  const line = Number(message.match(/parse error on line (\d+)/i)?.[1]) || null;
  const caret = message.split(/\r?\n/).find((part) => /^\s*-+\^/.test(part));
  return { line, column: caret ? caret.indexOf("^") + 1 : null };
}

/** Finds the workflow token location in the current project data. */
function findWorkflowTokenLocation(source, token) {
  const lines = source.split(/\r?\n/);
  const lineIndex = lines.findIndex((part) => part.includes(token));
  if (lineIndex < 0) return null;
  return { line: lineIndex + 1, column: lines[lineIndex].indexOf(token) + 1 };
}

/** Loads, edits, validates, and saves Screen workflow diagrams. */
export class WorkflowEditor {

  /** Stores the injected collaborators and initializes the instance state. */
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.mermaidPromise = null;
    this.fileVersions = new Map();
    this.diagramId = 0;
    this.validationTimer = null;
    this.selectionQueue = Promise.resolve();
    this.selectionVersion = 0;
    this.specPreviewVersion = 0;
    this.activeSpecPreview = null;
    services.byId("workflow-panel-diagram").addEventListener("click", () =>
      this.setPanelMode("diagram")
    );
    services.byId("workflow-panel-source").addEventListener("click", () =>
      this.setPanelMode("source")
    );
    for (const mode of ["split", "diagram"]) {
      services.byId(`workflow-view-${mode}`).addEventListener("click", () => {
        requestAnimationFrame(() => requestAnimationFrame(() =>
          this.updateSpecLinkPositions()
        ));
      });
    }
    services.byId("workflow-spec-section-previous").addEventListener("click", () =>
      this.moveSpecReference(-1)
    );
    services.byId("workflow-spec-section-next").addEventListener("click", () =>
      this.moveSpecReference(1)
    );
    services.byId("workflow-spec-file-select").addEventListener("change", (event) =>
      this.selectSpecFile(event.target.value)
    );
  }

  /** Renders the selected editor view and refreshes its dependent preview and controls. */
  async render(filePath, screenIndex) {
    const { state, services } = this;
    const source = state.workflowSources.get(filePath);
    if (source === undefined) throw new Error(`Workflow "${filePath}" is not available.`);
    const changedWorkflow = !state.viewingWorkflow || state.activeWorkflowPath !== filePath;
    state.viewingWorkflow = true;
    state.activeWorkflowPath = filePath;
    state.workflowScreenIndex = screenIndex;
    state.activeProjectFilePath = filePath;
    if (changedWorkflow) {
      state.selectedWorkflowNodeId = null;
      this.activeSpecPreview = null;
      this.updateSpecSectionNavigation();
    }
    this.activate();
    services.byId("workflow-editor-heading").textContent = filePath;
    const editor = services.byId("workflow-source");
    if (changedWorkflow) services.byId("workflow-diagram").replaceChildren();
    editor.value = source;
    editor.setAttribute("aria-label", `Mermaid source for ${filePath}`);
    editor.disabled = state.isSaving;
    editor.oninput = () => this.handleSourceInput(filePath, editor.value);
    services.byId("workflow-status").textContent = "";
    services.byId("workflow-status").classList.remove("error");
    if (!["split", "preview", "diagram"].includes(state.workflowViewMode)) {
      state.workflowViewMode = "split";
    }
    this.setViewMode(state.workflowViewMode);
    this.setPanelMode("diagram");
    let links = new Map();
    try {
      links = await this.renderDiagram(
        source,
        this.nextFileVersion(filePath),
        filePath
      ) || links;
    } catch (error) {
      services.byId("workflow-status").textContent = error.message || String(error);
      services.byId("workflow-status").classList.add("error");
    }
    if (changedWorkflow) await this.selectInitialWorkflowNode(links);
    services.renderNavigation();
    services.renderInspector();
  }

  /** Selects the initial workflow node and updates the related editor state. */
  async selectInitialWorkflowNode(links) {
    const nodes = [...this.services.byId("workflow-diagram").querySelectorAll("g.node")];
    const initialNode = nodes.find((node) => links.has(this.getNodeId(node)));
    if (!initialNode) return;
    const nodeId = this.getNodeId(initialNode);
    await this.selectNode(nodeId, links.get(nodeId));
  }

  /** Activates the selected editor mode and updates the related controls. */
  activate() {
    this.state.viewingWorkflow = true;
    this.services.byId("main").classList.add("workflow-editing");
    this.services.byId("workflow-editor-panel").hidden = false;
  }

  /** Clears workflow-specific selection and preview state when leaving the workflow view. */
  deactivate() {
    this.state.viewingWorkflow = false;
    this.state.activeWorkflowPath = null;
    this.activeSpecPreview = null;
    this.updateSpecLinkSelection();
    this.updateSpecSectionNavigation();
    this.clearSpecReferencePreview();
    this.services.byId("main").classList.remove("workflow-editing");
    this.services.byId("workflow-editor-panel").hidden = true;
    this.services.byId("workflow-source").oninput = null;
  }

  /** Shows the spec reference preview for the current editor state. */
  async showSpecReferencePreview(reference, specPath) {
    const { state, services } = this;
    this.clearSpecReferencePreview();
    const source = state.workflowSources.get(reference.workflowPath);
    if (source === undefined) {
      throw new Error(`Workflow "${reference.workflowPath}" is not available.`);
    }

    const version = ++this.specPreviewVersion;
    let diagramSource;
    let mermaid;
    try {
      ({ diagramSource } = parseWorkflowClickDirectives(source));
      mermaid = await this.getMermaid();
      await mermaid.parse(source);
    } catch (error) {
      throw withWorkflowErrorLocation(reference.workflowPath, source, error);
    }
    if (version !== this.specPreviewVersion || !state.viewingSpec) return;

    const preview = services.byId("spec-workflow-preview");
    let rendered;
    try {
      rendered = await mermaid.render(
        `specux-workflow-${++this.diagramId}`,
        diagramSource
      );
    } catch (error) {
      throw withWorkflowErrorLocation(reference.workflowPath, source, error);
    }
    if (version !== this.specPreviewVersion || !state.viewingSpec) return;
    preview.innerHTML = rendered.svg;
    rendered.bindFunctions?.(preview);
    const nodes = [...preview.querySelectorAll("g.node")];
    const node = nodes.find((entry) => this.getNodeId(entry) === reference.nodeId);
    if (!node) {
      throw new Error(
        `Workflow link refers to unknown Mermaid node "${reference.nodeId}" in "${reference.workflowPath}".`
      );
    }
    node.classList.add("selected");
    this.setNodeSelectionHighlight(node, true);
    preview.hidden = false;
    preview.setAttribute(
      "aria-label",
      `Workflow preview for "${specPath}", focused on node "${reference.nodeId}"`
    );
    services.byId("main").classList.add("spec-workflow-preview-active");
    services.byId("spec-view-heading").textContent = `Workflow: ${reference.workflowPath}`;
    this.scrollSpecPreviewNodeIntoView(preview, node);
  }

  /** Updates the spec preview node into view for the current editor state. */
  scrollSpecPreviewNodeIntoView(preview, node) {
    const previewRect = preview.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    if (!preview.clientWidth || !preview.clientHeight) return;

    const viewportLeft = previewRect.left + preview.clientLeft;
    const viewportTop = previewRect.top + preview.clientTop;
    preview.scrollTo({
      left: preview.scrollLeft +
        nodeRect.left + nodeRect.width / 2 -
        (viewportLeft + preview.clientWidth / 2),
      top: preview.scrollTop +
        nodeRect.top + nodeRect.height / 2 -
        (viewportTop + preview.clientHeight / 2),
      behavior: "smooth"
    });
  }

  /** Clears the spec reference preview and resets its associated state. */
  clearSpecReferencePreview() {
    this.specPreviewVersion += 1;
    const { services } = this;
    services.byId("main").classList.remove("spec-workflow-preview-active");
    const preview = services.byId("spec-workflow-preview");
    preview.hidden = true;
    preview.replaceChildren();
    services.byId("spec-view-heading").textContent = "Preview";
  }

  /** Sets the node selection highlight from the supplied data. */
  setNodeSelectionHighlight(node, selected) {
    const insetShapes = node.querySelectorAll?.(".workflow-node-focus-inset") || [];
    insetShapes.forEach((shape) => shape.remove());
    if (!selected) return;

    const shape = node.querySelector?.(".basic");
    if (!shape?.getBBox || !shape.cloneNode) return;
    const bounds = shape.getBBox();
    const inset = 2;
    if (bounds.width <= inset * 2 || bounds.height <= inset * 2) return;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const scaleX = (bounds.width - inset * 2) / bounds.width;
    const scaleY = (bounds.height - inset * 2) / bounds.height;
    const insetShape = shape.cloneNode(false);
    const transform = [
      shape.getAttribute("transform"),
      `translate(${centerX} ${centerY}) scale(${scaleX} ${scaleY}) translate(${-centerX} ${-centerY})`
    ].filter(Boolean).join(" ");
    insetShape.setAttribute("class", "workflow-node-focus-inset");
    insetShape.removeAttribute("id");
    insetShape.removeAttribute("style");
    insetShape.removeAttribute("filter");
    insetShape.setAttribute("fill", "none");
    insetShape.setAttribute("pointer-events", "none");
    insetShape.setAttribute("transform", transform);
    node.appendChild(insetShape);
  }

  /** Sets the view mode from the supplied data. */
  setViewMode(mode) {
    this.state.workflowViewMode = mode;
    this.services.setWorkflowViewMode(mode);
  }

  /** Sets the panel mode from the supplied data. */
  setPanelMode(mode) {
    const { services } = this;
    const isSource = mode === "source";
    services.byId("workflow-diagram").hidden = isSource;
    services.byId("workflow-source").hidden = !isSource;
    services.byId("workflow-panel-diagram").setAttribute("aria-pressed", String(!isSource));
    services.byId("workflow-panel-source").setAttribute("aria-pressed", String(isSource));
    services.publishSelection?.();
  }

  /** Handles source input events and applies the corresponding editor action. */
  handleSourceInput(filePath, source) {
    const { state, services } = this;
    state.workflowSources.set(filePath, source);
    state.invalidWorkflowFiles.set(filePath, "Validating Mermaid...");
    services.markEdited(filePath);
    services.updateSaveControls();
    services.byId("workflow-status").textContent = "Validating Mermaid...";
    services.byId("workflow-status").classList.remove("error");
    clearTimeout(this.validationTimer);
    const version = this.nextFileVersion(filePath);
    this.validationTimer = setTimeout(() => {
      this.renderDiagram(source, version, filePath).catch((error) => {
        if (this.fileVersions.get(filePath) !== version) return;
        state.invalidWorkflowFiles.set(filePath, error.message || String(error));
        if (state.activeWorkflowPath === filePath) {
          services.byId("workflow-status").textContent = error.message || String(error);
          services.byId("workflow-status").classList.add("error");
        }
        services.updateSaveControls();
      });
    }, 250);
  }

  /** Finds the file version for the current editor state. */
  nextFileVersion(filePath) {
    const version = (this.fileVersions.get(filePath) || 0) + 1;
    this.fileVersions.set(filePath, version);
    return version;
  }

  /** Returns the mermaid. */
  async getMermaid() {
    this.mermaidPromise ??= import("/vendor/mermaid/mermaid.esm.min.mjs").then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        flowchart: { htmlLabels: false, useMaxWidth: true }
      });
      return mermaid;
    });
    return this.mermaidPromise;
  }

  /** Renders the diagram from the current editor data. */
  async renderDiagram(source, expectedVersion, filePath) {
    const { diagramSource, links } = this.parseDiagramLinks(source, filePath);
    const mermaid = await this.getMermaid();
    await this.validateDiagramSyntax(mermaid, source, filePath);
    const specLinks = collectWorkflowSpecLinks(
      await this.services.getWorkflowSpecDocuments(),
      filePath
    );
    if (!this.isCurrentDiagram(filePath, expectedVersion)) return links;
    await this.renderActiveDiagram(
      source, diagramSource, filePath, expectedVersion, mermaid, links, specLinks
    );
    this.clearDiagramValidationError(filePath);
    this.services.updateSaveControls();
    return links;
  }

  /** Parses the diagram links into structured editor data. */
  parseDiagramLinks(source, filePath) {
    try {
      return parseWorkflowClickDirectives(source);
    } catch (error) {
      throw withWorkflowErrorLocation(filePath, source, error);
    }
  }

  /** Validates the diagram syntax before it is applied or saved. */
  async validateDiagramSyntax(mermaid, source, filePath) {
    try {
      await mermaid.parse(source);
    } catch (error) {
      throw withWorkflowErrorLocation(filePath, source, error);
    }
  }

  /** Checks whether the selected diagram is the active workflow being edited. */
  isCurrentDiagram(filePath, expectedVersion) {
    return this.fileVersions.get(filePath) === expectedVersion;
  }

  /** Renders the active diagram from the current editor data. */
  async renderActiveDiagram(
    source, diagramSource, filePath, expectedVersion, mermaid, links, specLinks
  ) {
    if (filePath !== this.state.activeWorkflowPath) return;
    const diagram = this.services.byId("workflow-diagram");
    const rendered = await this.renderDiagramSvg(mermaid, diagramSource, source, filePath);
    if (!this.isCurrentDiagram(filePath, expectedVersion) ||
        filePath !== this.state.activeWorkflowPath) return;
    diagram.innerHTML = rendered.svg;
    rendered.bindFunctions?.(diagram);
    const nodes = [...diagram.querySelectorAll("g.node")];
    const nodeIds = this.renderWorkflowNodes(nodes, links, specLinks);
    this.validateLinkedWorkflowNodes(source, filePath, nodeIds, links, specLinks);
    this.updateSpecLinkSelection();
  }

  /** Renders the diagram svg from the current editor data. */
  async renderDiagramSvg(mermaid, diagramSource, source, filePath) {
    try {
      return await mermaid.render(`specux-workflow-${++this.diagramId}`, diagramSource);
    } catch (error) {
      throw withWorkflowErrorLocation(filePath, source, error);
    }
  }

  /** Renders the workflow nodes from the current editor data. */
  renderWorkflowNodes(nodes, links, specLinks) {
    const nodeIds = new Set();
    for (const node of nodes) {
      const id = this.getNodeId(node);
      nodeIds.add(id);
      this.renderWorkflowNode(node, id, links.get(id), specLinks.get(id) || []);
    }
    return nodeIds;
  }

  /** Renders the workflow node from the current editor data. */
  renderWorkflowNode(node, id, link, linkedSpecs) {
    const selected = id === this.state.selectedWorkflowNodeId;
    node.classList.toggle("selected", selected);
    if (selected) this.setNodeSelectionHighlight(node, true);
    if (link) this.configureLinkedWorkflowNode(node, id, link, linkedSpecs);
    if (linkedSpecs.length) this.addSpecLinkControl(node, linkedSpecs);
  }

  /** Updates the linked workflow node for the current editor state. */
  configureLinkedWorkflowNode(node, id, link, linkedSpecs) {
    node.classList.add("workflow-linked-node");
    node.setAttribute("role", linkedSpecs.length ? "group" : "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute(
      "aria-label",
      linkedSpecs.length
        ? `Workflow node ${id}. ${this.getLinkLabel(link)}.`
        : this.getLinkLabel(link)
    );
    node.addEventListener("click", () => this.selectNode(id, link));
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.selectNode(id, link);
    });
  }

  /** Validates the linked workflow nodes before it is applied or saved. */
  validateLinkedWorkflowNodes(source, filePath, nodeIds, links, specLinks) {
    for (const nodeId of new Set([...links.keys(), ...specLinks.keys()])) {
      if (nodeIds.has(nodeId)) continue;
      throw withWorkflowErrorLocation(
        filePath,
        source,
        new Error(`Workflow link refers to unknown Mermaid node "${nodeId}".`),
        nodeId
      );
    }
  }

  /** Clears the diagram validation error and resets its associated state. */
  clearDiagramValidationError(filePath) {
    this.state.invalidWorkflowFiles.delete(filePath);
    if (filePath !== this.state.activeWorkflowPath) return;
    const status = this.services.byId("workflow-status");
    status.textContent = "";
    status.classList.remove("error");
  }

  /** Returns the node id. */
  getNodeId(node) {
    const dataId = node.getAttribute("data-id");
    if (dataId) return dataId;
    const diagramPrefix = `specux-workflow-${this.diagramId}-flowchart-`;
    const id = node.id.startsWith(diagramPrefix)
      ? node.id.slice(diagramPrefix.length)
      : node.id.replace(/^flowchart-/, "");
    return id.replace(/-\d+$/, "");
  }

  /** Returns the link label. */
  getLinkLabel(link) {
    const target = link.placementId
      ? `Element ${link.placementId} on Screen ${link.screenId}`
      : `Screen ${link.screenId}`;
    return link.stateId === "default"
      ? `Preview ${target} in Default state`
      : `Preview ${target} in state ${link.stateId}`;
  }

  /** Adds the spec link control for the current editor state. */
  addSpecLinkControl(node, linkedSpecs) {
    const bounds = node.getBBox();
    const svgNamespace = "http://www.w3.org/2000/svg";
    const control = node.ownerDocument.createElementNS(svgNamespace, "g");
    control.classList.add("workflow-spec-link");
    control.dataset.specNodeId = this.getNodeId(node);
    control.setAttribute(
      "transform",
      `translate(${bounds.x + bounds.width - 11},${bounds.y + 11})`
    );
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.setAttribute(
      "aria-label",
      `Open linked behavior specs for workflow node ${control.dataset.specNodeId}`
    );

    const hitArea = node.ownerDocument.createElementNS(svgNamespace, "circle");
    hitArea.setAttribute("cx", "0");
    hitArea.setAttribute("cy", "0");
    hitArea.setAttribute("r", "12");
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("pointer-events", "all");
    const icon = node.ownerDocument.createElementNS(svgNamespace, "image");
    icon.setAttribute("href", "/icons/spec-icon.svg");
    icon.setAttribute("x", "-10");
    icon.setAttribute("y", "-10");
    icon.setAttribute("width", "20");
    icon.setAttribute("height", "20");
    icon.setAttribute("aria-hidden", "true");
    const title = node.ownerDocument.createElementNS(svgNamespace, "title");
    title.textContent = `Open linked behavior specs for ${control.dataset.specNodeId}`;
    control.append(hitArea, icon, title);

    /** Opens the spec in the editor. */
    const openSpec = (event) => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve()
        .then(() => this.services.openWorkflowSpec(
          linkedSpecs,
          control.dataset.specNodeId
        ))
        .catch((error) => {
          const status = this.services.byId("workflow-status");
          status.textContent = error.message || String(error);
          status.classList.add("error");
        });
    };
    control.addEventListener("click", openSpec);
    control.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      openSpec(event);
    });
    node.append(control);
  }

  /** Updates the spec link positions to reflect the latest editor state. */
  updateSpecLinkPositions() {
    const controls = this.services.byId("workflow-diagram")
      .querySelectorAll(".workflow-spec-link");
    controls.forEach((control) => {
      const node = control.closest("g.node");
      if (!node) return;
      const bounds = node.getBBox();
      if (!bounds.width || !bounds.height) return;
      control.setAttribute(
        "transform",
        `translate(${bounds.x + bounds.width - 11},${bounds.y + 11})`
      );
    });
  }

  /** Updates the spec link selection to reflect the latest editor state. */
  updateSpecLinkSelection() {
    const active = this.activeSpecPreview;
    const controls = this.services.byId("workflow-diagram")
      .querySelectorAll?.(".workflow-spec-link") || [];
    controls.forEach((control) => {
      const selected = active?.nodeId === control.dataset.specNodeId;
      control.classList.toggle("selected", selected);
      control.setAttribute("aria-pressed", String(selected));
    });
  }

  /** Shows the spec preview for the current editor state. */
  showSpecPreview(linkedSpecs, nodeId = null) {
    const { services } = this;
    const main = services.byId("main");
    if (main.getAttribute?.("data-workflow-view") === "diagram") {
      this.setViewMode("split");
    }
    const navigation = linkedSpecs.flatMap((spec, fileIndex) =>
      spec.references.map((reference, referenceIndex) => ({
        fileIndex,
        referenceIndex,
        reference
      }))
    );
    this.activeSpecPreview = {
      nodeId,
      linkedSpecs,
      navigation,
      navigationIndex: 0
    };
    const fileSelect = services.byId("workflow-spec-file-select");
    const options = linkedSpecs.map((spec) => {
      const option = fileSelect.ownerDocument.createElement("option");
      option.value = spec.filePath;
      option.textContent = spec.filePath;
      return option;
    });
    fileSelect.replaceChildren(...options);
    this.updateSpecLinkSelection();
    this.renderSpecPreview();
  }

  /** Renders the spec preview from the current editor data. */
  renderSpecPreview() {
    const active = this.activeSpecPreview;
    if (!active) return;
    const { services } = this;
    const preview = services.byId("workflow-spec-preview");
    const document = preview.ownerDocument;
    const currentNavigation = active.navigation[active.navigationIndex];
    const linkedSpec = active.linkedSpecs[currentNavigation.fileIndex];
    const reference = currentNavigation.reference;
    const file = document.createElement("pre");
    file.className = "workflow-spec-file";
    const section = getMarkdownSectionRange(
      linkedSpec.source,
      reference.sectionLineIndex,
      reference.lineIndex
    );
    const lines = linkedSpec.source.split(/\r?\n/);
    lines.forEach((text, lineIndex) => {
      const line = document.createElement("span");
      line.className = "workflow-spec-line";
      line.dataset.lineIndex = String(lineIndex);
      if (lineIndex >= section.start && lineIndex <= section.end) {
        line.classList.add("workflow-spec-section-target");
      }
      const link = lineIndex === reference.lineIndex
        ? findMarkdownSpecLink(text, reference.columnIndex)
        : null;
      if (link) {
        const before = document.createElement("span");
        before.textContent = text.slice(0, link.index);
        line.append(before);
        const target = document.createElement("span");
        target.className = "workflow-spec-link-target";
        target.textContent = link[0];
        line.append(target);
        const after = document.createElement("span");
        after.textContent = text.slice(link.index + link[0].length);
        line.append(after);
      } else {
        line.textContent = text;
      }
      file.append(line);
    });

    preview.setAttribute(
      "aria-label",
      `Behavior spec preview: ${linkedSpec.filePath}`
    );
    preview.replaceChildren(file);
    preview.scrollTop = 0;
    services.byId("screen-stage").setAttribute(
      "aria-label",
      `Behavior spec preview: ${linkedSpec.filePath}`
    );
    services.byId("workflow-spec-file-select").value = linkedSpec.filePath;
    this.updateSpecSectionNavigation();

    const target = file.querySelector(
      `[data-line-index="${reference.sectionLineIndex}"]`
    );
    if (target) {
      const previewTop = preview.getBoundingClientRect().top;
      preview.scrollTop += target.getBoundingClientRect().top - previewTop;
    }
  }

  /** Moves the spec reference for the current editor state. */
  moveSpecReference(offset) {
    const active = this.activeSpecPreview;
    if (!active || active.navigation.length < 2) return;
    active.navigationIndex =
      (active.navigationIndex + offset + active.navigation.length) %
      active.navigation.length;
    this.renderSpecPreview();
  }

  /** Selects the spec file and updates the related editor state. */
  selectSpecFile(filePath) {
    const active = this.activeSpecPreview;
    if (!active) return;
    const navigationIndex = active.navigation.findIndex((entry) =>
      active.linkedSpecs[entry.fileIndex].filePath === filePath
    );
    if (navigationIndex < 0) return;
    active.navigationIndex = navigationIndex;
    this.renderSpecPreview();
  }

  /** Updates the spec section navigation to reflect the latest editor state. */
  updateSpecSectionNavigation() {
    const { services } = this;
    const active = this.activeSpecPreview;
    const count = active?.navigation.length || 0;
    services.byId("main").classList.toggle(
      "workflow-spec-preview-active",
      Boolean(active)
    );
    const navigation = services.byId("workflow-spec-section-navigation");
    navigation.hidden = !active;
    services.byId("workflow-spec-section-position").textContent = active
      ? `${active.navigationIndex + 1} of ${count}`
      : "";
    services.byId("workflow-spec-preview").hidden = !active;
    services.byId("workflow-spec-file-select").hidden =
      !active || active.linkedSpecs.length < 2;
    services.byId("workflow-spec-section-previous").disabled =
      !active || count < 2;
    services.byId("workflow-spec-section-next").disabled =
      !active || count < 2;
  }

  /** Selects the node and updates the related editor state. */
  selectNode(nodeId, link) {
    this.services.byId("workflow-diagram")
      .querySelectorAll("g.node.selected")
      .forEach((node) => {
        node.classList.remove("selected");
        this.setNodeSelectionHighlight(node, false);
      });
    const selected = [...this.services.byId("workflow-diagram").querySelectorAll("g.node")]
      .find((node) => this.getNodeId(node) === nodeId);
    selected?.classList.add("selected");
    if (selected) this.setNodeSelectionHighlight(selected, true);
    this.state.selectedWorkflowNodeId = nodeId;
    const selectionVersion = ++this.selectionVersion;
    const workflowScreenIndex = this.state.workflowScreenIndex;
    const workflowPath = this.state.activeWorkflowPath;
    this.selectionQueue = this.selectionQueue.then(async () => {
      if (selectionVersion !== this.selectionVersion) return;
      try {
        await this.services.showWorkflowNode(link, workflowScreenIndex, workflowPath);
        this.activeSpecPreview = null;
        this.updateSpecLinkSelection();
        this.updateSpecSectionNavigation();
      } catch (error) {
        const status = this.services.byId("workflow-status");
        status.textContent = error.message || String(error);
        status.classList.add("error");
      }
    });
    return this.selectionQueue;
  }
}
