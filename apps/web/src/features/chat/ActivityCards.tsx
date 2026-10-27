import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Action, Request, Item } from "./activity-types";

export function RequestCard({
  request,
  actor,
  disabled,
  act,
}: {
  request: Request;
  actor?: string;
  disabled: boolean;
  act: (body: Action) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState<
    Record<string, { selected: string[]; custom: string }>
  >({});
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-background p-3"
      aria-label={request.kind === "approval" ? "工具审批" : "等待你的回答"}
    >
      {actor && (
        <p className="text-xs text-muted-foreground">来自调用：{actor}</p>
      )}
      {request.kind === "approval" ? (
        <>
          <p className="font-medium">工具审批 · {request.toolName}</p>
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs">
            {request.reason}
          </pre>
          <div className="flex gap-2">
            <Button
              disabled={disabled}
              size="sm"
              onClick={() =>
                void act({
                  kind: "answer",
                  request_id: request.id,
                  outcome: "allowed-once",
                })
              }
            >
              仅允许这一次
            </Button>
            <Button
              disabled={disabled}
              size="sm"
              variant="outline"
              onClick={() =>
                void act({
                  kind: "answer",
                  request_id: request.id,
                  outcome: "rejected",
                })
              }
            >
              拒绝
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act({
              kind: "answer",
              request_id: request.id,
              answers: request.questions!.map((q) => ({
                id: q.id,
                selected: answers[q.id]?.selected || [],
                custom: answers[q.id]?.custom || undefined,
              })),
            });
          }}
        >
          <p className="font-medium">等待你的回答</p>
          {request.questions?.map((q) => (
            <fieldset
              key={q.id}
              disabled={disabled}
              className="flex min-w-0 flex-col gap-2"
            >
              <legend className="font-medium">{q.question}</legend>
              {q.detail && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {q.detail}
                </p>
              )}
              {q.options?.map((o) => (
                <label key={o.label} className="flex items-start gap-2">
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`${request.id}-${q.id}`}
                    checked={answers[q.id]?.selected.includes(o.label) || false}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.id]: {
                          custom: prev[q.id]?.custom || "",
                          selected: q.multiSelect
                            ? e.target.checked
                              ? [...(prev[q.id]?.selected || []), o.label]
                              : (prev[q.id]?.selected || []).filter(
                                  (x) => x !== o.label,
                                )
                            : [o.label],
                        },
                      }))
                    }
                  />
                  <span>
                    {o.label}
                    {o.description && (
                      <span className="block text-xs text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <Input
                aria-label={`补充回答：${q.question}`}
                placeholder="也可以输入自己的回答"
                value={answers[q.id]?.custom || ""}
                onChange={(e) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [q.id]: {
                      selected: q.multiSelect ? prev[q.id]?.selected || [] : [],
                      custom: e.target.value,
                    },
                  }))
                }
              />
            </fieldset>
          ))}
          <Button
            size="sm"
            disabled={
              disabled ||
              request.questions?.some(
                (q) =>
                  !answers[q.id]?.selected.length &&
                  !answers[q.id]?.custom.trim(),
              )
            }
          >
            提交回答
          </Button>
        </form>
      )}
    </div>
  );
}

export function QueueItem({
  item,
  target,
  disabled,
  act,
}: {
  item: Item;
  target: string;
  disabled: boolean;
  act: (body: Action) => Promise<boolean>;
}) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
      <span className="text-xs text-muted-foreground">
        {target === "next-step" ? "下一步" : "排队中"}
      </span>
      {edit ? (
        <Input
          aria-label="编辑排队消息"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {item.content.map((p) => p.text || "").join("\n")}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          if (!edit) {
            setText(item.content.map((p) => p.text || "").join("\n"));
            setEdit(true);
          } else
            void act({
              kind: "queue",
              item_id: item.id,
              action: "edit",
              text,
            }).then((ok) => {
              if (ok) setEdit(false);
            });
        }}
      >
        {edit ? "保存" : "编辑"}
      </Button>
      {target === "next-turn" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            void act({ kind: "queue", item_id: item.id, action: "steer" })
          }
        >
          提前执行
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          void act({ kind: "queue", item_id: item.id, action: "remove" })
        }
      >
        移除
      </Button>
    </div>
  );
}
