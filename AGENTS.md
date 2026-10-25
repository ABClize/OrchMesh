# Repository Guidelines

## Scope & Architecture

OrchMesh is a small multi-user Pi workspace. Pi owns the Agent Loop, Shell, file tools, and durable JSONL messages. FastAPI owns authentication, conversation ownership, execution metadata, and SSE. One API process serves the built React application and manages isolated user containers.

Before changing execution semantics, read `docs/architecture/v0.1-simplified.md`; consult `docs/research/pi-capabilities.md` for Pi capability evidence. Prefer official CLIs and component conventions over earlier proposed directory layouts.

## Project Structure

- `apps/server/src/orchmesh/`: FastAPI app, auth, storage, administration, and `pi/` integration.
- `apps/server/migrations/`: Alembic schema history; `tests/`: behavior and container tests.
- `apps/web/src/`: React app, generated components, chat adapter, and typed API client.
- `deploy/pi.Dockerfile`: pinned Pi image; `docs/`: architecture, research, and validation.
- `.agents/skills/`: project-level upstream skills managed through `npx skills`.

## Build & Development

Run commands from the repository root:

- `uv sync --directory apps/server --locked` and `npm --prefix apps/web ci`: restore dependencies.
- `uv run --directory apps/server alembic upgrade head`: migrate the database.
- `uv run --directory apps/server fastapi dev`: backend development.
- `npm --prefix apps/web run dev`: Vite with API proxy.
- `npm --prefix apps/web run build`: type-check and build production assets.
- `./scripts/generate-api.sh`: regenerate OpenAPI client types.

Account creation and dedicated Pi login commands are documented in `README.md`.

## Coding & Testing

Use typed Python, four-space indentation, and snake_case; use two-space TypeScript and PascalCase React components. Run Ruff, Pyright, ESLint, and Prettier using installed project tools.

Run `uv run --directory apps/server pytest -q`, frontend `npm --prefix apps/web test`, then use Codex’s built-in browser for UI acceptance following `docs/development/browser-acceptance.md`. Name Python tests `test_*.py` and frontend tests `*.test.ts`. There is no numeric coverage threshold; cover ownership, JWT expiry, cancellation, reconnect, failure, and cleanup behavior. Use the configured administrator account and real project model for end-to-end acceptance by default; label test conversations and preserve existing data. Keep deterministic tests for failure/expiry cases, and report them separately from real-model acceptance.

## Runtime & Contributions

Use the official-template Bearer JWT flow for API and SSE; follow `README.md` for token lifetime and logout semantics. Preserve per-user container mounts and the single-instance lock. Keep credentials and runtime data outside tracked files. Database foreign-key enforcement is intentionally disabled; enforce ownership and lifecycle rules in the application. For logging changes, follow `docs/development/logging.md`. Use `agent_settled` for completion; clear queues before aborting. Keep unsupported UI actions hidden.

Use Conventional Commits, following the existing `feat:` history. PRs should explain behavior, link relevant issues or design decisions, state validation and remaining limitations, and include screenshots for UI changes.

Prefer Codex built-in tools for browser interaction and debugging. Add external development tools only when required by the application or checks that the built-in tools cannot provide.
