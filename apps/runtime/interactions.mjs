import { setApprovalPolicy } from "@deepseek-ai/dsh-user-approval";
// Web transport for official human-answerer seams and Session/Subagent APIs.
// DSH owns decisions, audit events, inbox persistence and child lifecycles.
export function interactions(ctx) {
  const pending = new Map();
  let reviewTools = false;
  function ask(kind, request) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (value, error) => {
        pending.delete(id);
        request.signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish(undefined, new Error("Request cancelled"));
      if (request.signal?.aborted) return abort();
      pending.set(id, {
        view: {
          id,
          kind,
          sessionId: String(request.agent.id),
          ...(kind === "approval"
            ? {
                toolName: request.toolName,
                callId: request.callId,
                reason: request.reason,
              }
            : { questions: request.questions }),
        },
        finish,
      });
      request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
  ctx.on("approval/request", (request) => ask("approval", request));
  ctx.on("user-questions/request", (request) => ask("question", request));
  // Optional deployment gate; the official tool pipeline handles ask/deny/audit.
  // Review every executable tool, rather than pretending to classify shell text.
  ctx.on("tools/pre-execute", async (exec, next) => {
    const decision = await next();
    if (
      !reviewTools ||
      decision.kind !== "allow" ||
      exec.name === "ask_user_question"
    )
      return decision;
    if (exec.agent && ctx.approval.overrideOf(exec.agent.session) !== "ask")
      setApprovalPolicy(exec.agent.session, "ask");
    return {
      kind: "ask",
      reason: `执行工具 ${exec.name}：${JSON.stringify(exec.arguments)}`,
    };
  });
  async function catalog(sessionId) {
    return ctx.subagents.listDescendants(sessionId);
  }
  async function child(sessionId, childId) {
    const entry = (await catalog(sessionId)).find(
      (item) => item.id === childId,
    );
    if (!entry || entry.kind !== "child" || entry.mode === "external")
      throw new Error("Child does not belong to this session");
    return entry;
  }
  return {
    configure(enabled) {
      reviewTools = enabled;
    },
    async handle(method, params) {
      const { sessionId } = params;
      if (method === "activity/read") {
        const projections = await ctx.sessionController.projections(
          { sessionId },
          new AbortController().signal,
        );
        const children = await Promise.all(
          (await catalog(sessionId)).map(async (item) => ({
            ...item,
            running: ctx.agents.get(item.id)?.status === "running",
            projections:
              item.kind === "diagnostic" || item.mode === "external"
                ? null
                : await ctx.sessionController.projections(
                    { sessionId: item.id },
                    new AbortController().signal,
                  ),
          })),
        );
        const scope = new Set([sessionId, ...children.map((item) => item.id)]);
        return {
          reviewTools,
          requests: [...pending.values()]
            .map((item) => item.view)
            .filter((item) => scope.has(item.sessionId)),
          inbox: projections?.values?.inbox ?? {
            "next-turn": [],
            "next-step": [],
          },
          children,
        };
      }
      if (method === "activity/answer") {
        const item = pending.get(params.requestId);
        if (!item) throw new Error("Request already settled");
        if (item.view.sessionId !== sessionId)
          await child(sessionId, item.view.sessionId);
        if (item.view.kind === "approval") {
          if (!["allowed-once", "rejected"].includes(params.outcome))
            throw new Error("Invalid approval");
          item.finish(params.outcome);
        } else {
          const answers = params.answers;
          const questions = item.view.questions;
          if (
            !Array.isArray(answers) ||
            answers.length !== questions.length ||
            new Set(answers.map((a) => a.id)).size !== questions.length
          )
            throw new Error("Incomplete answer batch");
          for (const q of questions) {
            const a = answers.find((a) => a.id === q.id);
            if (
              !a ||
              !Array.isArray(a.selected) ||
              (!q.multiSelect && a.selected.length > 1) ||
              a.selected.some((s) => !q.options?.some((o) => o.label === s)) ||
              (!a.selected.length && !a.custom?.trim())
            )
              throw new Error("Invalid answer");
          }
          item.finish({ answers });
        }
        return { accepted: true };
      }
      if (method === "activity/queue")
        return ctx.sessionController.updateQueue(params);
      if (method === "activity/child-history") {
        await child(sessionId, params.childId);
        return {
          events: (await ctx.sessionController.inspect(params.childId)).events,
        };
      }
      if (method === "activity/child-stop") {
        const entry = await child(sessionId, params.childId);
        ctx.subagents.interrupt(params.childId, {
          kind: "user",
          parentSessionId: entry.parentId,
        });
        return { accepted: true };
      }
      throw new Error("Unknown activity operation");
    },
  };
}
