# Isolated DSH SSH and recovery probes

These are disposable verification fixtures, not application code. They use pinned official DSH `0.2.1-rc.3` packages and a deterministic `LlmAdapter`. No project `.env`, accounts, existing database, private model credentials or user workspaces are read.

## Run

Prerequisites: Linux x64, Node 24, npm, Python 3, OpenSSH client/keygen/keyscan, Docker access, and the existing `orchmesh-dsh:0.2.1-rc.3` image. Internet is needed for npm and the test image's apt packages.

```sh
python docs/research/phase-a-probes/ssh/run.py
```

The runner copies the fixtures to a unique `/tmp/orchmesh-phase-a-ssh-*` directory, runs `npm ci`, builds a uniquely tagged SSH test image, and generates a throwaway SSH key. Only this run's containers/image are removed; no Docker prune or host user creation is used. The test image's `node` user is inside the container. Evidence remains in the printed directory; the private client key is removed on exit. Do not commit generated keys, node_modules or Session files.

## Coverage

- Ordinary DSH turn with no code container, followed by public `agents.resume` of the same Session with official SSH providers; container removal/recreation preserves Session and exported artifacts.
- Official remote filesystem version guards, atomic edit, read-only denial, subprocess output, managed cancellation and sandbox confinement.
- Official Node PTC worker, empty execution environment, remote output and remote ripgrep.
- Official model-facing `write`, `bash`, `read`, `grep` tools through the real SSH connection. The native grep tool uses its package-owned absolute rg path: the runner deploys only that binary read-only at the same path in the container. There is no host execution fallback or patched provider.
- Removal of a container during Shell execution produces an unknown-outcome error; the provider does not silently reconnect/replay.
- Timed `ask_user_question` persists across SIGKILL; public `userQuestions.answer` resumes the answer path and rejects a duplicate queued reply.
- Two immutable preset IDs, a changed default and SIGKILL: resumed old task stays on v1 via its explicit saved binding, a new task uses v2.

`probe.mjs` checks providers; `session.mjs` is a test-only instrumented tool; `native-tools.mjs` separately verifies the real official model tools. `question.mjs` and `preset.mjs` test official tool/preset behavior. A deterministic adapter is intentionally used to place exact failure points; these results do not substitute for real-model or platform integration acceptance.

The script helper and its dependencies run from a read-only `/opt/probe` mount, outside `/workspace` and replaced `/tmp`. The current official native provider selects Landlock inside the Docker container. The Docker boundary supplies task filesystem isolation; Landlock's `full` refers to file-effect enforcement, not general hostile-code security. Background lease expiry, PTC process crash recovery, browser UI, multiuser authorization and arbitrary plugin coverage are not established by this suite.

## Integration continuation entry

After preparing this fixture's temporary dependency/SSH environment, `native-tools.mjs bridge` accepts `PROBE_SESSION_ROOT` (existing JSONL store), `PROBE_SESSION_ID` and `PROBE_ARTIFACT_OUTPUT` (host-side output directory). It resumes the same Session, exercises four official remote tools and exports `report.txt`. The caller must allocate this test container and dispose it after completion. `lifecycle.start()` can do the allocation; set `PROBE_ALIGN_RG=1`. Use one environment/config directory per concurrent connection. These fixtures use a deterministic adapter and are not a production sandbox API.
