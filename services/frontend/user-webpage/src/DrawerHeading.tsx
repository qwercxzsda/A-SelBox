import "./DrawerHeading.css";
import { useLayoutEffect, useRef } from "react";

/** The full scope is also present in the drawer body for assistive technology. */
export function DrawerHeading({ title, context }: { title: string; context: string }) {
  const heading = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const header = heading.current?.closest<HTMLElement>(".ui-drawer-header");
    const content = heading.current?.closest<HTMLElement>(".ui-drawer-content");
    if (!header || !content) return;
    // A wrapped scope can exceed the shared minimum height. Keep table headings below it.
    const measure = () => {
      content.style.setProperty(
        "--ui-drawer-content-header-height",
        `${String(header.getBoundingClientRect().height)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      observer.disconnect();
      content.style.removeProperty("--ui-drawer-content-header-height");
    };
  }, []);
  return (
    <span ref={heading} className="detail-drawer-heading">
      <span>{title}</span>
      <span className="detail-drawer-context" aria-hidden="true">
        {context}
      </span>
    </span>
  );
}
