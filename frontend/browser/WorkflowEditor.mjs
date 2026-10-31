export function parseWorkflowLink(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    throw new Error(`Invalid workflow link "${href}".`);
  }
  if (url.protocol !== "specux:" || url.hostname !== "screen" ||
      url.username || url.password || url.port || url.hash) {
    throw new Error(`Invalid workflow link "${href}".`);
  }

  let pathSegments;
  try {
    pathSegments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new Error(`Invalid workflow link path "${href}".`);
  }
  const isValidId = (id) => /^[a-z][a-z0-9-]*$/.test(id);
  if (pathSegments.length !== 2 ||
      !isValidId(pathSegments[0]) ||
      pathSegments[1] !== "screen.yml") {
    throw new Error(`Workflow link path must be screen/<screen-id>/screen.yml: "${href}".`);
  }

  const queryEntries = [...url.searchParams.entries()];
  if (queryEntries.some(([key]) => !["placement", "state"].includes(key)) ||
      url.searchParams.getAll("placement").length > 1 ||
      url.searchParams.getAll("state").length > 1) {
    throw new Error(
      `Workflow links support one placement and one state query parameter: "${href}".`
    );
  }
  const placementId = url.searchParams.get("placement");
  const stateId = url.searchParams.get("state") ?? "default";
  if ((placementId !== null && !isValidId(placementId)) ||
      !isValidId(stateId)) {
    throw new Error(`Invalid placement or preview state in workflow link "${href}".`);
  }

  return {
    screenId: pathSegments[0],
    placementId,
    stateId
  };
}

export function parseWorkflowSpecReference(href, workflowPath) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "specux:" || url.hostname !== "screen" ||
      url.username || url.password || url.port || url.hash) return null;
  let pathSegments;
  try {
    pathSegments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (pathSegments[1] !== "workflows") return null;
  const isValidId = (id) => /^[a-z][a-z0-9-]*$/.test(id);
  if (pathSegments.length !== 3 ||
      !isValidId(pathSegments[0]) ||
      !/^[a-z][a-z0-9-]*\.mmd$/.test(pathSegments[2])) {
    throw new Error(`Invalid Screen workflow link in behavior spec: "${href}".`);
  }
  const targetWorkflowPath =
    `screens/${pathSegments[0]}/workflows/${pathSegments[2]}`;
  if (targetWorkflowPath !== workflowPath) return null;

  const queryEntries = [...url.searchParams.entries()];
  if (queryEntries.length !== 1 ||
      queryEntries.some(([key]) => key !== "node") ||
      url.searchParams.getAll("node").length !== 1 ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(url.searchParams.get("node") || "")) {
    throw new Error(
      `Workflow links in behavior specs must include one valid node parameter: "${href}".`
    );
  }
  return { nodeId: url.searchParams.get("node") };
}

export function parseWorkflowSpecReferences(source, workflowPath) {
  const references = [];
  const headings = [];
  const lines = source.split(/\r?\n/);
  let codeFence = null;
  for (const [lineIndex, line] of lines.entries()) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (codeFence) {
      if (fence &&
          fence[1][0] === codeFence.character &&
          fence[1].length >= codeFence.length &&
          /^\s*$/.test(line.slice(fence[0].length))) {
        codeFence = null;
      }
      continue;
    }
    if (fence) {
      codeFence = { character: fence[1][0], length: fence[1].length };
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+.+?\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) {
        headings.pop();
      }
      headings.push({ level, lineIndex });
    }

    const markdownLink = /\[[^\]]*\]\((specux:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of line.matchAll(markdownLink)) {
      const reference = parseWorkflowSpecReference(match[1], workflowPath);
      if (!reference) continue;
      references.push({
        nodeId: reference.nodeId,
        lineIndex,
        sectionLineIndex: headings.at(-1)?.lineIndex ?? lineIndex
      });
    }
  }
  return references;
}

export function collectWorkflowSpecLinks(documents, workflowPath) {
  const linksByNode = new Map();
  for (const document of documents) {
    for (const reference of parseWorkflowSpecReferences(document.source, workflowPath)) {
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
        `Invalid SpecUX click link on line ${index + 1}; expected click <node-id> href "specux://...".`
      );
    }
    if (links.has(match[1])) {
      throw new Error(`Workflow node "${match[1]}" has more than one SpecUX link.`);
    }
    links.set(match[1], parseWorkflowLink(match[2]));
  }
  return { diagramSource: diagramLines.join("\n"), links };
}

