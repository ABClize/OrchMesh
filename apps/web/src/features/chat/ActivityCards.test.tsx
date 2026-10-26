// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RequestCard, QueueItem } from "./ActivityCards";

afterEach(cleanup);

test("approval never defaults to consent and sends explicit rejection", () => {
  const act = vi.fn().mockResolvedValue(true);
  render(
    <RequestCard
      request={{
        id: "request",
        kind: "approval",
        sessionId: "s",
        toolName: "bash",
        reason: "printf safe",
      }}
      disabled={false}
      act={act}
    />,
  );
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
  expect(act).toHaveBeenCalledWith({
    kind: "answer",
    request_id: "request",
    outcome: "rejected",
  });
});

test("question requires explicit input and preserves official question ids", () => {
  const act = vi.fn().mockResolvedValue(true);
  render(
    <RequestCard
      request={{
        id: "r",
        kind: "question",
        sessionId: "s",
        questions: [
          {
            id: "q",
            question: "Choose language",
            options: [{ label: "Chinese" }, { label: "English" }],
          },
        ],
      }}
      disabled={false}
      act={act}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "提交回答" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Chinese" }));
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  expect(act).toHaveBeenCalledWith({
    kind: "answer",
    request_id: "r",
    answers: [{ id: "q", selected: ["Chinese"], custom: undefined }],
  });
});

test("queue edits retain item identity and do not mutate before saving", () => {
  const act = vi.fn().mockResolvedValue(true);
  render(
    <QueueItem
      item={{
        id: "inbox-message",
        content: [{ type: "text", text: "Before" }],
      }}
      target="next-turn"
      disabled={false}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "编辑排队消息" }), {
    target: { value: "After" },
  });
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(act).toHaveBeenCalledWith({
    kind: "queue",
    item_id: "inbox-message",
    action: "edit",
    text: "After",
  });
});
