"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Lets a wide picture scroll sideways inside its own box on a small screen instead of
// shrinking until its labels are unreadable. While it really overflows, the box is a
// labelled, keyboard-focusable region (arrow keys scroll it) with a visible hint; when
// the picture fits there is no extra tab stop and no hint.
export default function ScrollRegion({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrollable(el.scrollWidth > el.clientWidth + 1);
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={scrollable ? 0 : undefined}
        className="overflow-x-auto lg:overflow-visible"
      >
        <div className="min-w-[620px] lg:min-w-0">{children}</div>
      </div>
      {scrollable && (
        <p
          data-testid="scroll-hint"
          className="px-2 pt-1 pb-0.5 text-center text-[11px] text-gp-faint"
        >
          {hint}
        </p>
      )}
    </>
  );
}
