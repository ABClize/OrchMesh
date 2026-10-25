// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../lib/api";
import { currentUser } from "./useAuth";

afterEach(() => vi.restoreAllMocks());

test("only unauthorized means logged out; server failures stay errors", async () => {
  const get = vi.spyOn(api, "GET");
  get.mockResolvedValue({
    error: { detail: "unauthorized" },
    response: new Response(null, { status: 401 }),
  });
  expect(await currentUser()).toBeNull();
  get.mockResolvedValue({
    error: { detail: "failure" },
    response: new Response(null, { status: 500 }),
  });
  await expect(currentUser()).rejects.toThrow("服务暂时不可用");
});

test("network failure is not treated as logout", async () => {
  vi.spyOn(api, "GET").mockRejectedValue(new TypeError("network unavailable"));
  await expect(currentUser()).rejects.toThrow("network unavailable");
});
