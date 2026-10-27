# Agent platform migration acceptance

Updated: 2026-10-27. Core migration is implemented and running locally on port 8000. No commit, push, or release was performed. This report separates the implemented migration from the broader product design and public-release readiness.

## Implementation and reuse

- PostgreSQL business schema and explicit read-only SQLite import; existing JWT/password hashes and directory references retained.
- Agent drafts, immutable versions, matching-version trial requirement, explicit publication, marketplace and comments. Owner/admin edit authorization is enforced server-side.
- DBOS Python 3.3.0 transactionally admits workflows, recovers execution and provides durable waits/messages. No custom scheduler or replay queue.
- DSH 0.2.1-rc.3 public Agent/Session, JSONL/checkpoint, user-question, LLM retry, SSH filesystem/subprocess/search/present, web fetch and HTTP proxy interfaces. Normal chat does not allocate Docker.
- Official A2A SDK 1.2.3 routes/client/task store/event stream. Root/work-key identity deduplicates assignments; ancestor checks and persistent dependency edges reject circular waits.
- Root recovery restores dependencies using `DBOS.get_result_async`, then obtains results through A2A before continuing DSH. A model's final reply cannot close a root while its known dependencies remain active.
- Task-only Docker mounts; disposable containers, persisted work and immutable delivery snapshots. Input uploads use FastAPI UploadFile and the existing owner-checked file response.
- PostgreSQL text retrieval with literal substring fallback for Chinese phrases; text/Markdown knowledge import, frozen publication knowledge, owner-scoped memory and global disable.
- Existing assistant-ui chat runtime and shadcn layout retained. Affect UI buttons and tool cards are reused; child deliverables share the existing file-card renderer.

Search is **disabled by user choice**. Optional official search configuration is documented, but no search credentials were supplied or tested.

## Preserved data

A private backup was taken under `.data/backups/platform-migration-20261027-062811` before switching storage. A post-migration comparison against its SQLite snapshot verified every original field in:

| Records | Unchanged original count |
| --- | ---: |
| Accounts | 1 |
| Conversations | 14 |
| Directory/project bindings | 12 |
| Legacy runs | 32 |

All 108 original user files matched SHA-256; JWT secret bytes matched. The SQLite source and legacy user directories remain in place. New acceptance conversations/agents live in PostgreSQL and are explicitly labeled. One temporary second-user acceptance account was disabled after the isolation test.

## Evidence

`make check` passed: Ruff, formatting, Pyright, ESLint, TypeScript and generated OpenAPI drift checks. `make test` passed: **37 backend tests, 29 frontend tests**, and production build. Tests cover ownership, immutable publication, answer validation, uploads, artifacts/Range, legacy forks, wait cycles and restoring admitted children before their wait edge exists.

Real-model acceptance used the configured administrator and model:

| Scenario | Result / evidence |
| --- | --- |
| Draft trial → explicit publish → A2A invocation | Passed; conversation `1b9e42b8-e996-4b8e-bd8f-be5e150e687e` |
| Code/file task interrupted with API SIGKILL | Same task resumed; effect file contained one `ONCE`; report retained. Task `8ac0a011-a3ec-4304-a0b7-176088db8f20` |
| Pending question → API SIGKILL → duplicate answer submission | Completed and saved an unpublished draft. Task `5159d050-8b78-4ce0-be04-50d0e535dde2` |
| Parent/child A2A task interrupted during child Shell execution | Parent and original child completed; one child and one file effect. Root `817fdee8-8562-4512-9af1-8296f47bfe6d`, child `071ebbcc-21e0-4f4d-8ba5-5127e7f449ff`; final parent response contained `A2A_RESTART_OK` |
| Two users invoke one published version concurrently | Separate task IDs; cross-owner conversation and file reads returned 404 |
| Upload → private knowledge retrieval → real file read | Passed; task `762c72f7-a936-4f93-b8cd-1a4ff00a3903` |
| Official web_fetch without Shell or container | Passed; task `72d4461e-9324-44b3-b184-a8162c67f67e` |
| Markdown/HTML delivery and authenticated download | Two files downloaded; conversation `3c52ba07-c008-4dd6-92fc-426608b05415` |
| Stop during sleep | Stopped; task container removed; post-sleep file absent. Task `ec7f8b57-7b5a-436c-b2f1-4fffbedd2fa1` |

Codex's built-in browser verified administrator access, retained history, marketplace, draft editing/capabilities, upload entry, child delivery cards and HTML preview. No Playwright dependency was added.

Two findings changed implementation during acceptance:

1. A repeated crash test exposed a parent that replied “I will wait” and finished before its child. Persistent dependency restoration and DBOS waits now own this boundary; the repository acceptance script passed after that correction.
2. The first webpage report used a Shell fallback, so it was not valid proof of official web_fetch. Installed rc.3 rejects synthetic/non-public DNS addresses. The official DSH HTTP proxy interface now reuses this machine's configured desktop proxy through `.env`; a separate no-Shell test verified actual successful web_fetch. URL protections remain enabled. Installed package behavior takes precedence over older research-checkout documentation.

## Repeating the destructive recovery check

Only run against an idle local API started with the project's Uvicorn executable. The script creates labeled real-model data, verifies there are no unrelated active workflows, identifies the API executable, sends SIGKILL during a child effect, and restarts it. It does not delete test data.

```bash
uv run --directory apps/server python ../../scripts/acceptance/collaboration_restart.py --allow-restart
```

The opt-in flag is required. The result is written to `.data/acceptance-collaboration-restart.json`; service diagnostics remain local. Normal `make test` never uses personal credentials, kills a server, or invokes a model.

## Explicit boundaries

- Recovery resumes committed progress, not a process instruction pointer. The one-effect test used a verifiable file marker; arbitrary external writes are not guaranteed exactly once. External write tools remain outside this release scope.
- PostgreSQL, DSH session files, inputs and artifact directories must all survive. Database-loss, disk-loss, multi-host failover and hostile multi-tenant deployment were not validated.
- Only one API process is supported. Deploy a service manager to restart a crashed API; DBOS takes over after the process starts.
- Legacy history is read-only; continuation creates a new conversation with original history/file references. New task tools do not receive unrestricted legacy account directories.
- Knowledge import currently handles text/Markdown; richer document parsing and automatic ingestion/versioning of URL knowledge remain unfinished product work. PostgreSQL simple tokenization is not semantic retrieval or sophisticated Chinese segmentation.
- App-level approval/input-queue features from the old workspace UI are not part of the new automatic-collaboration flow. Administration is currently API/CLI based; no full administrator dashboard was built.
- npm reports upstream dependency advisories in the pinned DSH graph. They have not been dismissed or force-upgraded away; dependency review and container network hardening remain gates before opening the service to untrusted users. Vite also reports a large-chunk warning.
- This is local migration acceptance, not a claim that every first-release product item or deployment/security gate is finished.
