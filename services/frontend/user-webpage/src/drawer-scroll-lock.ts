const mountedDrawers = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** Lock for the content's actual lifetime, including exit transitions and nested drawers. */
export function drawerScrollLockRef(content: HTMLElement | null) {
  if (!content) return;
  const root = content.ownerDocument.documentElement;
  const drawers = mountedDrawers.get(root) ?? new Set<HTMLElement>();
  mountedDrawers.set(root, drawers);
  if (drawers.size === 0) {
    // The lock releases the reserved scrollbar gutter so overlays reach the window edge;
    // padding of the width it released keeps the page where it was.
    const unlockedWidth = root.getBoundingClientRect().width;
    root.setAttribute("data-drawer-scroll-lock", "");
    const gutter = Math.max(0, root.getBoundingClientRect().width - unlockedWidth);
    root.style.setProperty("--ui-scrollbar-gutter", `${String(gutter)}px`);
  }
  drawers.add(content);

  return () => {
    drawers.delete(content);
    if (drawers.size === 0) {
      root.removeAttribute("data-drawer-scroll-lock");
      root.style.removeProperty("--ui-scrollbar-gutter");
      mountedDrawers.delete(root);
    }
  };
}
