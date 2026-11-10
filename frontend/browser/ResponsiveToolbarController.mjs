/** Moves toolbar controls into overflow menus as available space changes. */
export class ResponsiveToolbarController {

  /** Stores the injected collaborators and initializes the instance state. */
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

  /** Attaches the configured event listeners to the editor controls. */
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

  /** Updates the reflow for the current editor state. */
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

  /** Updates the all for the current editor state. */
  reflowAll() {
    this.instances.forEach((instance) => this.reflow(instance));
  }

  /** Moves low-priority toolbar controls into the overflow menu until the toolbar fits. */
  reflow(instance) {
    const { toolbar, toggle, menu, items } = instance;
    const menuWasOpen = !menu.hidden;
    this.restoreItems(instance);
    this.close(instance);
    toggle.hidden = true;

    if (!this.hasLayout(toolbar)) return;
    if (this.fits(toolbar)) return;

    toggle.hidden = false;
    const priorityOrder = [...items].sort((left, right) => left.priority - right.priority);
    const overflowed = this.moveItemsToMenu(priorityOrder, toolbar, menu);
    if (!overflowed.length) {
      toggle.hidden = true;
      return;
    }

    this.orderOverflowItems(items, overflowed, menu);
    if (menuWasOpen) this.openMenu(toggle, menu);
  }

  /** Checks whether the toolbar has measurable layout dimensions. */
  hasLayout(toolbar) {
    return !toolbar.hidden && toolbar.getClientRects().length > 0 && toolbar.clientWidth > 0;
  }

  /** Moves the items to menu for the current editor state. */
  moveItemsToMenu(items, toolbar, menu) {
    const overflowed = [];
    for (const item of items) {
      if (this.fits(toolbar)) break;
      overflowed.push(item);
      menu.append(item.element);
    }
    return overflowed;
  }

  /** Updates the overflow items for the current editor state. */
  orderOverflowItems(items, overflowed, menu) {
    const overflowedSet = new Set(overflowed);
    for (const item of items) {
      if (overflowedSet.has(item)) menu.append(item.element);
    }
  }

  /** Opens the menu in the editor. */
  openMenu(toggle, menu) {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  /** Restores the moved controls to their prior toolbar positions. */
  restoreItems({ items }) {
    for (const { element, placeholder } of items) placeholder.before(element);
  }

  /** Checks whether all toolbar items fit in the available width. */
  fits(toolbar) {
    return toolbar.scrollWidth <= toolbar.clientWidth + 1;
  }

  /** Closes the overflow menu and returns focus to its toggle when appropriate. */
  close({ toggle, menu }) {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }
}
