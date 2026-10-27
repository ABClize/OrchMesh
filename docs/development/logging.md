# Application logging

OrchMesh uses Python `logging` and `TimedRotatingFileHandler`. The single API
process owns logging inside its lifespan, after acquiring the runtime lock.
Handlers close on shutdown; importing the app or generating OpenAPI does not
open log files. Console output and daily files receive the same application events.

## Files and configuration

- Current file: `${ORCHMESH_DATA_DIR}/logs/orchmesh.log` (default `.data/logs/`).
- Archives: `orchmesh.log.YYYY-MM-DD`, using the server's local timezone.
- Rotation occurs on the first log write after midnight, including after restart.
  Idle days do not generate empty files. Restarting appends to the current file.
- `ORCHMESH_LOG_RETENTION_DAYS=30` retains at most 30 daily archives plus the
  current file. This is a count of archives, not a strict 30-calendar-day TTL;
  cleanup happens on rotation. No automatic compression or size cap is applied.
- `ORCHMESH_LOG_LEVEL=INFO` accepts DEBUG, INFO, WARNING, ERROR. Restart to apply.
- The log directory is created with mode 0700 and lives outside Git. Keep this
  permission if moving or restoring it. Single-process deployment is required.

```bash
tail -F .data/logs/orchmesh.log
rg 'task.worker_exit|http.failure' .data/logs/orchmesh.log*
```

HTTP logs contain a server-generated request ID (also in `X-Request-ID`), method,
route template, status and time until response headers. For SSE this is **not**
the full stream duration. Worker logs contain task IDs, exit codes and drained stderr byte counts. These
are application diagnostics, not a durable audit trail or raw Uvicorn access log.

## Sensitive data

Log fixed event names and explicitly selected diagnostic fields. Never log
request/response bodies, query strings, headers, prompts, tool outputs, passwords,
model keys, JWTs or raw provider stderr. Failure reports retain exception class
and stack function/line locations, excluding exception text, source lines and
locals. Raw stderr remains drained to prevent subprocess deadlocks; its contents
are intentionally not persisted. Diagnostic detail is limited where upstream
errors cannot be safely separated from secrets.

Tests simulate rollover, retention and restart without waiting for midnight,
check handler cleanup, and verify that exception text, queries and tokens do not
appear in the application log. CI never uses personal credentials or a real model.

## Task persistence versus logs

DSH session JSONL and DBOS/PostgreSQL workflow records contain task inputs and
results needed for recovery. They are private application data, not daily log files.
Back them up with task inputs and artifacts; never publish them as debug logs.
Earlier migration experiments retained task-local `runtime.log` diagnostics; those
files remain local and ignored. New workers drain stderr without persisting it.
