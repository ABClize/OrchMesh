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
import { ModelEditor } from "./ModelEditor";
import { platformRequest } from "@/lib/platform";
import type { Profile } from "./types";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const model: Profile = {
  key: "stable",
  name: "Test",
  id: "wire",
  base_url: "https://example.com",
  api: "openai-completions",
  provider: "openai",
  thinking_format: null,
  reasoning_efforts: null,
  supported_efforts: ["high"],
  has_key: true,
};
function setup() {
  const saved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelEditor
        model={model}
        creating={false}
        catalog={{ models: [model], default: "stable", revision: "revision" }}
        onClose={vi.fn()}
        onSaved={saved}
      />
    </QueryClientProvider>,
  );
  return saved;
}
test("editing retains the hidden credential and saves a revision with native DSH capabilities", async () => {
  vi.mocked(platformRequest).mockResolvedValue({});
  const saved = setup();
  expect((screen.getByLabelText("API 密钥") as HTMLInputElement).value).toBe(
    "",
  );
  fireEvent.change(screen.getByLabelText("显示名称"), {
    target: { value: "Renamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存模型" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(platformRequest).toHaveBeenCalledWith(
    "/settings/models",
    "PUT",
    expect.objectContaining({
      key: "stable",
      name: "Renamed",
      api_key: "",
      reasoning_efforts: null,
      revision: "revision",
    }),
  );
});
test("failed connection test keeps the draft and never saves it", async () => {
  vi.mocked(platformRequest).mockRejectedValue(new Error("连接失败"));
  const saved = setup();
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接失败");
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText("显示名称")).toHaveProperty("value", "Test");
  expect(platformRequest).toHaveBeenCalledWith(
    "/settings/models/probe?test=true",
    "POST",
    expect.any(Object),
  );
});
