import { useLayoutEffect, useRef, type ComponentProps } from "react";
/** Animate semantic changes only, never initial mount or an identical stream replay. */
export function AnimatedValue({
  value,
  ...props
}: ComponentProps<"span"> & { value: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !element.current?.animate) return;
    const animation = element.current.animate(
      [
        { opacity: 0.35, transform: "translateY(-3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    const cancel = () => {
      if (motion.matches) animation.cancel();
    };
    motion.addEventListener("change", cancel);
    return () => {
      motion.removeEventListener("change", cancel);
      animation.cancel();
    };
  }, [value]);
  return <span ref={element} {...props} />;
}
