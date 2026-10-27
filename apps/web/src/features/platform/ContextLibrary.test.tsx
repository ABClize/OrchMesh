// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContextLibrary } from "./ContextLibrary";
import { platformRequest } from "@/lib/platform";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup() {
  vi.mocked(platformRequest).mockImplementation(async (path, method) => {
    if (method === "DELETE") throw new Error("删除失败，请重试");
    if (path === "/memory-settings") return { enabled: true };
    if (path === "/context/knowledge")
      return [
        {
          id: "one",
          title: "参考资料",
          content: "正文",
          enabled: true,
          agent_id: null,
        },
      ];
    return [];
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ContextLibrary />
    </QueryClientProvider>,
  );
}
test("delete requires confirmation, cancel preserves data, failure stays in dialog", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  expect(
    vi
      .mocked(platformRequest)
      .mock.calls.some(([, method]) => method === "DELETE"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent).toContain(
      "删除失败，请重试",
    ),
  );
  expect(platformRequest).toHaveBeenCalledWith(
    "/context/knowledge/one",
    "DELETE",
  );
});
test("creation is on demand and submits through the existing context API", async () => {
  setup();
  expect(screen.queryByLabelText("内容")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "添加知识" }));
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "新资料" },
  });
  fireEvent.change(screen.getByLabelText("内容"), {
    target: { value: "新正文" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(platformRequest).toHaveBeenCalledWith("/context/knowledge", "POST", {
    title: "新资料",
    content: "新正文",
  });
});
