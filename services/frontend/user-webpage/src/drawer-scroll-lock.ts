const mountedDrawers = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** Lock for the content's actual lifetime, including exit transitions and nested drawers. */
export function drawerScrollLockRef(content: HTMLElement | null) {
  if (!content) return;
  const root = content.ownerDocument.documentElement;
  const drawers = mountedDrawers.get(root) ?? new Set<HTMLElement>();
  mountedDrawers.set(root, drawers);
  drawers.add(content);
  root.setAttribute("data-drawer-scroll-lock", "");

  return () => {
    drawers.delete(content);
    if (drawers.size === 0) {
      root.removeAttribute("data-drawer-scroll-lock");
      mountedDrawers.delete(root);
    }
  };
}
