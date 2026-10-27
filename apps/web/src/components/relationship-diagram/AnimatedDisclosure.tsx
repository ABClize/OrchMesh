import { useLayoutEffect, useRef, type ReactNode } from "react";
/** Keeps only an empty animation shell on close; child subscriptions stop immediately. */
export function AnimatedDisclosure({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const outer = shell.current!;
    const inner = content.current!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = inner.getBoundingClientRect().height;
    let animation: Animation | undefined;
    const observer = new ResizeObserver(() => {
      const next = inner.getBoundingClientRect().height;
      if (next === target) return;
      const from =
        animation?.playState === "running"
          ? outer.getBoundingClientRect().height
          : target;
      target = next;
      animation?.cancel();
      if (!motion.matches && outer.animate) {
        animation = outer.animate(
          [{ height: `${from}px` }, { height: `${next}px` }],
          { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });
    const cancelOnReducedMotion = () => {
      if (motion.matches) animation?.cancel();
    };
    motion.addEventListener("change", cancelOnReducedMotion);
    observer.observe(inner);
    return () => {
      motion.removeEventListener("change", cancelOnReducedMotion);
      observer.disconnect();
      animation?.cancel();
    };
  }, []);
  return (
    <div ref={shell} aria-hidden={!open} style={{ overflow: "clip" }}>
      <div ref={content} style={{ display: "flow-root" }}>
        {open ? children : null}
      </div>
    </div>
  );
}
