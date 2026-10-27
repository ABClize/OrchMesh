"""Snapshot official present results into owner-scoped immutable artifacts."""

import hashlib
import json
import os
import uuid

from ..storage import Artifact
from ..workspace import MAX_FILE, open_path


async def capture(engine, session, task, messages):
    for message in messages:
        if message.get("role") != "toolResult":
            continue
        for part in message.get("content", []):
            if part.get("type") != "text":
                continue
            try:
                value = json.loads(part.get("text", ""))
            except (ValueError, TypeError):
                continue
            if not isinstance(value, dict) or value.get("kind") != "dsh.deliverables":
                continue
            for file in value.get("files", []):
                path = file.get("path", "")
                if not path.startswith("/workspace/"):
                    continue
                relative = path[len("/workspace/") :]
                identifier = str(
                    uuid.uuid5(uuid.NAMESPACE_URL, task.id + ":" + relative)
                )
                record = await session.get(Artifact, identifier)
                if record is None:
                    fd = open_path(engine.sandboxes.root(task.id) / "work", relative)
                    with os.fdopen(fd, "rb") as stream:
                        data = stream.read(MAX_FILE + 1)
                    if len(data) > MAX_FILE:
                        raise ValueError("Deliverable exceeds size limit")
                    directory = (
                        engine.sandboxes.root(task.id) / "artifacts" / identifier
                    )
                    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
                    target = directory / relative.rsplit("/", 1)[-1]
                    # A retried checkpoint verifies a pre-
                    # existing artifact, never overwrites it.
                    if target.exists() and target.read_bytes() != data:
                        raise ValueError(
                            "Artifact changed before completion was checkpointed"
                        )
                    if not target.exists():
                        with target.open("xb") as output:
                            output.write(data)
                            output.flush()
                            os.fsync(output.fileno())
                    record = Artifact(
                        id=identifier,
                        owner_id=task.owner_id,
                        task_id=task.id,
                        conversation_id=task.conversation_id,
                        name=target.name,
                        path=str(target),
                        digest=hashlib.sha256(data).hexdigest(),
                        size=len(data),
                    )
                    session.add(record)
                    await session.flush()
                file["path"] = f"/workspace/@artifacts/{identifier}/{record.name}"
            part["text"] = json.dumps(value, ensure_ascii=False)
    return messages
