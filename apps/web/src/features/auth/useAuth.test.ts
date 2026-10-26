// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../lib/api", () => ({ api: { GET: get } }));
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { currentUser, resetAuthCache } from "./useAuth";

afterEach(() => get.mockReset());

test("only unauthorized means logged out; server failures stay errors", async () => {
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
  get.mockRejectedValue(new TypeError("network unavailable"));
  await expect(currentUser()).rejects.toThrow("network unavailable");
});

test("expiry clears private data without detaching the observed identity query", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["me"], { id: "old" });
  client.setQueryData(["conversations"], ["private"]);
  const observer = new QueryObserver(client, {
    queryKey: ["me"],
    queryFn: async () => null,
  });
  const unsubscribe = observer.subscribe(() => {});
  await resetAuthCache(client);
  expect(observer.getCurrentResult().isLoading).toBe(false);
  expect(observer.getCurrentResult().data).toBeNull();
  expect(client.getQueryData(["conversations"])).toBeUndefined();
  unsubscribe();
  client.clear();
});
