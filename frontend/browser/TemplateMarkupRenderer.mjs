const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required",
  "reversed", "selected"
]);

export class TemplateMarkupRenderer {
  constructor({ appRoot }) {
    this.appRoot = appRoot;
  }

  mount(root, markup, materialBase, instance, material) {
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    this.applyPlaceholders(parsed, instance, material);
    parsed.querySelectorAll("script, iframe, object, embed, form, base, link").forEach((node) => node.remove());
    parsed.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on")) {
          node.removeAttribute(attribute.name);
        } else if (name === "style") {
          node.setAttribute(attribute.name, this.rewriteCss(attribute.value, materialBase));
        } else if (name === "src" || name === "href") {
          const safeUrl = this.safeResource(attribute.value, materialBase);
          if (safeUrl) node.setAttribute(attribute.name, safeUrl);
          else node.removeAttribute(attribute.name);
        }
      }
    });

    parsed.querySelectorAll("style").forEach((style) => {
      const scopedStyle = document.createElement("style");
      scopedStyle.textContent = this.scopeCss(root, this.rewriteCss(style.textContent, materialBase));
      root.append(scopedStyle);
      style.remove();
    });
    for (const child of [...parsed.body.childNodes]) {
      root.append(document.importNode(child, true));
    }
  }

  applyPlaceholders(parsed, instance, material) {
    for (const node of parsed.querySelectorAll("*")) {
      for (const attribute of [...node.attributes]) {
        if (!attribute.value.includes("${")) continue;
        const exactMatch = /^\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}$/.exec(attribute.value);
        if (exactMatch && booleanHtmlAttributes.has(attribute.name.toLowerCase())) {
          const value = this.getPlaceholderValue(instance, material, exactMatch[1]);
          if (value === true) node.setAttribute(attribute.name, "");
          else node.removeAttribute(attribute.name);
          continue;
        }
        node.setAttribute(
          attribute.name,
          this.interpolatePlaceholders(attribute.value, instance, material)
        );
      }
    }

    const walker = document.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode.nodeValue.includes("${")) {
        textNode.nodeValue = this.interpolatePlaceholders(textNode.nodeValue, instance, material);
      }
      textNode = walker.nextNode();
    }
  }

  interpolatePlaceholders(text, instance, material) {
    return text.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g, (_, path) =>
      String(this.getPlaceholderValue(instance, material, path) ?? "")
    );
  }

  getPlaceholderValue(instance, material, path) {
    const value = this.getInstanceValue(instance, material, path);
    const attributePath = path.startsWith("attributes.") ? path.slice("attributes.".length) : null;
    if (value === undefined && attributePath && !material.data.attributes?.[attributePath]) {
      throw new Error(`Material "${material.id}" references undefined attribute "${attributePath}".`);
    }
    return value;
  }

  safeResource(path, materialBase) {
    if (!path || path.startsWith("#") || path.startsWith("data:image/")) return path;
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return null;
    const url = new URL(path, materialBase);
    if (url.origin !== this.appRoot.origin || !url.pathname.startsWith(materialBase.pathname)) return null;
    return url.href;
  }

  rewriteCss(css, materialBase) {
    return css
      .replace(/@import[^;]+;/gi, "")
      .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (match, doubleQuoted, singleQuoted, bare) => {
        const resource = doubleQuoted ?? singleQuoted ?? bare.trim();
        const safeUrl = this.safeResource(resource, materialBase);
        return safeUrl ? `url("${safeUrl}")` : "none";
      });
  }

  getInstanceValue(instance, material, path) {
    const normalized = path.startsWith("attributes.") ? path.slice("attributes.".length) : path;
    if (normalized.startsWith("attributes.")) return undefined;
    const definition = material.data.attributes?.[normalized];
    if (definition) {
      if (definition.overridable === true && Object.hasOwn(instance.attributes || {}, normalized)) {
        return instance.attributes[normalized];
      }
      return Object.hasOwn(definition, "default")
        ? definition.default
        : definition.type === "boolean" ? false : undefined;
    }
    return instance[normalized];
  }

  scopeCss(root, css) {
    if (!(root instanceof HTMLElement)) return css;
    const scopedCss = css
      .replace(/:host\(([^()]*)\)/g, ":scope$1")
      .replace(/:host(?![-\w])/g, ":scope");
    return `@scope (#${root.id}) {\n${scopedCss}\n}`;
  }
}
