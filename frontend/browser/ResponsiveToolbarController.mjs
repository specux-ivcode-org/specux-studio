export class ResponsiveToolbarController {
  constructor({ documentObject, windowObject, toolbarConfigs }) {
    this.document = documentObject;
    this.window = windowObject;
    this.toolbarConfigs = toolbarConfigs;
    this.instances = [];
    this.resizeObserver = null;
    this.mutationObserver = null;
    this.reflowQueued = false;
    this.scheduleReflow = this.scheduleReflow.bind(this);
  }

  bind() {
    for (const config of this.toolbarConfigs) {
      const toolbar = this.document.getElementById(config.toolbarId);
      const toggle = this.document.getElementById(config.toggleId);
      const menu = this.document.getElementById(config.menuId);
      if (!toolbar || !toggle || !menu) continue;

      const items = [...toolbar.querySelectorAll(
        ":scope > [data-overflow-group], :scope > [data-overflow-item]"
      )]
        .map((element) => {
          const placeholder = this.document.createComment("toolbar overflow position");
          element.after(placeholder);
          return {
            element,
            placeholder,
            priority: Number(element.dataset.overflowPriority) || 0
          };
        });
      const instance = { toolbar, toggle, menu, items };
      this.instances.push(instance);

      toggle.addEventListener("click", () => {
        const open = menu.hidden;
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
      });
      menu.addEventListener("click", (event) => {
        if (event.target.closest("button")) this.close(instance);
      });
      menu.addEventListener("change", (event) => {
        if (event.target.matches("select")) this.close(instance);
      });
      this.document.addEventListener("pointerdown", (event) => {
        if (!toolbar.contains(event.target)) this.close(instance);
      });
      this.document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || menu.hidden) return;
        event.preventDefault();
        this.close(instance);
        toggle.focus();
      });

      if (this.window.MutationObserver) {
        this.mutationObserver ||= new this.window.MutationObserver(this.scheduleReflow);
        for (const { element } of items) {
          this.mutationObserver.observe(element, {
            attributes: true,
            attributeFilter: ["hidden"],
            childList: true,
            characterData: true,
            subtree: true
          });
        }
      }

      this.reflow(instance);
    }

    if (this.window.ResizeObserver) {
      this.resizeObserver = new this.window.ResizeObserver((entries) => {
        for (const entry of entries) {
          const instance = this.instances.find(({ toolbar }) => toolbar === entry.target);
          if (instance) this.reflow(instance);
        }
      });
      this.instances.forEach(({ toolbar }) => this.resizeObserver.observe(toolbar));
    }
    this.window.addEventListener("resize", this.scheduleReflow, { passive: true });
  }

  scheduleReflow() {
    if (this.reflowQueued) return;
    this.reflowQueued = true;
    const requestFrame = this.window.requestAnimationFrame ||
      ((callback) => this.window.setTimeout(callback, 0));
    requestFrame.call(this.window, () => {
      this.reflowQueued = false;
      this.reflowAll();
    });
  }

  reflowAll() {
    this.instances.forEach((instance) => this.reflow(instance));
  }

  reflow(instance) {
    const { toolbar, toggle, menu, items } = instance;
    const menuWasOpen = !menu.hidden;
    this.restoreItems(instance);
    this.close(instance);
    toggle.hidden = true;

    if (toolbar.hidden || toolbar.getClientRects().length === 0 || toolbar.clientWidth === 0) return;
    if (this.fits(toolbar)) return;

    toggle.hidden = false;
    const overflowed = [];
    const priorityOrder = [...items].sort((left, right) => left.priority - right.priority);
    for (const item of priorityOrder) {
      if (this.fits(toolbar)) break;
      overflowed.push(item);
      menu.append(item.element);
    }
    if (!overflowed.length) {
      toggle.hidden = true;
      return;
    }

    const overflowedSet = new Set(overflowed);
    for (const item of items) {
      if (overflowedSet.has(item)) menu.append(item.element);
    }
    if (menuWasOpen) {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }
  }

  restoreItems({ items }) {
    for (const { element, placeholder } of items) placeholder.before(element);
  }

  fits(toolbar) {
    return toolbar.scrollWidth <= toolbar.clientWidth + 1;
  }

  close({ toggle, menu }) {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }
}
