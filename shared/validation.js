(function exposeSpecuxValidation(root, factory) {
  // The schema/*.md files are the source of truth; update validation and tests whenever a schema changes.
  const validation = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = validation;
  } else {
    root.SpecuxValidation = validation;
  }
})(globalThis, () => {
  const MATERIAL_FILE_EXTENSION = ".stml";
  const attributeTypes = ["string", "boolean", "list", "number"];
  const numberFormats = ["integer", "decimal", "currency", "percentage"];
  const themeModeNames = ["light", "dark"];
  const materialTypes = [
    "label",
    "button",
    "surface",
    "avatar",
    "navigation-item",
    "text-field",
    "progress",
    "divider",
    "checkbox"
  ];

  function isMapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function errorAt(message, source, offset, lineOffset = 0) {
    const error = new Error(message);
    const before = source.slice(0, offset);
    error.line = before.split("\n").length + lineOffset;
    error.column = offset - Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
    return error;
  }

  function getPreviewStates(screen) {
    return screen["preview-states"] === undefined
      ? [{ id: "default", name: "Default" }]
      : screen["preview-states"];
  }

  function validatePreviewStates(screen, source) {
    const states = getPreviewStates(screen);
    if (!Array.isArray(states) || states.length === 0) {
      throw new Error(`${source} preview-states must be a non-empty list.`);
    }
    const ids = new Set();
    for (const state of states) {
      if (!isMapping(state) || typeof state.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(state.id)) {
        throw new Error(`${source} preview-states must have an id using lowercase letters, numbers, and hyphens.`);
      }
      if (ids.has(state.id)) throw new Error(`${source} defines Screen State "${state.id}" more than once.`);
      if (typeof state.name !== "string" || !state.name.trim()) {
        throw new Error(`${source} Screen State "${state.id}" must have a non-empty name.`);
      }
      if (state.id !== "default" &&
          (typeof state.description !== "string" || !state.description.trim())) {
        throw new Error(`${source} Screen State "${state.id}" must have a non-empty description.`);
      }
      if (state.description !== undefined &&
          (typeof state.description !== "string" || !state.description.trim())) {
        throw new Error(`${source} Screen State "${state.id}" description must be a non-empty string.`);
      }
      if (state.layers !== undefined && !isMapping(state.layers)) {
        throw new Error(`${source} Screen State "${state.id}" layers must be a mapping.`);
      }
      if (state.placements !== undefined && !isMapping(state.placements)) {
        throw new Error(`${source} Screen State "${state.id}" placements must be a mapping.`);
      }
      if (state.id === "default" &&
          (Object.keys(state.layers || {}).length || Object.keys(state.placements || {}).length)) {
        throw new Error(`${source} default Screen State cannot contain overrides.`);
      }
      if (Object.keys(state).some((key) =>
        !["id", "name", "description", "layers", "placements"].includes(key)
      )) {
        throw new Error(`${source} Screen State "${state.id}" has an unsupported property.`);
      }
      ids.add(state.id);
    }
    if (!ids.has("default")) throw new Error(`${source} preview-states must include the "default" state.`);
    return states;
  }

  function validateSpecPath(filePath) {
    const projectSpec = /^specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
    const screenSpec = /^screens\/[a-z][a-z0-9-]*\/specs\/screen\.md$/;
    const elementSpec = /^screens\/[a-z][a-z0-9-]*\/specs\/element-[a-z][a-z0-9-]*\.md$/;
    if (typeof filePath !== "string" ||
        (!projectSpec.test(filePath) && !screenSpec.test(filePath) && !elementSpec.test(filePath))) {
      throw new Error(
        'Behavior spec path must be "specs/<name>.md", "screens/<screen-id>/specs/screen.md", or "screens/<screen-id>/specs/element-<element-id>.md".'
      );
    }
  }

  function validateWorkflowPath(filePath) {
    if (typeof filePath !== "string" ||
        !/^screens\/[a-z][a-z0-9-]*\/workflows\/[a-z][a-z0-9-]*\.mmd$/.test(filePath)) {
      throw new Error(
        'Workflow path must be "screens/<screen-id>/workflows/<workflow-id>.mmd".'
      );
    }
    return filePath;
  }

  function validateElementId(id, context = "Element") {
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error(`${context} id must use lowercase letters, numbers, and hyphens.`);
    }
    return id;
  }

  function splitMaterialDocument(source, context = "Material") {
    if (typeof source !== "string") {
      throw new Error(`${context} must be text.`);
    }
    const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) {
      throw errorAt(`${context} must begin with a YAML front matter block delimited by "---".`, source, 0);
    }
    return { header: match[1], body: source.slice(match[0].length) };
  }

  function formatMaterialDocument(header, body) {
    const normalizedHeader = header.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    return `---\n${normalizedHeader}\n---\n${body}`;
  }

  function validateMaterialDocumentHeader(data, source) {
    if (!isMapping(data)) throw new Error(`${source} front matter must contain a YAML mapping.`);
    const supportedProperties = new Set([
      "id", "name", "description", "type", "attributes", "preview-size"
    ]);
    for (const property of Object.keys(data)) {
      if (!supportedProperties.has(property)) {
        throw new Error(`${source} front matter has unsupported property "${property}".`);
      }
    }
    validateElementId(data.id, `${source} front matter Material`);
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw new Error(`${source} front matter name must be a non-empty string.`);
    }
    if (data.description !== undefined && typeof data.description !== "string") {
      throw new Error(`${source} front matter description must be a string.`);
    }
    if (!materialTypes.includes(data.type)) {
      throw new Error(`${source} front matter type must be one of: ${materialTypes.join(", ")}.`);
    }
    if (data["preview-size"] !== undefined) {
      const size = data["preview-size"];
      if (!isMapping(size) ||
          Object.keys(size).some((property) => !["width", "height"].includes(property))) {
        throw new Error(`${source} front matter preview-size must contain only width and height.`);
      }
      if (!Number.isInteger(size.width) || size.width < 24 ||
          !Number.isInteger(size.height) || size.height < 24) {
        throw new Error(`${source} front matter preview-size width and height must be integers of at least 24 pixels.`);
      }
    }
    validateAttributeDefinitions(data, `${source} front matter`);
  }

  function validateMaterialMarkup(markup, source, lineOffset = 0) {
    if (typeof markup !== "string" || !markup.trim()) {
      throw errorAt(
        `${source} must contain one HTML element.`,
        typeof markup === "string" ? markup : "",
        0,
        lineOffset
      );
    }
    const materialStyles = [
      ...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)
        .map((match) => match[1]),
      ...markup.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi)
        .map((match) => match[1] ?? match[2] ?? match[3])
    ].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    const zIndex = /(?:^|[;{])\s*z-index\s*:/i.exec(materialStyles);
    if (zIndex) {
      const offset = markup.search(/z-index\s*:/i);
      throw errorAt(
        `${source} cannot set the CSS "z-index" property; Screen layers control Material stacking.`,
        markup,
        offset,
        lineOffset
      );
    }
    for (const match of markup.matchAll(/\$\{/g)) {
      const placeholder = markup.slice(match.index).match(/^\$\{([^}]*)\}/);
      if (!placeholder || !/^attributes\.[a-zA-Z_][a-zA-Z0-9_-]*$/.test(placeholder[1])) {
        throw errorAt(
          placeholder
            ? `${source} placeholders must reference declared attributes as \${attributes.<name>}.`
            : `${source} contains a malformed attribute placeholder.`,
          markup,
          match.index,
          lineOffset
        );
      }
    }
    const interactiveElement = /<(?:a|audio|base|button|embed|form|iframe|input|link|object|script|select|textarea|video)\b/i.exec(markup);
    if (interactiveElement) {
      throw errorAt(
        `${source} cannot contain links, interactive controls, forms, scripts, or embedded documents.`,
        markup,
        interactiveElement.index,
        lineOffset
      );
    }
    const layoutSlot = /data-specux-slot\s*=/i.exec(markup);
    if (layoutSlot) {
      throw errorAt(`${source} cannot define layout slots.`, markup, layoutSlot.index, lineOffset);
    }

    const voidElements = new Set([
      "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
      "param", "source", "track", "wbr"
    ]);
    const sourceWithoutCommentsAndStyles = markup
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
    const tagPattern = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
    const openTags = [];
    let rootCount = 0;
    for (const match of sourceWithoutCommentsAndStyles.matchAll(tagPattern)) {
      const tagName = match[1].toLowerCase();
      if (match[0][1] === "/") {
        if (openTags.pop()?.name !== tagName) {
          throw errorAt(
            `${source} must use balanced HTML elements.`,
            markup,
            markup.indexOf(match[0]),
            lineOffset
          );
        }
        continue;
      }
      if (openTags.length === 0 && ++rootCount > 1) {
        throw errorAt(
          `${source} must contain one root HTML element and no layout group.`,
          markup,
          markup.indexOf(match[0]),
          lineOffset
        );
      }
      const selfClosing = /\/\s*>$/.test(match[0]);
      if (!selfClosing && !voidElements.has(tagName)) {
        openTags.push({ name: tagName, offset: markup.indexOf(match[0]) });
      }
    }
    if (openTags.length > 0) {
      throw errorAt(
        `${source} must contain one balanced root HTML element.`,
        markup,
        openTags[openTags.length - 1].offset,
        lineOffset
      );
    }
    if (rootCount !== 1) {
      throw errorAt(`${source} must contain one balanced root HTML element.`, markup, 0, lineOffset);
    }
  }

  function getElementSpecIdentity(filePath) {
    const match = typeof filePath === "string"
      ? filePath.match(/^screens\/([a-z][a-z0-9-]*)\/specs\/element-([a-z][a-z0-9-]*)\.md$/)
      : null;
    return match ? { screenId: match[1], elementId: match[2] } : null;
  }

  function validateElementSpecPath(filePath, elementId) {
    validateSpecPath(filePath);
    validateElementId(elementId);
    const expectedPath = `${filePath.slice(0, filePath.lastIndexOf("/") + 1)}element-${elementId}.md`;
    if (filePath !== expectedPath) {
      throw new Error(`Element behavior spec "${filePath}" must be named "element-${elementId}.md".`);
    }
  }

  function parseSpecScreenReferences(source, context = "Behavior spec") {
    if (typeof source !== "string") {
      throw new Error(`${context} must be Markdown text.`);
    }

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
        let url;
        try {
          url = new URL(match[1]);
        } catch {
          if (match[1].startsWith("specux://screen/")) {
            throw errorAt(`${context}: invalid Screen link "${match[1]}".`, source, lineOffset(source, lineIndex) + match.index);
          }
          continue;
        }
        if (url.protocol !== "specux:" || url.hostname !== "screen") continue;

        let pathSegments;
        try {
          pathSegments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        } catch {
          throw errorAt(`${context}: invalid Screen link path "${match[1]}".`, source, lineOffset(source, lineIndex) + match.index);
        }
        if (pathSegments[1] !== "screen.yml") continue;
        if (url.username || url.password || url.port || url.hash ||
            pathSegments.length !== 2 ||
            !/^[a-z][a-z0-9-]*$/.test(pathSegments[0])) {
          throw errorAt(`${context}: invalid Screen link "${match[1]}".`, source, lineOffset(source, lineIndex) + match.index);
        }

        const queryEntries = [...url.searchParams.entries()];
        if (queryEntries.some(([key]) => !["placement", "state"].includes(key)) ||
            url.searchParams.getAll("placement").length > 1 ||
            url.searchParams.getAll("state").length > 1) {
          throw errorAt(
            `${context}: Screen links support one placement and one state parameter: "${match[1]}".`,
            source,
            lineOffset(source, lineIndex) + match.index
          );
        }
        const placementId = url.searchParams.get("placement");
        const stateId = url.searchParams.get("state") ?? "default";
        if ((placementId !== null && !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(placementId)) ||
            !/^[a-z][a-z0-9-]*$/.test(stateId)) {
          throw errorAt(
            `${context}: invalid placement or state in Screen link "${match[1]}".`,
            source,
            lineOffset(source, lineIndex) + match.index
          );
        }
        references.push({
          href: match[1],
          screenId: pathSegments[0],
          placementId,
          stateId,
          lineIndex,
          columnIndex: match.index,
          sectionLineIndex: headings.at(-1)?.lineIndex ?? lineIndex
        });
      }
    }
    return references;
  }

  function lineOffset(source, lineIndex) {
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      const newline = source.indexOf("\n", offset);
      if (newline < 0) return source.length;
      offset = newline + 1;
    }
    return offset;
  }

  function validateSpecScreenReferences(source, screens, context = "Behavior spec") {
    const references = parseSpecScreenReferences(source, context);
    for (const reference of references) {
      const screen = screens.find((entry) => entry.id === reference.screenId);
      if (!screen) {
        throw errorAt(
          `${context}: Screen "${reference.screenId}" is not available.`,
          source,
          lineOffset(source, reference.lineIndex) + reference.columnIndex
        );
      }
      const data = screen.data || screen;
      if (!getPreviewStates(data).some((previewState) =>
        previewState.id === reference.stateId
      )) {
        throw errorAt(
          `${context}: Screen State "${reference.stateId}" is not available on Screen "${screen.id}".`,
          source,
          lineOffset(source, reference.lineIndex) + reference.columnIndex
        );
      }
      if (reference.placementId) {
        if (!containsPlacementPath(data.materials, reference.placementId)) {
          throw errorAt(
            `${context}: placement "${reference.placementId}" is not available on Screen "${screen.id}".`,
            source,
            lineOffset(source, reference.lineIndex) + reference.columnIndex
          );
        }
      }
    }
    return references;
  }

  function containsPlacementPath(placements, placementId) {
    const segments = placementId.split(".");
    if (segments.length === 1) {
      const containsId = (siblings) => Array.isArray(siblings) &&
        siblings.some((placement) =>
          placement.id === placementId || containsId(placement.children)
        );
      return containsId(placements);
    }
    let siblings = placements;
    for (let index = 0; index < segments.length; index += 1) {
      if (!Array.isArray(siblings)) return false;
      const placement = siblings.find((entry) => entry.id === segments[index]);
      if (!placement) return false;
      if (index < segments.length - 1 && placement.type !== "group") return false;
      siblings = placement.children;
    }
    return true;
  }

  function validateSpecContent(source) {
    if (typeof source !== "string") {
      throw new Error("Behavior spec content must be Markdown text.");
    }

    const normalizedSource = source.replace(/\r\n?/g, "\n");
    const lines = normalizedSource.split("\n");
    const lineStarts = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }
    const errorOnLine = (message, lineIndex, column = 0) =>
      errorAt(message, normalizedSource, lineStarts[lineIndex] + column);
    const errorAtEnd = (message) => errorAt(message, normalizedSource, normalizedSource.length);
    const purposeIndex = lines.findIndex((line) => /^## Purpose\s*$/.test(line));
    const requirementsIndex = lines.findIndex((line) => /^## Requirements\s*$/.test(line));
    if (purposeIndex < 0) throw errorAtEnd('Behavior spec must include a "## Purpose" section.');
    if (requirementsIndex < 0) throw errorAtEnd('Behavior spec must include a "## Requirements" section.');
    if (purposeIndex >= requirementsIndex) {
      throw errorOnLine('"## Purpose" must appear before "## Requirements".', requirementsIndex);
    }
    const purposeEnd = lines.findIndex((line, index) => index > purposeIndex && /^##\s/.test(line));
    if (!lines.slice(purposeIndex + 1, purposeEnd < 0 ? lines.length : purposeEnd)
      .some((line) => line.trim())) {
      throw errorOnLine('"## Purpose" must contain a description.', purposeIndex);
    }

    const requirementsEnd = lines.findIndex((line, index) => index > requirementsIndex && /^##\s/.test(line));
    const sectionEnd = requirementsEnd < 0 ? lines.length : requirementsEnd;
    const requirementIndexes = [];
    for (let index = requirementsIndex + 1; index < sectionEnd; index += 1) {
      if (/^### Requirement:/.test(lines[index])) requirementIndexes.push(index);
    }
    if (requirementIndexes.length === 0) {
      throw errorOnLine(
        '"## Requirements" must contain at least one "### Requirement: <name>" heading.',
        requirementsIndex
      );
    }

    for (let index = 0; index < requirementIndexes.length; index += 1) {
      const requirementIndex = requirementIndexes[index];
      const name = lines[requirementIndex].slice("### Requirement:".length).trim();
      if (!name) {
        throw errorOnLine('Each "### Requirement:" heading must have a name.', requirementIndex);
      }
      if (name.length >= 50) {
        throw errorOnLine(
          `Requirement name "${name}" must be shorter than 50 characters.`,
          requirementIndex
        );
      }
      if (!/\b(?:SHALL|MUST|SHOULD|MAY)\s+\S/.test(lines[requirementIndex + 1] || "")) {
        throw errorOnLine(
          `Requirement "${name}" must be followed immediately by a normative SHALL, MUST, SHOULD, or MAY statement.`,
          requirementIndex
        );
      }

      const requirementEnd = index + 1 < requirementIndexes.length
        ? requirementIndexes[index + 1]
        : sectionEnd;
      const scenarioIndexes = [];
      for (let lineIndex = requirementIndex + 1; lineIndex < requirementEnd; lineIndex += 1) {
        if (/^#### Scenario:/.test(lines[lineIndex])) scenarioIndexes.push(lineIndex);
      }
      if (scenarioIndexes.length === 0) {
        throw errorOnLine(
          `Requirement "${name}" must contain at least one "#### Scenario: <name>" section.`,
          requirementIndex
        );
      }

      for (let scenarioIndex = 0; scenarioIndex < scenarioIndexes.length; scenarioIndex += 1) {
        const lineIndex = scenarioIndexes[scenarioIndex];
        if (!/^#### Scenario:\s+\S/.test(lines[lineIndex])) {
          throw errorOnLine(
            `Requirement "${name}" has a scenario heading without a name.`,
            lineIndex
          );
        }
        const scenarioEnd = scenarioIndex + 1 < scenarioIndexes.length
          ? scenarioIndexes[scenarioIndex + 1]
          : requirementEnd;
        const steps = lines.slice(lineIndex + 1, scenarioEnd)
          .map((step, index) => ({
            type: step.match(/^\s*-\s+\*\*(GIVEN|WHEN|THEN|AND|SHOW)\*\*\s+\S/)?.[1],
            lineIndex: lineIndex + index + 1
          }))
          .filter((step) => step.type);
        if (!steps.some((step) => step.type === "WHEN") ||
            !steps.some((step) => step.type === "THEN")) {
          throw errorOnLine(
            'Each scenario must include "- **WHEN** ..." and "- **THEN** ..." steps.',
            lineIndex
          );
        }
        const showStep = steps.find((step) => step.type === "SHOW");
        const thenStep = steps.find((step) => step.type === "THEN");
        if (showStep && showStep.lineIndex < thenStep.lineIndex) {
          throw errorOnLine(
            'A scenario "- **SHOW** <state-id>" step must follow its "- **THEN** ..." step.',
            showStep.lineIndex
          );
        }
      }
    }

    return true;
  }

  function validateScreenSpecStateReferences(source, states, context) {
    const documents = Array.isArray(source) ? source : [{ content: source }];
    const shownStateIds = new Map();
    for (const document of documents) {
      const documentContext = document.path ? `${context} (${document.path})` : context;
      const lines = document.content.replace(/\r\n?/g, "\n").split("\n");
      let inScenario = false;
      let thenSeen = false;
      for (const [lineIndex, line] of lines.entries()) {
        if (/^#### Scenario:\s+\S/.test(line)) {
          inScenario = true;
          thenSeen = false;
          continue;
        }
        if (/^(?:##\s|###\s)/.test(line)) inScenario = false;
        if (/^\s*-\s+\*\*THEN\*\*\s+\S/.test(line)) thenSeen = true;
        if (!line.includes("**SHOW**")) continue;
        const match = line.match(/^\s*-\s+\*\*SHOW\*\*\s+([a-z][a-z0-9-]*)\s*$/);
        if (!match) {
          throw errorAt(
            `${documentContext}: SHOW steps must use the form "- **SHOW** <state-id>".`,
            document.content,
            lineOffset(document.content, lineIndex) + Math.max(0, line.indexOf("**SHOW**"))
          );
        }
        if (!inScenario || !thenSeen) {
          throw errorAt(
            `${documentContext}: SHOW steps must appear in a scenario after its THEN step.`,
            document.content,
            lineOffset(document.content, lineIndex) + Math.max(0, line.indexOf("**SHOW**"))
          );
        }
        shownStateIds.set(match[1], {
          source: document.content,
          offset: lineOffset(document.content, lineIndex) + Math.max(0, line.indexOf("**SHOW**")),
          path: document.path
        });
      }
    }

    const stateIds = new Set(states.map((state) => state.id));
    for (const [stateId, reference] of shownStateIds) {
      if (!stateIds.has(stateId)) {
        const documentContext = reference.path ? `${context} (${reference.path})` : context;
        throw errorAt(
          `${documentContext}: linked spec references unknown Screen State "${stateId}".`,
          reference.source,
          reference.offset
        );
      }
    }
    const missingStateIds = states
      .filter((state) => state.id !== "default" && !shownStateIds.has(state.id))
      .map((state) => state.id);
    if (missingStateIds.length) {
      throw new Error(
        `${context}: specs linked to the Screen must reference every non-default Screen State with SHOW: ${missingStateIds.join(", ")}.`
      );
    }
  }

  function isValidAttributeValue(definition, value) {
    if (definition.type === "string") return typeof value === "string";
    if (definition.type === "boolean") return typeof value === "boolean";
    if (definition.type === "list") {
      return typeof value === "string" && definition.options?.includes(value) === true;
    }
    if (definition.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      return (definition.format || "decimal") !== "integer" || Number.isInteger(value);
    }
    return false;
  }

  function validateAttributeDefinitions(template, source) {
    const attributes = template.attributes || {};
    if (!isMapping(attributes)) {
      throw new Error(`${source} attributes must be a mapping.`);
    }
    for (const [name, definition] of Object.entries(attributes)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
        throw new Error(`${source} attribute name "${name}" must use letters, numbers, underscores, or hyphens and start with a letter or underscore.`);
      }
      if (!isMapping(definition)) {
        throw new Error(`${source} attribute "${name}" must be a mapping.`);
      }
      if (!attributeTypes.includes(definition.type)) {
        throw new Error(`${source} attribute "${name}" has unsupported type "${definition.type}".`);
      }
      if (definition.overridable !== undefined && typeof definition.overridable !== "boolean") {
        throw new Error(`${source} attribute "${name}" overridable must be a boolean.`);
      }
      if (definition.type === "number") {
        const format = definition.format || "decimal";
        if (!numberFormats.includes(format)) {
          throw new Error(`${source} attribute "${name}" has unsupported number format "${format}".`);
        }
      } else if (definition.format !== undefined) {
        throw new Error(`${source} attribute "${name}" can only define a number format when its type is number.`);
      }
      if (definition.type === "list") {
        if (!Array.isArray(definition.options) || definition.options.length === 0) {
          throw new Error(`${source} list attribute "${name}" must define at least one option.`);
        }
        if (definition.options.some((option) => typeof option !== "string") ||
            new Set(definition.options).size !== definition.options.length) {
          throw new Error(`${source} list attribute "${name}" options must be unique strings.`);
        }
      } else if (definition.options !== undefined) {
        throw new Error(`${source} attribute "${name}" can only define options when its type is list.`);
      }
      if (Object.hasOwn(definition, "default") && !isValidAttributeValue(definition, definition.default)) {
        throw new Error(`${source} attribute "${name}" has a default that does not match its type.`);
      }
    }
  }

  function validateMaterialAttributeMarkup(material, markup, source, lineOffset = 0) {
    const attributeNames = new Set(Object.keys(material.attributes || {}));
    for (const match of markup.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
      if (!attributeNames.has(match[1])) {
        throw errorAt(
          `${source} references undeclared attribute "${match[1]}".`,
          markup,
          match.index,
          lineOffset
        );
      }
    }
  }

  function validateMaterialInstanceAttributes(instance, material, source) {
    const attributes = instance.attributes ?? {};
    if (!isMapping(attributes)) {
      throw new Error(`${source} attributes must be a mapping.`);
    }
    for (const [name, value] of Object.entries(attributes)) {
      const definition = material.attributes?.[name];
      if (!definition) {
        throw new Error(`${source} uses undeclared Material attribute "${name}".`);
      }
      if (definition.overridable !== true) {
        throw new Error(`${source} Material attribute "${name}" is not overridable.`);
      }
      if (!isValidAttributeValue(definition, value)) {
        throw new Error(`${source} Material attribute "${name}" does not match its declared type.`);
      }
    }
  }

  function validateTheme(data, source) {
    const validateProperties = (value, allowedProperties, location) => {
      for (const property of Object.keys(value)) {
        if (!allowedProperties.has(property)) {
          throw new Error(`${location} contains unsupported property "${property}".`);
        }
      }
    };
    const validateTokens = (tokens, location) => {
      if (tokens === undefined) return;
      if (!isMapping(tokens)) throw new Error(`${location} tokens must be a mapping.`);
      for (const [name, value] of Object.entries(tokens)) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) {
          throw new Error(`${location} token name "${name}" must use lowercase letters, numbers, and hyphens.`);
        }
        if (typeof value !== "string") {
          throw new Error(`${location} token "${name}" must be a string.`);
        }
      }
    };

    validateProperties(data, new Set(["tokens", "modes"]), source);
    validateTokens(data.tokens, source);
    if (data.modes === undefined) return;
    if (data.tokens !== undefined) {
      throw new Error(`${source} must define either tokens or modes, not both.`);
    }
    if (!isMapping(data.modes)) throw new Error(`${source} modes must be a mapping.`);
    for (const [mode, variant] of Object.entries(data.modes)) {
      if (!themeModeNames.includes(mode)) {
        throw new Error(`${source} defines unsupported theme mode "${mode}".`);
      }
      if (!isMapping(variant)) throw new Error(`${source} ${mode} mode must be a mapping.`);
      validateProperties(variant, new Set(["tokens"]), `${source} ${mode} mode`);
      validateTokens(variant.tokens, `${source} ${mode} mode`);
    }
  }

  return {
    attributeTypes,
    MATERIAL_FILE_EXTENSION,
    getPreviewStates,
    isMapping,
    isValidAttributeValue,
    numberFormats,
    themeModeNames,
    validateAttributeDefinitions,
    validateMaterialDocumentHeader,
    validateMaterialMarkup,
    validateMaterialAttributeMarkup,
    validateMaterialInstanceAttributes,
    splitMaterialDocument,
    formatMaterialDocument,
    validateElementId,
    validateElementSpecPath,
    getElementSpecIdentity,
    parseSpecScreenReferences,
    validateSpecScreenReferences,
    validatePreviewStates,
    validateSpecContent,
    validateSpecPath,
    validateWorkflowPath,
    validateScreenSpecStateReferences,
    validateTheme
  };
});
