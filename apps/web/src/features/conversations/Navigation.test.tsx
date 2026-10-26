// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigation } from "./Navigation";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { GET: get } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <Navigation
        archived={false}
        setArchived={vi.fn()}
        conversations={[]}
        id={null}
        projectId={null}
        busy={false}
        onSelect={vi.fn()}
        onProject={vi.fn()}
        onArchive={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

test("initial navigation distinguishes loading from an empty project list", async () => {
  let finish!: (value: unknown) => void;
  get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mount();
  expect(screen.getByRole("status").textContent).toContain("正在加载项目");
  expect(
    screen
      .getByRole("navigation", { name: "项目列表" })
      .getAttribute("aria-busy"),
  ).toBe("true");
  finish({
    data: [{ id: "p", name: "已存在的项目", created_at: "2026-10-26" }],
  });
  expect(
    await screen.findByRole("button", { name: "已存在的项目" }),
  ).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

test("failed project load is visible instead of silently showing only ungrouped", async () => {
  get.mockResolvedValue({ error: { detail: "unavailable" } });
  mount();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "项目加载失败",
  );
});
