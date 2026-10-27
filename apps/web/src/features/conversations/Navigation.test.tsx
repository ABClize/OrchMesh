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
import { Navigation } from "./Navigation";
import { platformRequest } from "@/lib/platform";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
// Exercise management state transitions independently of Radix pointer dispatch.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: React.PropsWithChildren<{ onSelect: () => void }>) => (
    <button onClick={onSelect}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup(archived = false) {
  const onArchive = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Navigation
        archived={archived}
        setArchived={vi.fn()}
        conversations={[
          {
            id: "one",
            title: "验收对话",
            archived,
            pinned: false,
            reasoning: "default",
            project_id: null,
            directory_id: null,
            created_at: "2026-10-27",
          },
        ]}
        id="one"
        projectId={null}
        busy={false}
        onSelect={vi.fn()}
        onProject={vi.fn()}
        onArchive={onArchive}
      />
    </QueryClientProvider>,
  );
  return onArchive;
}
test("failed archive keeps the current conversation open", async () => {
  vi.mocked(platformRequest).mockRejectedValue(new Error("任务正在执行"));
  const closed = setup();
  fireEvent.click(screen.getByRole("button", { name: "归档" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "任务正在执行",
  );
  expect(closed).not.toHaveBeenCalled();
});
test("deletion requires confirmation and closes only after server success", async () => {
  vi.mocked(platformRequest).mockResolvedValue({ status: "deleted" });
  const closed = setup(true);
  fireEvent.click(screen.getByRole("button", { name: "删除对话…" }));
  expect(platformRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
  await waitFor(() => expect(closed).toHaveBeenCalledWith("one"));
  expect(platformRequest).toHaveBeenCalledWith("/conversations/one", "DELETE");
});

test("navigation preserves pinned history without booting a project runtime", () => {
  const select = vi.fn();
  const rows = [
    { id: "ordinary", title: "普通会话", pinned: false, archived: false },
    { id: "pinned", title: "已置顶历史", pinned: true, archived: false },
    { id: "archived", title: "归档会话", pinned: false, archived: true },
  ].map((row) => ({
    ...row,
    project_id: null,
    directory_id: null,
    created_at: "2026-10-27",
    reasoning: "default",
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Navigation
        archived={false}
        setArchived={vi.fn()}
        conversations={rows}
        id={null}
        projectId={null}
        busy={false}
        onSelect={select}
        onProject={vi.fn()}
        onArchive={vi.fn()}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("button", { name: "新建项目" })).toBeNull();
  expect(screen.queryByRole("button", { name: "归档会话" })).toBeNull();
  const pinned = screen.getByRole("button", {
    name: "已置顶历史",
  });
  fireEvent.click(pinned);
  expect(select).toHaveBeenCalledWith(rows[1]);
  const ordinary = screen.getByRole("button", {
    name: "普通会话",
  });
  expect(
    pinned.compareDocumentPosition(ordinary) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
