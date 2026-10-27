// A bounded one-shot DSH adapter query; no agent loop, tools, or session.
import { Context } from "@deepseek-ai/cordis";
import Llm from "@deepseek-ai/dsh-llm";
import * as PiAI from "@deepseek-ai/dsh-llm-pi-ai";
import { installProxyFromEnvironment } from "@deepseek-ai/dsh-http-proxy";
import { modelRoute } from "./model-route.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
const ctx = new Context();
process.env.ORCHMESH_TASK_MODEL_KEY = config.key;
const disposeProxy = await installProxyFromEnvironment({ get(name) {
  return process.env[name] === undefined ? undefined : { value: process.env[name] };
}}, () => {});
try {
  await ctx.plugin(Llm);
  await ctx.plugin(PiAI, { providers: modelRoute(config.model) });
  const provider = config.model.provider ?? "project";
  const info = await ctx.llm.resolveModelInfo(provider, config.model.id);
  if (config.test) {
    let finished = false;
    for await (const chunk of ctx.llm.stream({
      provider, model: config.model.id,
      messages: [{role: "user", content: [{type: "text", text: "Reply OK."}]}], maxTokens: 128,
      signal: AbortSignal.timeout(20000),
      ...(info.reasoning?.efforts.some((e) => e.id === "off") ? { reasoningEffort: "off" } : {}),
    })) {
      if (chunk.type === "finish") {
        if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") throw new Error("connection");
        finished = true;
      }
    }
    if (!finished) throw new Error("connection");
  }
  process.stdout.write(JSON.stringify({ ok: true, efforts: info.reasoning?.efforts ?? [], context: info.context }));
} catch {
  // Never echo provider errors: upstream errors may contain credentials or headers.
  process.stdout.write(JSON.stringify({ ok: false, message: "DSH 无法解析模型或连接失败，请检查协议、模型 ID、地址和密钥。" }));
  process.exitCode = 1;
} finally {
  await ctx.fiber.dispose();
  await disposeProxy();
}
