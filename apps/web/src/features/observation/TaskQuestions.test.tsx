// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { TaskQuestions } from "./TaskQuestions";
import type { TaskDetail } from "./model";
import { platformRequest } from "@/lib/platform";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const task = {
  id: "child-task",
  name: "研究",
  questions: [
    {
      callId: "question-1",
      questions: [
        {
          id: "language",
          question: "语言",
          options: [{ label: "中文" }, { label: "英文" }],
        },
      ],
    },
    { callId: "question-2", questions: [{ id: "scope", question: "范围" }] },
  ],
} as unknown as TaskDetail;
test("answers bind to child task and batch; failure preserves input and independent forms", async () => {
  vi.mocked(platformRequest).mockRejectedValueOnce(new Error("稍后重试"));
  render(<TaskQuestions task={task} readOnly={false} />);
  const cards = screen.getAllByLabelText("等待你的回答");
  fireEvent.click(within(cards[0]).getByRole("radio", { name: "中文" }));
  fireEvent.click(within(cards[0]).getByRole("button", { name: "提交回答" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("稍后重试"),
  );
  expect(platformRequest).toHaveBeenCalledWith(
    "/tasks/child-task/answers",
    "POST",
    {
      call_id: "question-1",
      answer: {
        answers: [{ id: "language", selected: ["中文"], custom: undefined }],
      },
    },
  );
  expect(
    (screen.getByRole("radio", { name: "中文" }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.change(within(cards[1]).getByRole("textbox"), {
    target: { value: "全部" },
  });
  expect(
    (within(cards[1]).getByRole("button") as HTMLButtonElement).disabled,
  ).toBe(false);
});
test("read-only question inputs and submit are disabled", () => {
  render(<TaskQuestions task={task} readOnly />);
  expect(
    (
      screen.getAllByRole("button", {
        name: "提交回答",
      })[0] as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByRole("radio", { name: "中文" }).closest("fieldset")?.disabled,
  ).toBe(true);
});
