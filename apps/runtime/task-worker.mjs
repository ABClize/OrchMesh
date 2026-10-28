import WorkingDirectory from "@deepseek-ai/dsh-working-directory";
import Skills from "@deepseek-ai/dsh-skill";
import * as ToolSkill from "@deepseek-ai/dsh-tool-skill";
import { installPromptObservation } from "./prompt-observation.mjs";
// Platform composition: the official DSH loop and persistence remain authoritative.
import { installProxyFromEnvironment } from "@deepseek-ai/dsh-http-proxy";
import { Context } from "@deepseek-ai/cordis";
import Llm, { createUserMessage } from "@deepseek-ai/dsh-llm";
import * as PiAI from "@deepseek-ai/dsh-llm-pi-ai";
import Sessions from "@deepseek-ai/dsh-session";
import Projection from "@deepseek-ai/dsh-session-projection";
import Prompt from "@deepseek-ai/dsh-system-prompt";
import Tools, { defineTool } from "@deepseek-ai/dsh-tools";
import Agents from "@deepseek-ai/dsh-agent";
import * as Jsonl from "@deepseek-ai/dsh-session-persistence-jsonl";
import { readColdSessionLog } from "@deepseek-ai/dsh-session-query";
import Loop from "@deepseek-ai/dsh-agent-loop";
import * as Retry from "@deepseek-ai/dsh-llm-retry";
import * as Checkpoint from "@deepseek-ai/dsh-session-checkpoint-policy";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Group from "@deepseek-ai/cordis-plugin-group";
import Presets from "@deepseek-ai/dsh-agent-preset-registry";
import { UserQuestionService } from "@deepseek-ai/dsh-user-questions";
import * as Ask from "@deepseek-ai/dsh-tool-ask-user";
import { createInterface } from "node:readline";
import Web from "@deepseek-ai/dsh-web";
import * as ToolWeb from "@deepseek-ai/dsh-tool-web";
import * as FetchHttp from "@deepseek-ai/dsh-web-fetch-http";
import * as SearchDeepSeek from "@deepseek-ai/dsh-web-search-deepseek";
import { modelRoute } from "./model-route.mjs";
import { mountRemote } from "./task-remote.mjs";
const lines = createInterface({ input: process.stdin });
const pending = new Map();
let configure;
const configPromise = new Promise((resolve) => {
  configure = resolve;
});
lines.on("line", (line) => {
  const value = JSON.parse(line);
  if (value.config) configure(value.config);
  else {
    const entry = pending.get(value.id);
    if (entry) {
      pending.delete(value.id);
      value.error
        ? entry.reject(new Error(value.error))
        : entry.resolve(value.result);
    }
  }
});
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const config = await configPromise;
const disposeProxy = await installProxyFromEnvironment(
  {
    get(name) {
      const value = process.env[name];
      return value === undefined ? undefined : { value };
    },
  },
  () => console.error("Invalid HTTP proxy configuration"),
);
const ctx = new Context();
let agent;
let phase = "completed";
let lastReason;
const heartbeat = setInterval(() => {}, 1000);
function request(name, args, callId) {
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    emit({ type: "tool", name, args, id: callId });
  });
}
try {
  await ctx.plugin(Loader);
  ctx.loader.builtins.group = Group;
  ctx.loader.builtins.platformPrompt = {
    name: "platform-prompt",
    inject: ["systemPrompt"],
    apply(c, options) {
      for (const [index, part] of options.parts.entries())
        c.effect(() => c.systemPrompt.section({
          name: part.name, order: 10 + index, text: part.text, interpolate: false,
        }));
    },
  };
  for (const p of [Llm, Sessions, Projection, Prompt, Tools, Agents])
    await ctx.plugin(p);
  await ctx.plugin(Jsonl, {
    root: config.root + "/sessions",
    compression: "none",
  });
  await ctx.plugin(Loop, { agents: [] });
  await ctx.plugin(Checkpoint);
  await ctx.plugin(Skills);
  for (const skill of config.skills ?? []) {
    const {warnings, revision, metadata, ...definition} = skill;
    ctx.skills.register({...definition, source: "orchmesh-bound"});
  }
  await ctx.plugin(WorkingDirectory, { defaultDirectory: "/workspace" });
  await ctx.plugin(ToolSkill);
  await ctx.plugin(Retry);
  await ctx.plugin(UserQuestionService);
  await ctx.plugin(Ask, { mode: "timed", timeout: 1 });
  ctx.on(
    "user-questions/request",
    async (question) => {
      const callId = question.wait.callId;
      const result = await Promise.race([
        request("user_question", { questions: question.questions }, callId),
        new Promise((_, reject) =>
          question.signal?.addEventListener(
            "abort",
            () => reject(question.signal.reason),
            { once: true },
          ),
        ),
      ]);
      return result;
    },
    { global: true },
  );
  process.env.ORCHMESH_TASK_MODEL_KEY = config.key;
  await ctx.plugin(PiAI, { providers: modelRoute(config.model) });
  if (config.web) {
    await ctx.plugin(Web);
    await ctx.plugin(FetchHttp);
    if (config.search?.key) {
      process.env.ORCHMESH_TASK_SEARCH_KEY = config.search.key;
      await ctx.plugin(SearchDeepSeek, {
        apiKeyEnv: "ORCHMESH_TASK_SEARCH_KEY",
        baseURL: config.search.baseURL,
        model: config.search.model,
      });
    }
    await ctx.plugin(ToolWeb, { search: !!config.search?.key, fetch: true });
  }
  await ctx.plugin(Presets, { default: config.version });
  await ctx.agentPresets.register({
    id: config.version,
    plugins: [
      { name: "cordis:platformPrompt", config: { parts: config.promptParts } },
    ],
  });
  if (config.remote) await mountRemote(ctx, config.remote);
  for (const spec of config.tools) {
    ctx.tools.register(
      defineTool({
        ...spec,
        output: {
          schema: { type: "string" },
          render: (_a, v) => [{ type: "text", text: v }],
        },
        async execute(args, exec) {
          const result = await request(spec.name, args, exec.callId);
          if (spec.name === "request_execution") {
            phase = "execution";
            exec.concludeTurn();
          }
          return JSON.stringify(result);
        },
      }),
    );
  }
  ctx.on(
    "agent/assistant-stream",
    ({ frame }) => emit({ type: "stream", frame }),
    { global: true },
  );
  ctx.on(
    "session/event",
    (_session, event) => {
      if (event.type === "turn/end") lastReason = event.data.reason.kind;
      emit({ type: "event", event });
    },
    { global: true },
  );
  installPromptObservation(ctx, config);
  const known = await ctx.sessionPersistence.list();
  const resumed = known.some((row) => row.header.id === config.task);
  let completed = false;
  if (resumed) {
    const cold = await readColdSessionLog(ctx.sessionPersistence, config.task);
    const last = cold.events.filter((e) => e.type === "turn/end").at(-1);
    // A flushed successful stop is a completion barrier, unlike a repaired interrupted tail.
    completed = last?.data?.reason?.kind === "completed";
    const executionBoundary = cold.events.some(
      (event) =>
        event.type === "tool/call" &&
        event.data.turn === last?.data?.turn &&
        event.data.name === "request_execution",
    );
    if (completed && executionBoundary) {
      if (config.continue) completed = false;
      else phase = "execution";
    }
  }
  if (config.continue && config.recovered?.length) completed = false;
  const options = {
    provider: config.model.provider ?? "project",
    model: config.model.id,
    ...(config.reasoning !== "default"
      ? { reasoningEffort: config.reasoning }
      : {}),
  };
  const setup = async (c) => {
    await ctx.agentPresets.mount(c, config.version);
  };
  agent = (
    resumed
      ? await ctx.agents.resume({
          resumeSessionId: config.task,
          agentOptions: options,
          setup,
        })
      : await ctx.agents.create({
          sessionId: config.task,
          agentOptions: options,
          setup,
          meta: { cwd: "/workspace" },
        })
  ).agent;
  await ctx.sessions.flush(agent.session);
  const continued = ctx.userQuestions.continued(agent);
  if (continued.length && !config.answer) {
    phase = "question";
  } else if (!completed || (config.answer && continued.length)) {
    if (config.answer)
      ctx.userQuestions.answer(
        agent,
        config.answer.call_id,
        config.answer.answer,
      );
    else {
      const queued = agent.inbox.nextTurn[0];
      if (queued) {
        agent.inbox.splice("next-turn", 0, 1, []);
        agent.followup(queued);
      } else {
        const continuing =
          resumed &&
          agent.session
            .deriveMessages()
            .some((message) => message.role === "user");
        agent.followup(
          createUserMessage({
            content: [
              {
                type: "text",
                text: continuing
                  ? config.continuationPrompt
                  : config.prompt,
              },
            ],
            source: { kind: continuing ? "orchmesh-continuation" : "user" },
          }),
        );
      }
    }
    await agent.whenIdle();
  }
  if (!(await ctx.sessions.flush(agent.session)))
    throw new Error("Missing durable session writer");
  const cold = await readColdSessionLog(ctx.sessionPersistence, config.task);
  const questions =
    ctx.sessionProjections.stateOf(agent.session, "userQuestions")?.questions
      ?.active ?? [];
  if (questions.length) phase = "question";
  emit({
    type: "result",
    phase,
    reason: lastReason,
    questions,
    events: cold.events,
  });
} catch (error) {
  emit({ type: "failure", message: error.message });
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  lines.close();
  await ctx.fiber.dispose();
  await disposeProxy();
}
