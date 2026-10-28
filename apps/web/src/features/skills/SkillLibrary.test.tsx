// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SkillLibrary } from "./SkillLibrary";
import { useAuth } from "@/features/auth/useAuth";
vi.mock("@/features/auth/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn(async () => []) }));
afterEach(cleanup);
function page(admin: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    me: { data: { is_superuser: admin } },
  } as ReturnType<typeof useAuth>);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SkillLibrary />
    </QueryClientProvider>,
  );
}
test("ordinary users can browse the public library but have no import controls", async () => {
  page(false);
  expect(await screen.findByText("还没有可用 Skill")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "在线导入" })).toBeNull();
  expect(screen.queryByLabelText("上传 Skill 包")).toBeNull();
});
test("administrators get both import entry points", async () => {
  page(true);
  expect(await screen.findByRole("button", { name: "在线导入" })).toBeTruthy();
  expect(screen.getByLabelText("上传 Skill 包")).toBeTruthy();
});
