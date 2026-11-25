import { useEffect, useRef, type RefObject } from "react";
import { SCROLL_TOLERANCE, anchorScrollReserves, onScrollAnchor } from "./scroll-reserve";

const INTERACTIONS = ["pointerdown", "keydown", "wheel"] as const;

const topOf = (element: HTMLElement) => element.getBoundingClientRect().top;

function scrollToY(top: number) {
  window.scrollTo({ top, behavior: "instant" });
}

interface Anchor {
  /** The list's top on screen. */
  top: number;
  /** The list's top in the page; it changes when content above the list changes height. */
  pageTop: number;
}

/** Scroll by the change above `target` after a list action; returns the cleanup. */
function holdBelow(
  region: HTMLElement,
  target: HTMLElement,
  gap: HTMLElement,
  active: () => boolean,
) {
  const measure = (): Anchor => {
    const top = topOf(target);
    return { top, pageTop: top + window.scrollY };
  };
  let anchor = measure();
  let gapHeight = 0;
  function setGap(height: number) {
    gapHeight = Math.max(0, Math.ceil(height));
    gap.style.height = gapHeight > 0 ? `${String(gapHeight)}px` : "";
  }
  function reanchor() {
    anchor = measure();
  }
  /** Put the list back where it was on screen; space scrolling cannot give goes to the gap. */
  function restore() {
    const scrollY = window.scrollY;
    setGap(0);
    const wanted = scrollY + topOf(target) - anchor.top;
    setGap(-wanted);
    if (Math.abs(Math.max(0, wanted) - scrollY) > SCROLL_TOLERANCE) scrollToY(Math.max(0, wanted));
    anchorScrollReserves();
  }
  // Runs after layout (resize) and on scroll: the browser's own scroll anchoring may report the
  // change as a scroll first. A scroll by the user leaves the list's place in the page unchanged.
  function keepList() {
    const current = measure();
    const moved = Math.abs(current.pageTop - anchor.pageTop) > SCROLL_TOLERANCE;
    if (moved && active() && anchor.top < window.innerHeight) restore();
    else anchor = current;
  }
  /** Out of view, the gap goes: below the view nothing on screen moves; above it, scroll by it. */
  function releaseGap() {
    const box = gap.getBoundingClientRect();
    if (gapHeight === 0 || (box.top < window.innerHeight && box.bottom > 0)) return false;
    const before = topOf(target);
    setGap(0);
    if (box.bottom <= 0) window.scrollBy({ top: topOf(target) - before, behavior: "instant" });
    anchorScrollReserves();
    return true;
  }
  function onScroll() {
    if (!releaseGap()) keepList();
  }
  const observer = new ResizeObserver(keepList);
  observer.observe(region);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", reanchor);
  const stopAnchoring = onScrollAnchor(reanchor);
  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", reanchor);
    stopAnchoring();
    setGap(0);
  };
}

/**
 * Keep a list where it is on screen while the region above it changes height because of the
 * list's own controls. On Transactions a filter, search or chip also changes the summary above
 * the table, which would otherwise push or pull the table, its open column menu and the search box.
 *
 * After an action inside the list (its menus included), the page scrolls by the region's change.
 * What scrolling cannot absorb at the top of the page stays as space in `spacer`, below the region,
 * until that space is out of view. After an action anywhere else, such as in the summary itself,
 * the browser keeps its own scroll behavior.
 *
 * Returns capture handlers for the list's root element.
 */
export function useListHold(
  above: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  spacer: RefObject<HTMLElement | null>,
) {
  const listActive = useRef(false);
  useEffect(() => {
    if (!above.current || !list.current || !spacer.current) return;
    const stopHolding = holdBelow(
      above.current,
      list.current,
      spacer.current,
      () => listActive.current,
    );
    const leaveList = () => {
      listActive.current = false;
    };
    // Capture on the document runs before React's handlers on the list mark it active again.
    for (const type of INTERACTIONS)
      document.addEventListener(type, leaveList, { capture: true, passive: true });
    return () => {
      for (const type of INTERACTIONS) document.removeEventListener(type, leaveList, true);
      stopHolding();
    };
  }, [above, list, spacer]);
  const enterList = () => {
    listActive.current = true;
  };
  return {
    onPointerDownCapture: enterList,
    onKeyDownCapture: enterList,
    onWheelCapture: enterList,
  };
}

/**
 * Keep a panel tall enough to fill the screen while its content is replaced, such as a sub-tab
 * whose list remounts and loads; otherwise the shorter page pulls the view up and the tabs move
 * under the pointer. Call the returned function before the switch. The kept space goes as it
 * scrolls out of view below, or once the new content is taller.
 */
export function useHeightHold(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    function trim() {
      if (!element?.style.minHeight) return;
      const held = parseFloat(element.style.minHeight);
      const needed = Math.ceil(window.innerHeight - topOf(element));
      if (element.offsetHeight > held + SCROLL_TOLERANCE || needed <= 0)
        element.style.minHeight = "";
      else if (needed < held - SCROLL_TOLERANCE) element.style.minHeight = `${String(needed)}px`;
      else return;
      anchorScrollReserves();
    }
    const observer = new ResizeObserver(trim);
    observer.observe(element);
    window.addEventListener("scroll", trim, { passive: true });
    window.addEventListener("resize", trim);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", trim);
      window.removeEventListener("resize", trim);
    };
  }, [panel]);
  return () => {
    holdHeight(panel.current);
  };
}

/** Keep `element` at least tall enough to reach the bottom of the view. */
function holdHeight(element: HTMLElement | null) {
  if (!element) return;
  const needed = Math.ceil(window.innerHeight - topOf(element));
  element.style.minHeight = needed > 0 ? `${String(needed)}px` : "";
}
