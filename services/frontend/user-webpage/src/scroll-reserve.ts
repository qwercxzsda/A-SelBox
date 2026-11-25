import { useEffect, type RefObject } from "react";

/** Browsers round scroll offsets and boxes to device pixels. */
export const SCROLL_TOLERANCE = 1;

interface Viewport {
  scrollY: number;
  innerHeight: number;
  scrollHeight: number;
  top: number;
}

const reanchors = new Set<() => void>();

/** An intentional scroll (for example a bottom pager reveal) becomes the position to keep. */
export function anchorScrollReserves() {
  for (const reanchor of reanchors) reanchor();
}

/** Every position keeper re-reads the position to keep after an intentional scroll. */
export function onScrollAnchor(reanchor: () => void): () => void {
  reanchors.add(reanchor);
  return () => {
    reanchors.delete(reanchor);
  };
}

/** What scrolls the list: the page, or an element such as a drawer. */
interface ScrollArea {
  scrollTop: () => number;
  clientHeight: () => number;
  scrollHeight: () => number;
  scrollTo: (top: number) => void;
  /** Where the reserve goes: after the area's content. */
  container: HTMLElement;
  events: Window | HTMLElement;
}

function pageArea(): ScrollArea {
  return {
    scrollTop: () => window.scrollY,
    clientHeight: () => window.innerHeight,
    scrollHeight: () => document.documentElement.scrollHeight,
    scrollTo: (top) => {
      window.scrollTo({ top, behavior: "instant" });
    },
    container: document.body,
    events: window,
  };
}

function elementArea(scroller: HTMLElement): ScrollArea {
  return {
    scrollTop: () => scroller.scrollTop,
    clientHeight: () => scroller.clientHeight,
    scrollHeight: () => scroller.scrollHeight,
    scrollTo: (top) => {
      scroller.scrollTo({ top, behavior: "instant" });
    },
    container: scroller,
    events: scroller,
  };
}

/** A drawer scrolls its own content; a list outside any drawer scrolls with the page. */
export function drawerScroller(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(".ui-drawer-content");
}

/**
 * Keep a list where it is on screen when its result gets shorter.
 *
 * A shorter result can end the scrolled content above the current view, and the browser then
 * pulls it up. After such a clamp, add only the missing space at the end of the content and
 * scroll back before paint. The space is released as it scrolls out of view, so a short list
 * never keeps a permanent blank area.
 *
 * The page scrolls the list unless `getScroller` names the element that does, such as a drawer.
 */
export function useScrollReserve(
  target: RefObject<HTMLElement | null>,
  getScroller?: (element: HTMLElement) => HTMLElement | null,
) {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const scroller = getScroller?.(element) ?? null;
    const area = scroller ? elementArea(scroller) : pageArea();
    let reserve: HTMLDivElement | null = null;
    let height = 0;
    const measure = (): Viewport => ({
      scrollY: area.scrollTop(),
      innerHeight: area.clientHeight(),
      scrollHeight: area.scrollHeight(),
      top: element.getBoundingClientRect().top,
    });
    let anchor = measure();

    function setHeight(value: number) {
      height = Math.max(0, Math.ceil(value));
      if (!reserve && height > 0) {
        reserve = document.createElement("div");
        reserve.className = "scroll-reserve";
        reserve.setAttribute("aria-hidden", "true");
        area.container.append(reserve);
      }
      if (reserve) reserve.style.height = `${String(height)}px`;
    }
    function reanchor() {
      anchor = measure();
    }
    function keepPosition() {
      const current = measure();
      const atEnd =
        current.scrollY + current.innerHeight >= current.scrollHeight - SCROLL_TOLERANCE;
      // Only shorter content can clamp; a resized view or a reveal keeps its new place.
      const clamped =
        atEnd &&
        current.innerHeight === anchor.innerHeight &&
        current.scrollHeight < anchor.scrollHeight - SCROLL_TOLERANCE;
      const shift = Math.min(current.top - anchor.top, anchor.scrollY - current.scrollY);
      if (clamped && shift > SCROLL_TOLERANCE) {
        const top = current.scrollY + shift;
        setHeight(height + shift);
        // Content now shorter than the view needs the rest of the view filled as well.
        const missing = top + current.innerHeight - area.scrollHeight();
        if (missing > 0) setHeight(height + missing);
        area.scrollTo(top);
      } else if (height > 0) {
        // Release the part of the reserve that is no longer on screen.
        const contentEnd = current.scrollHeight - height;
        setHeight(Math.min(height, current.scrollY + current.innerHeight - contentEnd));
      }
      reanchor();
    }

    const observer = new ResizeObserver(keepPosition);
    observer.observe(element);
    area.events.addEventListener("scroll", keepPosition, { passive: true });
    window.addEventListener("resize", reanchor);
    const stopAnchoring = onScrollAnchor(reanchor);
    return () => {
      observer.disconnect();
      area.events.removeEventListener("scroll", keepPosition);
      window.removeEventListener("resize", reanchor);
      stopAnchoring();
      reserve?.remove();
    };
  }, [target, getScroller]);
}
