/** Focus a stable results or controls region and bring it into view. */
export function revealSection(section: HTMLElement | null) {
  if (!section) return;
  section.focus({ preventScroll: true });
  section.scrollIntoView({ block: "start", behavior: "instant" });
}
