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
import { PromptSettings } from "./PromptSettings";
import { platformRequest } from "@/lib/platform";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test("restore is staged until save and failed saves keep the edited prompt", async () => {
  const defaults = {
    continuation: "Default continuation",
    assistant: "Default assistant",
    builder: "Default builder",
    platform: "Default platform",
  };
  vi.mocked(platformRequest).mockImplementation(async (_path, method) => {
    if (method === "PUT") throw new Error("保存失败");
    return {
      prompts: { ...defaults, assistant: "Custom" },
      defaults,
      revision: "r1",
    };
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PromptSettings />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "恢复OrchMesh 主 Agent默认提示词",
    }),
  );
  expect(screen.getByLabelText("OrchMesh 主 Agent")).toHaveProperty(
    "value",
    "Default assistant",
  );
  expect(
    vi
      .mocked(platformRequest)
      .mock.calls.some(([, method]) => method === "PUT"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存提示词" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("保存失败"),
  );
  expect(screen.getByLabelText("OrchMesh 主 Agent")).toHaveProperty(
    "value",
    "Default assistant",
  );
  expect(platformRequest).toHaveBeenCalledWith("/settings/prompts", "PUT", {
    prompts: defaults,
    revision: "r1",
  });
});
