// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import { AnimatedValue } from "./AnimatedValue";
let resize: () => void;
let reduced = false;
let onPreference: () => void;
const cancel = vi.fn();
const disconnect = vi.fn();
const animate = vi.fn(() => ({ cancel, playState: "running" }));
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, cb: () => void) => {
      onPreference = cb;
    },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test("identical updates preserve status, changed values animate once and cancel on unmount", () => {
  const { rerender, unmount } = render(
    <AnimatedValue value="running">执行中</AnimatedValue>,
  );
  rerender(<AnimatedValue value="running">执行中</AnimatedValue>);
  expect(animate).not.toHaveBeenCalled();
  rerender(<AnimatedValue value="completed">已完成</AnimatedValue>);
  expect(animate).toHaveBeenCalledTimes(1);
  rerender(<AnimatedValue value="completed">已完成</AnimatedValue>);
  expect(animate).toHaveBeenCalledTimes(1);
  unmount();
  expect(cancel).toHaveBeenCalled();
});
test("disclosure unmounts subscriptions before closing animation and cleans observers", () => {
  let height = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ height }) as DOMRect,
  );
  const stop = vi.fn();
  function Child() {
    useEffect(() => stop, []);
    return <div>订阅内容</div>;
  }
  const { rerender, unmount } = render(
    <AnimatedDisclosure open={false}>
      <Child />
    </AnimatedDisclosure>,
  );
  rerender(
    <AnimatedDisclosure open>
      <Child />
    </AnimatedDisclosure>,
  );
  height = 120;
  act(() => resize());
  expect(animate).toHaveBeenCalledTimes(1);
  rerender(
    <AnimatedDisclosure open={false}>
      <Child />
    </AnimatedDisclosure>,
  );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("订阅内容")).toBeNull();
  height = 0;
  act(() => resize());
  expect(cancel).toHaveBeenCalled();
  unmount();
  expect(disconnect).toHaveBeenCalled();
});
test("reduced motion skips transitions and a live preference change cancels animation", () => {
  reduced = true;
  const { rerender } = render(
    <AnimatedValue value="queued">排队</AnimatedValue>,
  );
  rerender(<AnimatedValue value="running">执行</AnimatedValue>);
  expect(animate).not.toHaveBeenCalled();
  reduced = false;
  rerender(<AnimatedValue value="completed">完成</AnimatedValue>);
  expect(animate).toHaveBeenCalledTimes(1);
  reduced = true;
  act(() => onPreference());
  expect(cancel).toHaveBeenCalled();
});
