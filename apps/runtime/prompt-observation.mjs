// Observe public DSH seams without changing request, assembly, or loop ownership.
import { writeFileSync, renameSync } from "node:fs";
import { renderPrompt } from "@deepseek-ai/dsh-system-prompt";
export function installPromptObservation(ctx, config) {
  let sections = [];
  ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const assembly = await next();
    sections = assembly.sections.map((section) => ({
      name: section.name,
      source: ({
        "orchmesh-definition": "Agent 定义 · 任务接收快照",
        "orchmesh-task_prompt": "本次用户任务",
        "orchmesh-conversation_history": "接收任务时的对话历史",
        "orchmesh-user_memory": "执行时读取的个人记忆",
        "orchmesh-collaboration": "执行时读取的协作状态",
        "orchmesh-platform": "平台公共指令 · 任务接收快照",
      })[section.name] ?? "DSH 插件",
      text: renderPrompt({ ...assembly, sections: [section] }),
    }));
    return assembly;
  });
  ctx.on("llm/stream", async function* (options, next) {
    if (options.sessionId === config.task && !options.purpose) {
      const snapshot = {
        captured_at: new Date().toISOString(),
        session_id: options.sessionId,
        model: options.model,
        sections,
        system_messages: options.messages.filter((m) => m.role === "system"),
        runtime_context: options.messages.filter((m) => m.source?.kind === "runtime-context").at(-1) ?? null,
        continuation_messages: options.messages.filter((m) => m.source?.kind === "orchmesh-continuation"),
        tools: (options.tools ?? []).map((tool) => ({...tool, source: config.tools.some((spec) => spec.name === tool.name) ? "OrchMesh 平台工具" : "DSH 工具插件"})),
        tool_history: options.toolHistory ?? null,
        continuation_configured: config.continuationPrompt,
      };
      // Retain only the latest request-boundary snapshot, never credentials or
      // provider config. Failure to observe must not break agent execution.
      try {
        const target = config.root + "/effective-prompt.json";
        writeFileSync(target + ".tmp", JSON.stringify(snapshot), { mode: 0o600 });
        renameSync(target + ".tmp", target);
      } catch { console.error("Prompt observation unavailable"); }
    }
    yield* next();
  });
}
