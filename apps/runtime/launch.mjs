// Keep credentials inside the user's container; never place them in argv.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const config = process.env.ORCHMESH_CONFIG_DIR ?? "/state/config";
try {
  const controlOnly = Boolean(process.env.ORCHMESH_CONTROL_ONLY);
  function readConfig(name) {
    try {
      return JSON.parse(readFileSync(`${config}/${name}.json`, "utf8"));
    } catch (error) {
      if (controlOnly && error.code === "ENOENT") return {};
      throw error;
    }
  }
  const defaults = readConfig("settings");
  const models = readConfig("models");
  // Metadata operations never make model requests; allow setup before credentials.
  defaults.defaultModel ??= controlOnly ? "unconfigured" : undefined;
  const provider =
    models.providers?.[defaults.defaultProvider] ??
    (controlOnly
      ? {
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "unconfigured",
        }
      : undefined);
  if (!provider?.baseUrl || !provider?.apiKey || !defaults.defaultModel)
    throw new Error("Configure a model endpoint, API key and model first");
  const env = {
    ...process.env,
    ORCHMESH_RUNTIME_KEY: provider.apiKey,
    ORCHMESH_RUNTIME_MODEL: defaults.defaultModel,
    DSH_PERMISSION_MODE: "danger-full-access",
  };
  const patch = [
    { id: "sdk-jsonrpc-server", disabled: true },
    {
      id: "agent-default-model",
      config: { provider: "project-api", model: defaults.defaultModel },
    },
    {
      id: "session-title",
      config: {
        fallbackMaxWords: 10,
        fallbackMaxBytes: 320,
        maxTitleBytes: 480,
      },
    },
    {
      id: "session-persistence-jsonl",
      config: { root: `${process.env.DSH_HOME}/sessions`, compression: "none" },
    },
    {
      id: "llm-pi-ai",
      config: {
        providers: {
          "project-api": {
            baseURL: provider.baseUrl,
            api: provider.api ?? "openai-completions",
            apiKeyEnv: "ORCHMESH_RUNTIME_KEY",
            models: provider.models ?? [{ id: defaults.defaultModel }],
            retryPolicy: { mode: "normal", maxRetries: 2 },
          },
        },
      },
    },
    {
      insert: [
        ...[
          "tool-ask-user",
          "workspace",
          "client-connection",
          "client-file-upload",
          "api-session-controller",
          "api-workspace-controller",
        ].map((name) => ({
          id: `orchmesh-${name}`,
          name: `@deepseek-ai/dsh-${name}`,
        })),
        {
          id: "orchmesh-present",
          name: "@deepseek-ai/dsh-tool-present",
          config: { maxFiles: 20 },
        },
        {
          id: "orchmesh",
          name: fileURLToPath(new URL("./bridge.mjs", import.meta.url)),
          inject: ["sdkAppStartup", "loader"],
        },
      ],
    },
  ];
  const patchPath = "/tmp/orchmesh-profile.json";
  writeFileSync(patchPath, JSON.stringify(patch), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("./node_modules/@deepseek-ai/dsh/lib/bin.js", import.meta.url),
      ),
      "--profile",
      "sdk",
      "--patch",
      patchPath,
    ],
    { env, stdio: "inherit" },
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  console.error("DSH startup failed: check the user model configuration.");
  process.exitCode = 1;
}
