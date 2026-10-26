// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../lib/api";
import { createDraftSender, sendPrompt } from "./commands";

afterEach(() => vi.restoreAllMocks());

test("a failed first send retains the created conversation for explicit retry", async () => {
  const post = vi.spyOn(api, "POST");
  post.mockResolvedValueOnce({
    data: { id: "draft-1" },
    response: new Response(),
  } as never);
  post.mockResolvedValueOnce({
    error: { detail: "busy" },
    response: new Response(null, { status: 409 }),
  } as never);
  post.mockResolvedValueOnce({ data: {}, response: new Response() } as never);
  const send = createDraftSender();
  await expect(send("first")).rejects.toThrow("已有任务运行");
  expect(post).toHaveBeenCalledTimes(2);
  await expect(send("retry")).resolves.toBe("draft-1");
  expect(post).toHaveBeenCalledTimes(3);
  expect(post.mock.calls[2]).toEqual([
    "/api/conversations/{conversation_id}/runs",
    {
      params: { path: { conversation_id: "draft-1" } },
      body: { text: "retry" },
    },
  ]);
});

test("failed creation cannot submit a run", async () => {
  const post = vi
    .spyOn(api, "POST")
    .mockRejectedValue(new TypeError("offline"));
  await expect(createDraftSender()("hello")).rejects.toThrow("offline");
  expect(post).toHaveBeenCalledTimes(1);
});

test("failed submission is reported rather than treated as accepted", async () => {
  vi.spyOn(api, "POST").mockResolvedValue({
    error: { detail: "failed" },
    response: new Response(null, { status: 500 }),
  } as never);
  await expect(sendPrompt("draft-1", "hello")).rejects.toThrow("发送失败");
});

test("signing out during creation must not start a run in the changed session", async () => {
  localStorage.setItem("access_token", "old-session");
  const post = vi.spyOn(api, "POST").mockImplementationOnce(async () => {
    localStorage.removeItem("access_token");
    return { data: { id: "draft-2" }, response: new Response() } as never;
  });
  await expect(createDraftSender()("hello")).rejects.toThrow("登录状态已改变");
  expect(post).toHaveBeenCalledTimes(1);
});

test("first prompt creates its conversation in the selected project", async () => {
  const post = vi.spyOn(api, "POST");
  post.mockResolvedValueOnce({
    data: { id: "project-chat" },
    response: new Response(),
  } as never);
  post.mockResolvedValueOnce({ data: {}, response: new Response() } as never);
  await expect(createDraftSender("project-one")("hello")).resolves.toBe(
    "project-chat",
  );
  expect(post.mock.calls[0]).toEqual([
    "/api/conversations",
    { body: { project_id: "project-one" } },
  ]);
});
