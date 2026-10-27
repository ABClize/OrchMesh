# Isolated DBOS / A2A / DSH recovery probe

These fixtures are **not application code**. They never import OrchMesh, access its database, create an application account or mount user workspaces. All services, databases, keys, Sessions and artifacts are created in a fresh temporary directory or uniquely named container. APIs bind to loopback only.

## Run

Requires Linux x64, Python, uv, Node 24, npm, Docker, OpenSSH utilities, network access and the existing `orchmesh-dsh:0.2.1-rc.3` image. Python/npm dependencies are locked separately from the application.

```sh
python docs/research/phase-a-probes/recovery/run.py

# Optional: read only model settings from an explicitly supplied .env.
python docs/research/phase-a-probes/recovery/run.py --real-env /absolute/path/to/.env
```

The runner creates its own Postgres 16.10 instance, test SSH image and key, scratch virtualenv and npm installation. The `.env` option forwards only model address/protocol/ID/key/thinking-format fields to the trusted test runtime. No admin credentials are used. Keys are not passed through argv or into the code sandbox. Results and model-generated test messages stay in the printed scratch directory; do not commit raw runtime logs or Sessions.

Normal exit/failure removes this run's Postgres container/anonymous volume, generated SSH image and private client key. Each sandbox adapter removes its own task container. Abruptly killing the runner itself may leave its labelled disposable resources; inspect exact names before cleanup, never run a broad Docker prune.

## What it tests

- Official `DBOSClient.enqueue_in_transaction`: business Task and queue rollback together; duplicate HTTP admission returns the existing Task.
- Uvicorn/Python SIGKILL: DBOS automatically resumes pending work and DSH resumes the same Session. A second crash during recovery still leaves the counted effect at one.
- Linux parent-death signaling terminates the Node child when its owning Python process dies. Node-only SIGKILL uses the official DBOS step retry policy and resumes durable DSH history.
- DSH result committed before DBOS step checkpoint: reuse the saved result without another model call.
- Official A2A Client/Handler and versioned SQL store: completed child result is reused after parent notification/checkpoint loss.
- Durable DBOS question wait and idempotent answer delivery survive restart; cancellation terminates the child and stays canceled after restart.
- With `--real-env`: the real model encounters `TOOL_OUTCOME_UNKNOWN`, calls `inspect_effect`, verifies the effect already happened and completes without repeating it.
- Full `DBOS → A2A → DSH → official SSH tools → Docker` chain: resume the same child Session, execute official write/bash/read/grep, export an artifact, remove the sandbox, kill the service before DBOS records the step, and reuse the verified artifact without a second container.
- Official cold A2A subscription receives the restored Task snapshot and the later persisted completion event.
- Crash after durable execution admission but before A2A Task projection: recovery reconstructs the protocol result using the public versioned store.

The SSH fixture directory is private to this runner. Its connection config is intentionally serial; it is not a proposed production multi-task pool. No SDK internals are patched.

## Boundaries

The API injects a fixed synthetic principal and scenario-based fixture Agent definitions. It is not production authentication, a published-agent registry or a semantic planner. The collaboration route is fixed to place exact failure points. Parent/child A2A cancellation, concurrent admission races, multiple execution hosts, power failure/fsync guarantees and arbitrary external side effects are not proven here.

The artifact manifest only reconciles this fixture's known output using SHA-256. It is not a generic guarantee that arbitrary Shell operations can execute exactly once. DBOS question waiting and the standalone official timed-question probe establish their respective APIs; the final product adapter still needs integrated UI/answer acceptance tests. DSH preset freeze and sandbox loss/recreation are independently covered by [SSH probes](../ssh/README.md).

Logs intentionally retain intermediate failed experiments outside Git. The checked-in result summary identifies the final clean run; assertions inspect actual assistant final blocks, not user prompts containing a completion marker.
