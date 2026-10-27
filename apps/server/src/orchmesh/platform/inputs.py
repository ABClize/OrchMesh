"""Immutable task inputs: FastAPI uploads and existing artifact authorization."""

import hashlib
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select

from ..storage import Artifact, Conversation, Task, User
from ..workspace import MAX_FILE


def router(auth, db, settings):
    api = APIRouter(prefix="/api/conversations", tags=["platform"])

    async def owned(session, identifier, user):
        row = await session.scalar(
            select(Conversation)
            .where(Conversation.id == identifier, Conversation.user_id == user.id)
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Conversation not found")
        return row

    @api.get("/{conversation_id}/inputs")
    async def listing(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> list[dict]:
        async with db.sessions() as session:
            await owned(session, conversation_id, user)
            rows = (
                await session.scalars(
                    select(Artifact).where(
                        Artifact.owner_id == user.id,
                        Artifact.conversation_id == conversation_id,
                        Artifact.task_id == "input",
                    )
                )
            ).all()
        return [
            {
                "id": row.id,
                "name": row.name,
                "size": row.size,
                "path": f"@artifacts/{row.id}/{row.name}",
            }
            for row in rows
        ]

    @api.post("/{conversation_id}/inputs", status_code=201)
    async def upload(
        conversation_id: str,
        file: UploadFile,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        data = await file.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise HTTPException(413, "Input exceeds 20 MiB")
        name = Path((file.filename or "input").replace("\\", "/")).name
        if name in ("", ".", "..") or len(name) > 255:
            raise HTTPException(422, "Invalid file name")
        async with db.sessions.begin() as session:
            conversation = await owned(session, conversation_id, user)
            if conversation.legacy or conversation.archived:
                raise HTTPException(409, "Conversation is read-only")
            if await session.scalar(
                select(Task.id).where(
                    Task.conversation_id == conversation_id,
                    Task.status.in_(("queued", "running", "waiting")),
                )
            ):
                raise HTTPException(409, "Upload before starting a task")
            identifier = str(uuid.uuid4())
            directory = settings.data_dir / "inputs" / identifier
            directory.mkdir(parents=True, mode=0o700)
            path = directory / name
            with path.open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            session.add(
                Artifact(
                    id=identifier,
                    owner_id=user.id,
                    task_id="input",
                    conversation_id=conversation_id,
                    name=name,
                    path=str(path),
                    digest=hashlib.sha256(data).hexdigest(),
                    size=len(data),
                )
            )
        return {"id": identifier, "name": name}

    return api