export class WorkflowEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
    this.mermaidPromise = null;
    this.fileVersions = new Map();
    this.diagramId = 0;
    this.validationTimer = null;
    this.selectionQueue = Promise.resolve();
    this.selectionVersion = 0;
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
  }

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
    if (changedWorkflow) {
      const initialNode = [...services.byId("workflow-diagram")
        .querySelectorAll("g.node")]
        .find((node) => links.has(this.getNodeId(node)));
      if (initialNode) {
        const nodeId = this.getNodeId(initialNode);
        await this.selectNode(nodeId, links.get(nodeId));
      }
    }
    services.renderNavigation();
    services.renderInspector();
  }

  activate() {
    this.state.viewingWorkflow = true;
    this.services.byId("main").classList.add("workflow-editing");
    this.services.byId("workflow-editor-panel").hidden = false;
  }

  deactivate() {
    this.state.viewingWorkflow = false;
    this.state.activeWorkflowPath = null;
    this.activeSpecPreview = null;
    this.updateSpecSectionNavigation();
    this.services.byId("main").classList.remove("workflow-editing");
    this.services.byId("workflow-editor-panel").hidden = true;
    this.services.byId("workflow-source").oninput = null;
  }

  setViewMode(mode) {
    this.state.workflowViewMode = mode;
    this.services.setWorkflowViewMode(mode);
  }

  setPanelMode(mode) {
    const { services } = this;
    const isSource = mode === "source";
    services.byId("workflow-diagram").hidden = isSource;
    services.byId("workflow-source").hidden = !isSource;
    services.byId("workflow-panel-diagram").setAttribute("aria-pressed", String(!isSource));
    services.byId("workflow-panel-source").setAttribute("aria-pressed", String(isSource));
  }

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

  nextFileVersion(filePath) {
    const version = (this.fileVersions.get(filePath) || 0) + 1;
    this.fileVersions.set(filePath, version);
    return version;
  }

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

  async renderDiagram(source, expectedVersion, filePath) {
    const { state, services } = this;
    const isCurrent = () => this.fileVersions.get(filePath) === expectedVersion;
    const { diagramSource, links } = parseWorkflowClickDirectives(source);
    const mermaid = await this.getMermaid();
    await mermaid.parse(source);
    const specDocuments = await services.getWorkflowSpecDocuments();
    const specLinks = collectWorkflowSpecLinks(specDocuments, filePath);
    if (!isCurrent()) return links;
    if (filePath === state.activeWorkflowPath) {
      const diagram = services.byId("workflow-diagram");
      const rendered = await mermaid.render(
        `specux-workflow-${++this.diagramId}`,
        diagramSource
      );
      if (!isCurrent() || filePath !== state.activeWorkflowPath) return links;
      diagram.innerHTML = rendered.svg;
      rendered.bindFunctions?.(diagram);
      const nodes = [...diagram.querySelectorAll("g.node")];
      const nodeIds = new Set(nodes.map((node) => this.getNodeId(node)));
      nodes.forEach((node) => {
        const id = this.getNodeId(node);
        const link = links.get(id);
        const linkedSpecs = specLinks.get(id) || [];
        node.classList.toggle("selected", id === state.selectedWorkflowNodeId);
        if (link) {
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
        linkedSpecs.forEach((linkedSpec, index) =>
          this.addSpecLinkControl(node, linkedSpec, index)
        );
      });
      for (const nodeId of new Set([...links.keys(), ...specLinks.keys()])) {
        if (!nodeIds.has(nodeId)) {
          throw new Error(
            `Workflow link refers to unknown Mermaid node "${nodeId}" in "${filePath}".`
          );
        }
      }
    }
    state.invalidWorkflowFiles.delete(filePath);
    if (filePath === state.activeWorkflowPath) {
      services.byId("workflow-status").textContent = "";
      services.byId("workflow-status").classList.remove("error");
    }
    services.updateSaveControls();
    return links;
  }

  getNodeId(node) {
    const dataId = node.getAttribute("data-id");
    if (dataId) return dataId;
    const diagramPrefix = `specux-workflow-${this.diagramId}-flowchart-`;
    const id = node.id.startsWith(diagramPrefix)
      ? node.id.slice(diagramPrefix.length)
      : node.id.replace(/^flowchart-/, "");
    return id.replace(/-\d+$/, "");
  }

  getLinkLabel(link) {
    const target = link.placementId
      ? `Element ${link.placementId} on Screen ${link.screenId}`
      : `Screen ${link.screenId}`;
    return link.stateId === "default"
      ? `Preview ${target} in Default state`
      : `Preview ${target} in state ${link.stateId}`;
  }

  addSpecLinkControl(node, linkedSpec, index) {
    const bounds = node.getBBox();
    const svgNamespace = "http://www.w3.org/2000/svg";
    const control = node.ownerDocument.createElementNS(svgNamespace, "g");
    control.classList.add("workflow-spec-link");
    control.dataset.specLinkIndex = String(index);
    control.setAttribute(
      "transform",
      `translate(${bounds.x + bounds.width - 8 - index * 18},${bounds.y + 8})`
    );
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.setAttribute(
      "aria-label",
      `Open behavior spec ${linkedSpec.filePath}`
    );

    const background = node.ownerDocument.createElementNS(svgNamespace, "circle");
    background.setAttribute("cx", "0");
    background.setAttribute("cy", "0");
    background.setAttribute("r", "8");
    const glyph = node.ownerDocument.createElementNS(svgNamespace, "text");
    glyph.setAttribute("x", "0");
    glyph.setAttribute("y", "3");
    glyph.textContent = "S";
    const title = node.ownerDocument.createElementNS(svgNamespace, "title");
    title.textContent = `Open ${linkedSpec.filePath}`;
    control.append(background, glyph, title);

    const openSpec = (event) => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve()
        .then(() => this.services.openWorkflowSpec(
          linkedSpec.filePath,
          linkedSpec.references
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

  updateSpecLinkPositions() {
    const controls = this.services.byId("workflow-diagram")
      .querySelectorAll(".workflow-spec-link");
    controls.forEach((control) => {
      const node = control.closest("g.node");
      if (!node) return;
      const bounds = node.getBBox();
      if (!bounds.width || !bounds.height) return;
      const index = Number(control.dataset.specLinkIndex) || 0;
      control.setAttribute(
        "transform",
        `translate(${bounds.x + bounds.width - 8 - index * 18},${bounds.y + 8})`
      );
    });
  }

  showSpecPreview(filePath, source, references) {
    const { services } = this;
    const main = services.byId("main");
    if (main.getAttribute?.("data-workflow-view") === "diagram") {
      this.setViewMode("split");
    }
    this.activeSpecPreview = {
      filePath,
      source,
      references,
      referenceIndex: 0
    };
    this.renderSpecPreview();
  }

  renderSpecPreview() {
    const active = this.activeSpecPreview;
    if (!active) return;
    const { services } = this;
    const preview = services.byId("screen-preview");
    const document = preview.ownerDocument;
    const file = document.createElement("pre");
    file.className = "workflow-spec-file";
    const lines = active.source.split(/\r?\n/);
    const reference = active.references[active.referenceIndex];
    lines.forEach((text, lineIndex) => {
      const line = document.createElement("span");
      line.className = "workflow-spec-line";
      line.dataset.lineIndex = String(lineIndex);
      line.textContent = text;
      if (lineIndex === reference.sectionLineIndex) {
        line.classList.add("workflow-spec-section-target");
      }
      if (lineIndex === reference.lineIndex) {
        line.classList.add("workflow-spec-link-target");
      }
      file.append(line);
    });

    preview.className = "screen-preview workflow-spec-preview";
    preview.setAttribute(
      "aria-label",
      `Behavior spec preview: ${active.filePath}`
    );
    preview.replaceChildren(file);
    preview.scrollTop = 0;
    services.byId("screen-stage").setAttribute(
      "aria-label",
      `Behavior spec preview: ${active.filePath}`
    );
    this.updateSpecSectionNavigation();

    const target = file.querySelector(
      `[data-line-index="${reference.sectionLineIndex}"]`
    );
    if (target) {
      const previewTop = preview.getBoundingClientRect().top;
      preview.scrollTop += target.getBoundingClientRect().top - previewTop;
    }
  }

  moveSpecReference(offset) {
    const active = this.activeSpecPreview;
    if (!active) return;
    const nextIndex = active.referenceIndex + offset;
    if (nextIndex < 0 || nextIndex >= active.references.length) return;
    active.referenceIndex = nextIndex;
    this.renderSpecPreview();
  }

  updateSpecSectionNavigation() {
    const { services } = this;
    const active = this.activeSpecPreview;
    const count = active?.references.length || 0;
    services.byId("main").classList.toggle(
      "workflow-spec-preview-active",
      Boolean(active)
    );
    const navigation = services.byId("workflow-spec-section-navigation");
    navigation.hidden = !active;
    services.byId("workflow-spec-section-position").textContent = active
      ? `${active.referenceIndex + 1} of ${count}`
      : "";
    services.byId("workflow-spec-section-previous").disabled =
      !active || count < 2 || active.referenceIndex === 0;
    services.byId("workflow-spec-section-next").disabled =
      !active || count < 2 || active.referenceIndex === count - 1;
  }

  selectNode(nodeId, link) {
    this.services.byId("workflow-diagram")
      .querySelectorAll("g.node.selected")
      .forEach((node) => node.classList.remove("selected"));
    const selected = [...this.services.byId("workflow-diagram").querySelectorAll("g.node")]
      .find((node) => this.getNodeId(node) === nodeId);
    selected?.classList.add("selected");
    this.state.selectedWorkflowNodeId = nodeId;
    const selectionVersion = ++this.selectionVersion;
    const workflowScreenIndex = this.state.workflowScreenIndex;
    const workflowPath = this.state.activeWorkflowPath;
    this.selectionQueue = this.selectionQueue.then(async () => {
      if (selectionVersion !== this.selectionVersion) return;
      try {
        await this.services.showWorkflowNode(link, workflowScreenIndex, workflowPath);
        this.activeSpecPreview = null;
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
