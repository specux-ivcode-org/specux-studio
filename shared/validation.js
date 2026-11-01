(function exposeSpecuxValidation(root, factory) {
  // The schema/*.md files are the source of truth; update validation and tests whenever a schema changes.
  const validation = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = validation;
  } else {
    root.SpecuxValidation = validation;
  }
})(globalThis, () => {
  const TEMPLATE_FILE_EXTENSION = ".stml";
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
      if (ids.has(state.id)) throw new Error(`${source} defines preview state "${state.id}" more than once.`);
      if (typeof state.name !== "string" || !state.name.trim()) {
        throw new Error(`${source} preview state "${state.id}" must have a non-empty name.`);
      }
      if (state.id !== "default" &&
          (typeof state.description !== "string" || !state.description.trim())) {
        throw new Error(`${source} preview state "${state.id}" must have a non-empty description.`);
      }
      if (state.description !== undefined &&
          (typeof state.description !== "string" || !state.description.trim())) {
        throw new Error(`${source} preview state "${state.id}" description must be a non-empty string.`);
      }
      if (state.layers !== undefined && !isMapping(state.layers)) {
        throw new Error(`${source} preview state "${state.id}" layers must be a mapping.`);
      }
      if (state.placements !== undefined && !isMapping(state.placements)) {
        throw new Error(`${source} preview state "${state.id}" placements must be a mapping.`);
      }
      if (state.id === "default" &&
          (Object.keys(state.layers || {}).length || Object.keys(state.placements || {}).length)) {
        throw new Error(`${source} default preview state cannot contain overrides.`);
      }
      if (Object.keys(state).some((key) =>
        !["id", "name", "description", "layers", "placements"].includes(key)
      )) {
        throw new Error(`${source} preview state "${state.id}" has an unsupported property.`);
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

  function splitAssetDocument(source, context = "Asset template") {
    if (typeof source !== "string") {
      throw new Error(`${context} must be text.`);
    }
    const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) {
      throw new Error(`${context} must begin with a YAML front matter block delimited by "---".`);
    }
    return { header: match[1], body: source.slice(match[0].length) };
  }

  function formatAssetDocument(header, body) {
    const normalizedHeader = header.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    return `---\n${normalizedHeader}\n---\n${body}`;
  }

  function validateMaterialDocumentHeader(data, source) {
    if (!isMapping(data)) throw new Error(`${source} front matter must contain a YAML mapping.`);
    const supportedProperties = new Set(["id", "name", "description", "type", "attributes"]);
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
    validateAssetAttributes(data, `${source} front matter`);
  }

  function validateMaterialMarkup(markup, source) {
    if (typeof markup !== "string" || !markup.trim()) {
      throw new Error(`${source} must contain one HTML element.`);
    }
    for (const match of markup.matchAll(/\$\{([^}]+)\}/g)) {
      if (!/^attributes\.[a-zA-Z_][a-zA-Z0-9_-]*$/.test(match[1])) {
        throw new Error(`${source} placeholders must reference declared attributes as \${attributes.<name>}.`);
      }
    }
    if (markup.replace(/\$\{attributes\.[a-zA-Z_][a-zA-Z0-9_-]*\}/g, "").includes("${")) {
      throw new Error(`${source} contains a malformed attribute placeholder.`);
    }
    if (/<(?:a|audio|base|button|embed|form|iframe|input|link|object|script|select|textarea|video)\b/i.test(markup)) {
      throw new Error(`${source} cannot contain links, interactive controls, forms, scripts, or embedded documents.`);
    }
    if (/data-specux-slot\s*=/i.test(markup)) {
      throw new Error(`${source} cannot define layout slots.`);
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
        if (openTags.pop() !== tagName) {
          throw new Error(`${source} must use balanced HTML elements.`);
        }
        continue;
      }
      if (openTags.length === 0 && ++rootCount > 1) {
        throw new Error(`${source} must contain one root HTML element and no layout group.`);
      }
      const selfClosing = /\/\s*>$/.test(match[0]);
      if (!selfClosing && !voidElements.has(tagName)) openTags.push(tagName);
    }
    if (rootCount !== 1 || openTags.length > 0) {
      throw new Error(`${source} must contain one balanced root HTML element.`);
    }
  }

  function validateAssetTemplateHeader(data, source) {
    if (!isMapping(data)) throw new Error(`${source} front matter must contain a YAML mapping.`);
    const supportedProperties = new Set([
      "id", "name", "description", "category", "attributes", "slots", "render"
    ]);
    for (const property of Object.keys(data)) {
      if (property === "spec") {
        throw new Error(`${source}: behavior specs cannot be attached to asset templates; attach the spec to an Element in a Screen file.`);
      }
      if (!supportedProperties.has(property)) {
        throw new Error(`${source} front matter has unsupported property "${property}".`);
      }
    }
    validateElementId(data.id, `${source} front matter Asset template`);
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw new Error(`${source} front matter name must be a non-empty string.`);
    }
    if (typeof data.description !== "string") {
      throw new Error(`${source} front matter description must be a string.`);
    }
    if (data.render !== undefined) {
      if (!isMapping(data.render)) {
        throw new Error(`${source} front matter render must be a mapping.`);
      }
      if (Object.keys(data.render).some((property) => property !== "interactive")) {
        throw new Error(`${source} front matter render only supports the "interactive" property.`);
      }
      if (data.render.interactive !== undefined && typeof data.render.interactive !== "boolean") {
        throw new Error(`${source} front matter render interactive must be a boolean.`);
      }
    }
  }

  function validateElementSpecHeader(source, context = "Element behavior spec") {
    if (typeof source !== "string") {
      throw new Error(`${context} must be Markdown text.`);
    }
    const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontMatter) {
      throw new Error(`${context} must begin with YAML front matter containing "element-id".`);
    }
    let elementId;
    for (const line of frontMatter[1].split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match = line.match(/^element-id:\s*([a-z][a-z0-9-]*)\s*$/);
      if (!match) {
        throw new Error(`${context} front matter must contain only an "element-id" using lowercase letters, numbers, and hyphens.`);
      }
      if (elementId !== undefined) {
        throw new Error(`${context} front matter must contain "element-id" only once.`);
      }
      elementId = match[1];
    }
    if (!elementId) {
      throw new Error(`${context} front matter must contain an "element-id".`);
    }
    return elementId;
  }

  function validateElementSpecPath(filePath, elementId) {
    validateSpecPath(filePath);
    validateElementId(elementId);
    const expectedPath = `${filePath.slice(0, filePath.lastIndexOf("/") + 1)}element-${elementId}.md`;
    if (filePath !== expectedPath) {
      throw new Error(`Element behavior spec "${filePath}" must be named "element-${elementId}.md".`);
    }
  }

  function validateSpecContent(source) {
    if (typeof source !== "string") {
      throw new Error("Behavior spec content must be Markdown text.");
    }

    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const purposeIndex = lines.findIndex((line) => /^## Purpose\s*$/.test(line));
    const requirementsIndex = lines.findIndex((line) => /^## Requirements\s*$/.test(line));
    if (purposeIndex < 0) throw new Error('Behavior spec must include a "## Purpose" section.');
    if (requirementsIndex < 0) throw new Error('Behavior spec must include a "## Requirements" section.');
    if (purposeIndex >= requirementsIndex) {
      throw new Error('"## Purpose" must appear before "## Requirements".');
    }
    const purposeEnd = lines.findIndex((line, index) => index > purposeIndex && /^##\s/.test(line));
    if (!lines.slice(purposeIndex + 1, purposeEnd < 0 ? lines.length : purposeEnd)
      .some((line) => line.trim())) {
      throw new Error('"## Purpose" must contain a description.');
    }

    const requirementsEnd = lines.findIndex((line, index) => index > requirementsIndex && /^##\s/.test(line));
    const sectionEnd = requirementsEnd < 0 ? lines.length : requirementsEnd;
    const requirementIndexes = [];
    for (let index = requirementsIndex + 1; index < sectionEnd; index += 1) {
      if (/^### Requirement:/.test(lines[index])) requirementIndexes.push(index);
    }
    if (requirementIndexes.length === 0) {
      throw new Error('"## Requirements" must contain at least one "### Requirement: <name>" heading.');
    }

    for (let index = 0; index < requirementIndexes.length; index += 1) {
      const requirementIndex = requirementIndexes[index];
      const name = lines[requirementIndex].slice("### Requirement:".length).trim();
      if (!name) throw new Error('Each "### Requirement:" heading must have a name.');
      if (name.length >= 50) {
        throw new Error(`Requirement name "${name}" must be shorter than 50 characters.`);
      }
      if (!/\b(?:SHALL|MUST|SHOULD|MAY)\s+\S/.test(lines[requirementIndex + 1] || "")) {
        throw new Error(`Requirement "${name}" must be followed immediately by a normative SHALL, MUST, SHOULD, or MAY statement.`);
      }

      const requirementEnd = index + 1 < requirementIndexes.length
        ? requirementIndexes[index + 1]
        : sectionEnd;
      const scenarioIndexes = [];
      for (let lineIndex = requirementIndex + 1; lineIndex < requirementEnd; lineIndex += 1) {
        if (/^#### Scenario:/.test(lines[lineIndex])) scenarioIndexes.push(lineIndex);
      }
      if (scenarioIndexes.length === 0) {
        throw new Error(`Requirement "${name}" must contain at least one "#### Scenario: <name>" section.`);
      }

      for (let scenarioIndex = 0; scenarioIndex < scenarioIndexes.length; scenarioIndex += 1) {
        const lineIndex = scenarioIndexes[scenarioIndex];
        if (!/^#### Scenario:\s+\S/.test(lines[lineIndex])) {
          throw new Error(`Requirement "${name}" has a scenario heading without a name.`);
        }
        const scenarioEnd = scenarioIndex + 1 < scenarioIndexes.length
          ? scenarioIndexes[scenarioIndex + 1]
          : requirementEnd;
        const steps = lines.slice(lineIndex + 1, scenarioEnd)
          .map((line) => line.match(/^\s*-\s+\*\*(GIVEN|WHEN|THEN|AND|SHOW)\*\*\s+\S/)?.[1])
          .filter(Boolean);
        if (!steps.includes("WHEN") || !steps.includes("THEN")) {
          throw new Error('Each scenario must include "- **WHEN** ..." and "- **THEN** ..." steps.');
        }
        if (steps.includes("SHOW") && steps.indexOf("SHOW") < steps.indexOf("THEN")) {
          throw new Error('A scenario "- **SHOW** <state-id>" step must follow its "- **THEN** ..." step.');
        }
      }
    }

    return true;
  }

  function validateScreenSpecStateReferences(source, states, context) {
    const documents = Array.isArray(source) ? source : [{ content: source }];
    const shownStateIds = new Set();
    for (const document of documents) {
      const documentContext = document.path ? `${context} (${document.path})` : context;
      const lines = document.content.replace(/\r\n?/g, "\n").split("\n");
      let inScenario = false;
      let thenSeen = false;
      for (const line of lines) {
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
          throw new Error(`${documentContext}: SHOW steps must use the form "- **SHOW** <state-id>".`);
        }
        if (!inScenario || !thenSeen) {
          throw new Error(`${documentContext}: SHOW steps must appear in a scenario after its THEN step.`);
        }
        shownStateIds.add(match[1]);
      }
    }

    const stateIds = new Set(states.map((state) => state.id));
    for (const stateId of shownStateIds) {
      if (!stateIds.has(stateId)) {
        throw new Error(`${context}: linked spec references unknown preview state "${stateId}".`);
      }
    }
    const missingStateIds = states
      .filter((state) => state.id !== "default" && !shownStateIds.has(state.id))
      .map((state) => state.id);
    if (missingStateIds.length) {
      throw new Error(
        `${context}: specs linked to the Screen must reference every non-default preview state with SHOW: ${missingStateIds.join(", ")}.`
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

  function assetCategoryPath(template, source) {
    if (template.category === undefined) return ["Uncategorized"];
    if (typeof template.category !== "string" || !template.category.trim()) {
      throw new Error(`${source} category must be a non-empty slash-delimited path.`);
    }
    const segments = template.category.split("/").map((segment) => segment.trim());
    if (segments.some((segment) => !segment)) {
      throw new Error(`${source} category cannot contain empty path segments.`);
    }
    return segments;
  }

  function validateAssetAttributes(template, source) {
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

  function validateMaterialAttributeMarkup(material, markup, source) {
    const attributeNames = new Set(Object.keys(material.attributes || {}));
    for (const match of markup.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
      if (!attributeNames.has(match[1])) {
        throw new Error(`${source} references undeclared attribute "${match[1]}".`);
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

  function validateAssetSlots(template, source) {
    if (template.slots === undefined) return;
    if (!Array.isArray(template.slots) || template.slots.length === 0) {
      throw new Error(`${source} slots must be a non-empty list.`);
    }
    const ids = new Set();
    for (const slot of template.slots) {
      if (!isMapping(slot) || typeof slot.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(slot.id)) {
        throw new Error(`${source} slots must have an id using lowercase letters, numbers, and hyphens.`);
      }
      if (ids.has(slot.id)) throw new Error(`${source} defines slot "${slot.id}" more than once.`);
      if (slot.name !== undefined && typeof slot.name !== "string") {
        throw new Error(`${source} slot "${slot.id}" name must be a string.`);
      }
      ids.add(slot.id);
    }
  }

  function validateAssetSlotMarkup(template, markup, source) {
    if (!template.slots) return;
    const markupSlots = [];
    const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    const attributePattern = /(?:^|\s)data-specux-slot\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
    for (const match of markup.matchAll(tagPattern)) {
      if (match[0].startsWith("<!--")) continue;
      const attribute = attributePattern.exec(match[2]);
      if (attribute) markupSlots.push(attribute[1] ?? attribute[2] ?? attribute[3]);
    }

    const declaredSlots = new Set(template.slots.map((slot) => slot.id));
    for (const slot of template.slots) {
      const matching = markupSlots.filter((id) => id === slot.id);
      if (matching.length !== 1) {
        throw new Error(`${source} must contain exactly one element with data-specux-slot="${slot.id}".`);
      }
    }
    for (const id of markupSlots) {
      if (!declaredSlots.has(id)) {
        throw new Error(`${source} contains undeclared layout slot "${id}".`);
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
    assetCategoryPath,
    attributeTypes,
    TEMPLATE_FILE_EXTENSION,
    getPreviewStates,
    isMapping,
    isValidAttributeValue,
    numberFormats,
    themeModeNames,
    validateAssetAttributes,
    validateAssetSlotMarkup,
    validateAssetSlots,
    validateMaterialDocumentHeader,
    validateMaterialMarkup,
    validateMaterialAttributeMarkup,
    validateMaterialInstanceAttributes,
    splitAssetDocument,
    formatAssetDocument,
    validateElementId,
    validateAssetInstanceId: validateElementId,
    validateAssetTemplateHeader,
    validateElementSpecHeader,
    validateElementSpecPath,
    validatePreviewStates,
    validateSpecContent,
    validateSpecPath,
    validateWorkflowPath,
    validateScreenSpecStateReferences,
    validateTheme
  };
});
