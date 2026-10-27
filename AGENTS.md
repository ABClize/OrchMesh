# Repository Guidelines

## Scope & Architecture

OrchMesh creates, publishes, and runs reusable agents. Read `docs/architecture/agent-platform-v1.md` and `docs/development/agent-platform-migration.md` before changing execution ownership. The acceptance report distinguishes implemented behavior from remaining release gates.

FastAPI owns authentication, accounts, agent versions, task ownership, and file authorization. DBOS owns durable scheduling and waiting; DSH owns the agent loop, session log, checkpoints, and tools. Official A2A stores own protocol tasks and events. Never introduce a second agent loop or recovery queue.

## Project Structure

- `apps/server/src/orchmesh/platform/`: catalog, durable execution, A2A, task sandboxes, and artifacts.
- `apps/server/src/orchmesh/dsh/`: message projection and model validation.
- `apps/server/migrations/platform_versions/`: PostgreSQL business schema; `tests/`: deterministic behavior tests.
- `apps/runtime/`: pinned official DSH packages and execution composition.
- `apps/web/src/`: React UI, assistant-ui chat runtime, and generated API types.
- `deploy/sandbox.Dockerfile`: disposable execution image; `compose.yaml`: PostgreSQL.
- `.agents/skills/`: upstream project skills managed through `npx skills`.

## Build & Development

Run `make setup` to install locked dependencies and prepare PostgreSQL and the sandbox image. Configure `.env`, then use `make dev` for hot reload or `make run` for a built single-service application. Ctrl+C stops the application; PostgreSQL remains running. `docker compose stop db` stops it without deleting data.

Run `make check` for lint, types, formatting, and API drift; `make test` for builds, pytest, and Vitest. Regenerate contracts with `./scripts/generate-api.sh` after API changes.

## Coding & Testing

Use typed Python with four spaces and snake_case; use two-space TypeScript and PascalCase components. Follow Ruff, Pyright, ESLint, and Prettier. Prefer existing Affect UI components, shadcn for gaps, and assistant-ui for chat state.

Name tests `test_*.py` or `*.test.ts(x)`. Test ownership, immutable versions, duplicate admission, cancellation, recovery, and file access. Report deterministic tests separately from real administrator/model and Codex browser acceptance. Label acceptance conversations; preserve existing data.

## Data & Contributions

Never commit `.env`, credentials, logs, databases, or `.data/`. Existing history is read-only; continuing forks its history and file binding. No per-user container or host shell: execution containers belong to tasks and are disposable. Database foreign keys are intentionally omitted; enforce ownership explicitly.

Use Conventional Commits. PRs describe behavior, validation, limitations, and relevant design decisions; include screenshots for UI changes. Do not push without authorization.
