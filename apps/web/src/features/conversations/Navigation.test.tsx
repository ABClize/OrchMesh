// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigation } from "./Navigation";

afterEach(cleanup);
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
