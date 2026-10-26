"""Join official DSH navigation with platform ownership and directory bindings."""

import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import HTTPException
from sqlalchemy import select

from ..storage import Conversation, Project


class Navigation:
    def __init__(self, manager):
        self.manager = manager
        self.locks: dict[uuid.UUID, asyncio.Lock] = {}

    @asynccontextmanager
    async def transaction(self, user_id):
        async with self.locks.setdefault(user_id, asyncio.Lock()):
            try:
                yield
            except (RuntimeError, TimeoutError):
                raise HTTPException(503, "DSH navigation unavailable") from None

    async def snapshot(self, user_id):
        async with self.transaction(user_id):
            value = await self.manager.control(user_id, "navigation/list")
        workspaces = {w["id"]: w for w in value["workspaces"]}
        summaries = {s["sessionId"]: s for s in value["sessions"]["items"]}
        async with self.manager.db.sessions() as session:
            mounts = (
                await session.scalars(select(Project).where(Project.user_id == user_id))
            ).all()
            projects = []
            membership = {}
            for mount in mounts:
                workspace = workspaces.get(mount.native_id)
                if workspace is None:
                    continue
                projects.append(
                    {
                        "id": mount.id,
                        "name": workspace["title"],
                        "created_at": mount.created_at,
                    }
                )
                for sid in workspace["sessionIds"]:
                    membership[sid] = mount.id
            conversations = []
            for c in (
                await session.scalars(
                    select(Conversation)
                    .where(Conversation.user_id == user_id)
                    .order_by(Conversation.created_at.desc())
                )
            ).all():
                title = (
                    summaries.get(str(c.id), {})
                    .get("projections", {})
                    .get("values", {})
                    .get("title")
                )
                conversations.append(
                    {
                        "id": c.id,
                        "title": title or "新对话",
                        "reasoning": c.reasoning,
                        "project_id": membership.get(str(c.id)),
                        "directory_id": c.directory_id,
                        "pinned": str(c.id) in value["pinned"],
                        "archived": str(c.id) in value["archived"],
                        "created_at": c.created_at,
                    }
                )
        return {"projects": projects, "conversations": conversations}

    async def conversation(self, user_id, conversation_id):
        snapshot = await self.snapshot(user_id)
        return next(c for c in snapshot["conversations"] if c["id"] == conversation_id)

    async def update(self, user_id, conversation_id, **changes):
        async with self.transaction(user_id):
            return await self.manager.control(
                user_id, "navigation/update", sessionId=str(conversation_id), **changes
            )
