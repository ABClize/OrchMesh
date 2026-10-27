import { useState } from "react";
import { RequestCard } from "@/features/chat/ActivityCards";
import type { Question } from "@/features/chat/activity-types";
import { platformRequest } from "@/lib/platform";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { record, type TaskDetail } from "./model";
export function parseQuestions(values: TaskDetail["questions"]) {
  return values.flatMap((value) => {
    if (typeof value.callId !== "string" || !Array.isArray(value.questions))
      return [];
    const questions: Question[] = value.questions.flatMap((item) => {
      const q = record(item);
      if (typeof q.id !== "string" || typeof q.question !== "string") return [];
      return [
        {
          id: q.id,
          question: q.question,
          detail: typeof q.detail === "string" ? q.detail : undefined,
          multiSelect: q.multiSelect === true || q.multi_select === true,
          options: Array.isArray(q.options)
            ? q.options.flatMap((option) => {
                const o = record(option);
                return typeof o.label === "string"
                  ? [
                      {
                        label: o.label,
                        description:
                          typeof o.description === "string"
                            ? o.description
                            : undefined,
                      },
                    ]
                  : [];
              })
            : undefined,
        },
      ];
    });
    return questions.length ? [{ callId: value.callId, questions }] : [];
  });
}
function QuestionBatch({
  taskId,
  name,
  batch,
  readOnly,
}: {
  taskId: string;
  name: string;
  batch: ReturnType<typeof parseQuestions>[number];
  readOnly: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="flex flex-col gap-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <RequestCard
        request={{
          id: `${taskId}:${batch.callId}`,
          kind: "question",
          sessionId: taskId,
          questions: batch.questions,
        }}
        actor={name}
        disabled={readOnly || pending || accepted}
        act={async (answer) => {
          if (pending || accepted || readOnly) return false;
          setPending(true);
          setError("");
          try {
            await platformRequest(
              `/tasks/${encodeURIComponent(taskId)}/answers`,
              "POST",
              { call_id: batch.callId, answer: { answers: answer.answers } },
            );
            setAccepted(true);
            return true;
          } catch (cause) {
            setError((cause as Error).message);
            return false;
          } finally {
            setPending(false);
          }
        }}
      />
      {accepted && (
        <p role="status" className="text-sm text-muted-foreground">
          回答已提交，等待任务更新。
        </p>
      )}
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          此对话为只读，不能提交回答。
        </p>
      )}
    </section>
  );
}
export function TaskQuestions({
  task,
  readOnly,
}: {
  task: TaskDetail;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {parseQuestions(task.questions).map((batch) => (
        <QuestionBatch
          key={`${task.id}:${batch.callId}`}
          taskId={task.id}
          name={task.name}
          batch={batch}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}
