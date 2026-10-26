import { interactions } from "./interactions.mjs";
import { setApprovalPolicy } from "@deepseek-ai/dsh-user-approval";
import { HarnessSdkJsonRpcServer } from "@deepseek-ai/dsh-sdk-jsonrpc-server";
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
export const name = "orchmesh";
export const inject = [
  "agents",
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
    if (
      process.env.ORCHMESH_CONTROL_ONLY &&
      ![
        "initialize",
        "navigation/list",
        "navigation/update",
        "project/create",
        "project/rename",
        "session/create",
        "orchmesh/history",
        "activity/read",
        "activity/child-history",
        "session/rename",
        "session/fork",
        "project/delete",
        "workspace/attach",
        "shutdown",
      ].includes(method)
    )
      throw new Error("Control host does not execute sessions");
    if (method.startsWith("activity/")) return activity.handle(method, params);
    if (method === "orchmesh/open") {
      const saved = await ctx.sessionPersistence.stat(params.sessionId);
      if (!ctx.agents.get(params.sessionId)) {
        if (saved) await server.resume(params);
        else
          await server.handleRequest("session/working-directory/get", params);
      }
      activity.configure(params.reviewTools ?? false);
      if (params.reviewTools)
        setApprovalPolicy(ctx.sessions.get(params.sessionId), "ask");
      await ctx.sessionController.selectModel({
        sessionId: params.sessionId,
        ...selection,
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
      ctx.agents.get(params.sessionId)?.cancel({ kind: "user" });
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
