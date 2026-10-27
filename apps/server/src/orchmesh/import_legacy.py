"""Explicit, atomic, repeatable import. Source SQLite and DSH logs are read-only."""

import asyncio
import hashlib
import json
import sqlite3
import uuid
from pathlib import Path

from sqlalchemy import select

from .config import Settings
from .dsh.events import history
from .storage import Conversation, Database, Project, Run, User


def fingerprint(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


async def migrate(settings: Settings) -> dict[str, int]:
    if not settings.database_url.startswith("postgresql"):
        raise ValueError("Import requires a PostgreSQL destination")
    source = settings.data_dir / "platform.sqlite3"
    before = fingerprint(settings.data_dir / "users")
    connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = {
            name: [dict(r) for r in connection.execute(f'SELECT * FROM "{name}"')]
            for name in ("user", "project", "conversation", "run")
        }
    finally:
        connection.close()
    sessions, workspaces = {}, {}
    for user in rows["user"]:
        owner = str(uuid.UUID(user["id"]))
        root = settings.data_dir / "users" / owner / "dsh"
        proc = await asyncio.create_subprocess_exec(
            "node",
            str(settings.runtime_dir / "export-history.mjs"),
            str(root / "sessions"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        output, _ = await proc.communicate()
        if proc.returncode:
            raise RuntimeError("Official DSH history export failed; import not applied")
        sessions[owner] = {item["id"]: item for item in json.loads(output)}
        workspace = json.loads((root / "storages/workspace.json").read_text())
        if workspace["unit"]["version"] != 2 or workspace["global"].get(
            "pendingMutation"
        ):
            raise ValueError("Unsupported or unfinished workspace snapshot")
        workspaces[owner] = workspace
    db = Database(settings)
    try:
        async with db.sessions.begin() as target:
            for name, model in (
                ("user", User),
                ("project", Project),
                ("conversation", Conversation),
                ("run", Run),
            ):
                existing_ids = set((await target.scalars(select(model.id))).all())
                expected_ids = set()
                for raw in rows[name]:
                    values = dict(raw)
                    for field in ("id", "user_id", "directory_id"):
                        if values.get(field) and not (
                            field == "id" and name == "conversation"
                        ):
                            values[field] = uuid.UUID(values[field])
                    if name == "user":
                        for field in ("is_active", "is_superuser", "is_verified"):
                            values[field] = bool(values[field])
                    if name == "conversation":
                        owner = str(values["user_id"])
                        cold = sessions[owner].get(values["id"])
                        if cold is None:
                            raise ValueError(
                                "A conversation has no readable official session"
                            )
                        state = workspaces[owner]["global"]
                        title = (cold.get("title") or {}).get("title")
                        # Official title projection includes
                        # provenance alongside the text.
                        values.update(
                            legacy=True,
                            title=title or "历史对话",
                            legacy_messages=history(cold["events"])[0],
                            pinned=values["id"] in state.get("pinnedSessionIds", []),
                            archived=values["id"]
                            in state.get("archivedSessionIds", []),
                        )
                    if name == "project":
                        snapshot = workspaces[str(values["user_id"])]["tables"][
                            "workspaces"
                        ]
                        entry = snapshot.get(values.get("native_id"), {})
                        values["name"] = entry.get("title") or "历史工作区"
                    expected_ids.add(values["id"])
                    old = await target.get(model, values["id"])
                    if old:
                        # Re-running must never overwrite
                        # edits or silently accept a
                        # different source.
                        for key, value in values.items():
                            if getattr(old, key) != value:
                                raise ValueError(f"Import conflict in {name}.{key}")
                    else:
                        target.add(model(**values))
                if existing_ids - expected_ids:
                    raise ValueError(f"Destination {name} contains unrelated rows")
            await target.flush()
            if before != fingerprint(settings.data_dir / "users"):
                raise ValueError("Source files changed during import")
        return {name: len(items) for name, items in rows.items()}
    finally:
        await db.engine.dispose()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(migrate(Settings()))))
