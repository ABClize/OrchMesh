import { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { SshConnection } from "@deepseek-ai/dsh-ssh";
import { SshFileSystem } from "@deepseek-ai/dsh-fs-ssh";
import { SshSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-ssh";
import { SshSandboxProvider } from "@deepseek-ai/dsh-sandbox-ssh";
import WorkingDirectory from "@deepseek-ai/dsh-working-directory";
import Bash from "@deepseek-ai/dsh-bash-sandbox";
import { ShellEnvRegistry } from "@deepseek-ai/dsh-shell-env";
import * as ToolBash from "@deepseek-ai/dsh-tool-bash";
import * as ToolFs from "@deepseek-ai/dsh-tool-fs";
import * as Search from "@deepseek-ai/dsh-tool-fs-search";
import * as Present from "@deepseek-ai/dsh-tool-present";
export async function mountRemote(ctx, remote) {
  await ctx.plugin(SandboxPolicyService, {
    mode: "workspace-write",
    workspaceRoot: "/workspace",
  });
  await ctx.plugin(SshConnection, {
    host: "task",
    launch: { kind: "node-script", node: "/usr/local/bin/node" },
    helper: remote.helper,
    helperHash: remote.hash,
    workspace: "/workspace",
    leaseMs: 5000,
  });
  for (const plugin of [
    SshFileSystem,
    SshSubprocessRuntime,
    SshSandboxProvider,
  ])
    await ctx.plugin(plugin);
  await ctx.plugin(WorkingDirectory, { defaultDirectory: "/workspace" });
  await ctx.plugin(Bash, { cwd: "/workspace" });
  await ctx.plugin(ShellEnvRegistry);
  for (const plugin of [ToolBash, ToolFs, Present]) await ctx.plugin(plugin);
  await ctx.plugin(Search, { sampleOverCapGlobResults: false });
}
