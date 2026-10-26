import { interactions } from "./interactions.mjs";
import { setApprovalPolicy } from "@deepseek-ai/dsh-user-approval";
import { HarnessSdkJsonRpcServer } from "@deepseek-ai/dsh-sdk-jsonrpc-server";
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
export const name = "orchmesh";
export const inject = [
  "agents",
  "jobs",
  "approval",
  "userQuestions",
  "subagents",
  "sessions",
  "workingDirectory",
  "sessionPersistence",
  "tools",
  "llm",
  "sessionController",
  "workspaceController",
  "workspaceRegistry",
];
export function apply(ctx) {
  let selection;
  const failures = new Map();
  ctx.on("agent/error", ({ agent, error }) => {
    failures.set(String(agent.id), { error, offset: agent.session.seq });
  });
  ctx.on("session/event", (session, event) => {
    const failure = failures.get(String(session.id));
    if (event.type === "turn/end" && failure && event.seq >= failure.offset)
      failures.delete(String(session.id));
  });
  const activity = interactions(ctx);
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const server = new HarnessSdkJsonRpcServer(ctx, transport, {
    maxTokensAsSuccess: false,
  });
  ctx.provide("sdkSessionActivation", { ready: true });
  ctx.on("agent/assistant-stream", ({ agent, frame }) =>
    transport.notify("orchmesh.stream", { sessionId: String(agent.id), frame }),
  );
  transport.onRequest(async (method, params) => {
    if (method === "initialize") {
      await ctx.get("loader")?.await();
      params = {
        ...params,
        cwd: process.cwd(),
        provider: "project-api",
        model: process.env.ORCHMESH_RUNTIME_MODEL,
      };
    }
    if (method === "initialize") {
      selection = {
        provider: params.provider,
        model: params.model,
        ...(params.reasoningEffort
          ? { reasoningEffort: params.reasoningEffort }
          : {}),
      };
    }
    if (method === "orchmesh/busy") {
      // Same public state used by the official desktop quit/update inspector.
      const agents = ctx.agents.list();
      let busy =
        agents.some(
          (agent) =>
            agent.status === "running" ||
            agent.inbox.nextTurn.length ||
            agent.inbox.nextStep.length,
        ) ||
        [undefined, ...agents].some((agent) =>
          ctx.jobs
            .list(agent?.id)
            .some(
              (job) => job.status === "running" || job.status === "stopping",
            ),
        );
      for (const agent of agents) {
        const activity = await ctx.waterfall(
          "workspace/session-activity",
          { sessionId: agent.id },
          () => Promise.resolve([]),
        );
        if (activity.some((entry) => entry.kind === "schedule")) busy = true;
      }
      return { busy };
    }
    if (method === "orchmesh/model") {
      const info = await ctx.llm.resolveModelInfo(
        "project-api",
        process.env.ORCHMESH_RUNTIME_MODEL,
      );
      return {
        model: process.env.ORCHMESH_RUNTIME_MODEL,
        efforts: info.reasoning?.efforts ?? [],
        defaultEffort: info.reasoning?.defaultEffort ?? null,
      };
    }
    if (method.startsWith("activity/")) return activity.handle(method, params);
    if (method === "orchmesh/open") {
      const resolved = await ctx.sessionController.resolveAgent(
        params.sessionId,
      );
      if (resolved.error) throw resolved.error;
      activity.configure(params.reviewTools ?? false);
      setApprovalPolicy(
        ctx.sessions.get(params.sessionId),
        params.reviewTools ? "ask" : "never",
      );
      const { reasoningEffort: initialEffort, ...model } = selection;
      const effort = params.reasoningEffort ?? initialEffort;
      await ctx.sessionController.selectModel({
        sessionId: params.sessionId,
        ...model,
        ...(effort && effort !== "default" ? { reasoningEffort: effort } : {}),
      });
      return {
        events: (await ctx.sessionController.inspect(params.sessionId)).events,
      };
    }
    if (method === "orchmesh/history") {
      return {
        activity: await activity.handle("activity/read", params),
        events: (await ctx.sessionController.inspect(params.sessionId)).events,
        archived: ctx.workspaceRegistry.archivedSessionIds.includes(
          params.sessionId,
        ),
      };
    }
    if (method === "orchmesh/wait") {
      // SDK session/wait only accepts sessions owned by that SDK server.
      // Controller owns our sessions; use the same public Agent/Subagent wait
      // primitives as the SDK, without adopting its private session registry.
      const agent = ctx.agents.get(params.sessionId);
      if (!agent) throw new Error("Session is not active");
      while (true) {
        await agent.whenIdle();
        const seq = agent.session.seq;
        const children = await ctx.subagents.waitForChildren(agent);
        if (ctx.agents.get(params.sessionId) !== agent)
          throw new Error("Session was disposed while waiting");
        if (!children && agent.status === "idle" && agent.session.seq === seq) {
          const failure = failures.get(String(agent.id));
          if (failure) throw failure.error;
          await ctx.sessions.flush(agent.session);
          return {};
        }
      }
    }
    if (method === "session/prompt") {
      return ctx.sessionController.prompt(
        {
          sessionId: params.sessionId,
          requestId: params.requestId ?? crypto.randomUUID(),
          mode: params.mode ?? "queue",
          content: params.contentBlocks,
        },
        new AbortController().signal,
      );
    }
    if (method === "navigation/list") {
      const signal = new AbortController().signal;
      const sessions = await ctx.sessionController.list({}, signal);
      // List rows contain cached hints. Read the official projection for exact titles.
      for (const session of sessions.items) {
        session.projections = await ctx.sessionController.projections(
          { sessionId: session.sessionId },
          signal,
        );
      }
      return {
        workspaces: ctx.workspaceRegistry.list().map((w) => ({
          id: String(w.id),
          path: w.path,
          title: w.title,
          sessionIds: w.sessionIds,
        })),
        pinned: ctx.workspaceRegistry.pinnedSessionIds,
        archived: ctx.workspaceRegistry.archivedSessionIds,
        sessions,
      };
    }
    if (method === "project/create") {
      const result = await ctx.workspaceController.create({
        path: params.path,
      });
      return ctx.workspaceController.rename({
        workspaceId: result.workspace.workspaceId,
        title: params.title,
      });
    }
    if (method === "project/rename")
      return ctx.workspaceController.rename(params);
    if (method === "project/delete")
      return ctx.workspaceController.delete(params);
    if (method === "session/rename" || method === "session/fork") {
      const value =
        method === "session/rename"
          ? await ctx.sessionController.rename(params)
          : await ctx.sessionController.fork(params);
      const session = ctx.sessions.get(value.sessionId ?? params.sessionId);
      if (session) await ctx.sessions.flush(session);
      return value;
    }
    if (method === "workspace/attach") {
      const workspace = ctx.workspaceRegistry.get(params.workspaceId);
      if (!workspace) throw new Error("Workspace not found");
      const inspected = await ctx.sessionController.inspect(params.sessionId);
      if (inspected.meta.cwd !== workspace.path) return { attached: false };
      await workspace.attachSession(params.sessionId);
      return { attached: true };
    }
    if (method === "session/create") {
      const created = await ctx.sessionController.create({
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.workspaceId
          ? { workspaceId: params.workspaceId }
          : { cwd: "/workspaces/default" }),
      });
      const session = ctx.sessions.get(created.sessionId);
      if (session) await ctx.sessions.flush(session);
      return created;
    }
    if (method === "navigation/update") {
      const request = { sessionId: params.sessionId };
      if (params.archived !== undefined) {
        await (params.archived
          ? ctx.workspaceController.archiveSession(request)
          : ctx.workspaceController.unarchiveSession(request));
      }
      if (params.pinned !== undefined && !params.archived) {
        await (params.pinned
          ? ctx.workspaceController.pinSession(request)
          : ctx.workspaceController.unpinSession(request));
      }
      return {
        pinned: ctx.workspaceRegistry.pinnedSessionIds.includes(
          params.sessionId,
        ),
        archived: ctx.workspaceRegistry.archivedSessionIds.includes(
          params.sessionId,
        ),
      };
    }
    if (method === "orchmesh/stop") {
      // The product's Stop means stop the whole submitted task, including its inbox.
      const agent = ctx.agents.get(params.sessionId);
      if (!agent) return {};
      agent.cancel({ kind: "user" });
      await agent.whenIdle();
      const descendants = await ctx.subagents.listDescendants(agent.id);
      const children = await ctx.subagents.listChildren(agent.id);
      await ctx.subagents.drainChildren(agent, children.map((child) => child.id));
      for (const owner of [agent.id, ...descendants.map((child) => child.id)]) {
        for (const job of ctx.jobs.list(owner)) {
          if (job.owner === owner && ["running", "stopping"].includes(job.status))
            ctx.jobs.kill(job.id, owner, "user stopped task");
        }
      }
      return {};
    }
    const result = await server.handleRequest(method, params);
    if (method === "shutdown")
      setImmediate(async () => {
        await transport.flush();
        await ctx.root.fiber.dispose();
        process.exit(0);
      });
    return result;
  });
  ctx.effect(() => {
    transport.start();
    return async () => {
      await server.shutdown();
      transport.close();
    };
  }, "orchmesh.rpc");
}
