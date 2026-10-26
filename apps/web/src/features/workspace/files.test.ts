// @vitest-environment jsdom
import { expect, test } from "vitest";
import { deliveredFiles } from "./files";
import { toThreadMessages } from "../chat/store";

test("persistent DSH tool output survives the real message projector", () => {
  const result = JSON.stringify({
    kind: "orchmesh.files.v1",
    files: [{ path: "report.html", name: "report.html", size: 30 }],
  });
  const projected = toThreadMessages(
    [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "f1",
            name: "present_files",
            arguments: { paths: ["report.html"] },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "f1",
        isError: false,
        content: [{ type: "text", text: result }],
      },
    ],
    "completed",
  );
  const content = projected[0].content;
  if (typeof content === "string") throw new Error("Expected tool parts");
  const tool = content.find((p) => p.type === "tool-call");
  expect(deliveredFiles(tool?.result)).toEqual([
    { path: "report.html", name: "report.html", size: 30 },
  ]);
});
test("unrelated tool text cannot become a delivery", () => {
  expect(deliveredFiles("report.html")).toEqual([]);
  expect(deliveredFiles('{"files":[{"path":"foo"}]}')).toEqual([]);
});

test("workspace tabs deduplicate, survive hiding, and clear on account reset", async () => {
  const { useFiles } = await import("./files");
  const files = useFiles.getState;
  files().reset();
  files().show("a/report.html");
  files().show("b/report.html");
  files().show("a/report.html");
  expect(files().tabs).toEqual(["a/report.html", "b/report.html"]);
  files().setFolder("b");
  files().close();
  files().show();
  expect(files().path).toBe("a/report.html");
  expect(files().folder).toBe("b");
  files().closeTab("a/report.html");
  expect(files().path).toBe("b/report.html");
  files().closeTab("b/report.html");
  expect(files().path).toBeNull();
  files().show("private.txt");
  files().reset();
  expect(files().tabs).toEqual([]);
  expect(files().folder).toBe("");
  expect(files().open).toBe(false);
});

test("switching projects clears file tabs and directory state", async () => {
  const { useFiles } = await import("./files");
  const state = useFiles.getState;
  state().reset();
  state().setProject("one");
  state().show("same-name.md");
  state().setFolder("reports");
  state().setProject("two");
  expect(state().tabs).toEqual([]);
  expect(state().path).toBeNull();
  expect(state().folder).toBe("");
  expect(state().projectId).toBe("two");
  state().reset();
  expect(state().projectId).toBeNull();
});

test("official deliveries stay scoped to the authorized workspace", () => {
  expect(
    deliveredFiles(
      JSON.stringify({
        kind: "dsh.deliverables",
        files: [
          { path: "/workspace/reports/a.md", description: "Report" },
          { path: "/state/config/models.json" },
          { path: "/workspace/../state/config/models.json" },
          { path: "/workspace//a" },
        ],
      }),
    ),
  ).toEqual([{ path: "reports/a.md", name: "a.md", description: "Report" }]);
});

test("native delivery event updates the existing live tool card", async () => {
  const { useChat } = await import("../chat/store");
  const result = JSON.stringify({
    kind: "dsh.deliverables",
    files: [{ path: "/workspace/proof.md" }],
  });
  useChat.getState().reset();
  useChat.getState().snapshot({
    status: "running",
    run_id: "run",
    cursor: 1,
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "native-present",
            name: "present",
            arguments: { files: [{ path: "proof.md" }] },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "native-present",
        content: [{ type: "text", text: "Presented /workspace/proof.md" }],
      },
    ],
  });
  useChat.getState().event({
    type: "tool_execution_end",
    toolCallId: "native-present",
    result: { content: [{ type: "text", text: result }] },
    isError: false,
  });
  const messages = toThreadMessages(useChat.getState().messages, "completed");
  const content = messages[0].content;
  if (typeof content === "string") throw new Error("Expected tool parts");
  expect(
    deliveredFiles(content.find((p) => p.type === "tool-call")?.result),
  ).toEqual([{ path: "proof.md", name: "proof.md" }]);
  useChat.getState().reset();
});

test("stable project paths only resolve inside the active execution workspace", async () => {
  const { useFiles } = await import("./files");
  useFiles.getState().setProject("original");
  expect(
    deliveredFiles(
      JSON.stringify({
        kind: "dsh.deliverables",
        files: [
          { path: "/workspaces/original/report.md" },
          { path: "/workspaces/other/report.md" },
          { path: "/workspaces/original/../other/report.md" },
        ],
      }),
    ),
  ).toEqual([{ path: "report.md", name: "report.md" }]);
  useFiles.getState().reset();
});
