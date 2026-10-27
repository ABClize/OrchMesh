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
import { useState } from "react";
import { ReasoningSettings } from "./ReasoningSettings";
import { api } from "@/lib/api";
vi.mock("@/lib/api", () => ({ api: { GET: vi.fn(), PUT: vi.fn() } }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Container = ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => null,
    DropdownMenuRadioGroup: Container,
    DropdownMenuRadioItem: ({
      children,
      disabled,
    }: React.PropsWithChildren<{ disabled?: boolean }>) => (
      <button disabled={disabled}>{children}</button>
    ),
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect,
    }: React.PropsWithChildren<{
      disabled?: boolean;
      onSelect?: (event: { preventDefault: () => void }) => void;
    }>) => (
      <button
        disabled={disabled}
        onClick={() => onSelect?.({ preventDefault() {} })}
      >
        {children}
      </button>
    ),
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const catalog = {
  default_model: "fast",
  models: [
    { id: "fast", name: "Fast", efforts: [{ id: "high", label: "high" }] },
    { id: "plain", name: "Plain", efforts: [] },
  ],
};
function setup(child: React.ReactNode) {
  vi.mocked(api.GET).mockResolvedValue({
    data: catalog,
    response: new Response(),
  } as never);
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {child}
    </QueryClientProvider>,
  );
}
test("draft model switch resets unsupported effort and removes unavailable options", async () => {
  function Draft() {
    const [model, setModel] = useState("fast");
    const [effort, setEffort] = useState("high");
    return (
      <ReasoningSettings
        value={effort}
        modelId={model}
        onChange={setEffort}
        onModelChange={setModel}
        running={false}
      />
    );
  }
  setup(<Draft />);
  fireEvent.click(await screen.findByRole("button", { name: "Plain" }));
  await waitFor(() =>
    expect(
      screen.getByLabelText("思考强度：自动").hasAttribute("disabled"),
    ).toBe(true),
  );
  expect(screen.queryByText("深入分析复杂任务")).toBeNull();
  expect(api.PUT).not.toHaveBeenCalled();
});
test("failed persisted model change retains current selection and reports failure", async () => {
  vi.mocked(api.PUT).mockResolvedValue({
    error: { detail: "busy" },
    response: new Response(null, { status: 409 }),
  } as never);
  setup(
    <ReasoningSettings
      id="conversation"
      value="high"
      modelId="fast"
      running={false}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Plain" }));
  await screen.findAllByRole("alert");
  expect(screen.getByLabelText("选择模型").textContent).toContain("Fast");
  expect(api.PUT).toHaveBeenCalledWith(
    "/api/conversations/{conversation_id}/reasoning",
    {
      params: { path: { conversation_id: "conversation" } },
      body: { model_id: "plain" },
    },
  );
});
