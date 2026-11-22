"use client";

import { useEffect, useState } from "react";

/**
 * Whether a horizontally scrollable element has content hidden to its right (or left). Drives the
 * edge fade that tells people a wide table continues, so cut-off columns don't look like a bug.
 */
export function useScrollEdges(ref: React.RefObject<HTMLElement | null>): { left: boolean; right: boolean } {
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = el.scrollWidth - el.clientWidth;
        const next = { left: el.scrollLeft > 1, right: max - el.scrollLeft > 1 };
        setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
      });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [ref]);

  return edges;
}
