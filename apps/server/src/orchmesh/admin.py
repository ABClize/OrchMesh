"""Administrator read models. Execution and configuration keep their existing owners."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from .storage import AgentDefinition, AgentVersion, Conversation, Skill, Task, User


def search_pattern(value: str) -> str:
    return (
        "%"
        + value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        + "%"
    )


def router(auth, db, manager):
    async def administrator(user: Annotated[User, Depends(auth.current_user)]):
        if not user.is_superuser:
            raise HTTPException(403, "仅管理员可以访问管理后台。")
        return user

    api = APIRouter(
        prefix="/api/admin", tags=["admin"], dependencies=[Depends(administrator)]
    )

    @api.get("/overview")
    async def overview() -> dict:
        async with db.sessions() as session:
            counts = {}
            for key, model in (
                ("users", User),
                ("agents", AgentDefinition),
                ("skills", Skill),
                ("tasks", Task),
            ):
                counts[key] = await session.scalar(
                    select(func.count()).select_from(model)
                )
            statuses = dict(
                (
                    await session.execute(
                        select(Task.status, func.count()).group_by(Task.status)
                    )
                ).all()
            )
        return {
            "counts": counts,
            "statuses": statuses,
            "attached_workers": len(manager.live),
        }

    @api.get("/users")
    async def users(
        offset: Annotated[int, Query(ge=0)] = 0,
        search: str = "",
        role: Literal["", "admin", "member"] = "",
        status: Literal["", "active", "inactive"] = "",
    ) -> dict:
        statement = select(User)
        if search.strip():
            statement = statement.where(
                User.email.ilike(search_pattern(search), escape="\\")
            )
        if role:
            statement = statement.where(User.is_superuser == (role == "admin"))
        if status:
            statement = statement.where(User.is_active == (status == "active"))
        async with db.sessions() as session:
            total = await session.scalar(
                select(func.count()).select_from(statement.subquery())
            )
            rows = (
                await session.scalars(
                    statement.order_by(User.email).offset(offset).limit(50)
                )
            ).all()
            return {
                "total": total,
                "items": [
                    {
                        "id": str(u.id),
                        "email": u.email,
                        "is_active": u.is_active,
                        "is_superuser": u.is_superuser,
                        "is_verified": u.is_verified,
                    }
                    for u in rows
                ],
            }

    @api.get("/tasks")
    async def tasks(
        offset: Annotated[int, Query(ge=0)] = 0,
        status: str = "",
        search: str = "",
        period: Literal["", "1", "7", "30"] = "",
        kind: Literal["", "root", "child"] = "",
        worker: Literal["", "attached"] = "",
        agent_id: str = "",
        owner_id: uuid.UUID | None = None,
    ) -> dict:
        statement = (
            select(Task, User.email, Conversation.title)
            .outerjoin(User, Task.owner_id == User.id)
            .outerjoin(Conversation, Task.conversation_id == Conversation.id)
        )
        if owner_id:
            statement = statement.where(Task.owner_id == owner_id)
        if status:
            statement = statement.where(Task.status == status)
        if search.strip():
            pattern = search_pattern(search)
            statement = statement.where(
                User.email.ilike(pattern, escape="\\")
                | Task.id.ilike(pattern, escape="\\")
                | Conversation.title.ilike(pattern, escape="\\")
                | Task.prompt.ilike(pattern, escape="\\")
                | Task.definition["name"].as_string().ilike(pattern, escape="\\")
            )
        if worker:
            statement = statement.where(Task.id.in_(list(manager.live)))
        if agent_id:
            statement = statement.where(
                Task.agent_id.in_([agent_id, "draft:" + agent_id])
            )
        if period:
            since = (datetime.now(UTC) - timedelta(days=int(period))).isoformat()
            statement = statement.where(Task.created_at >= since)
        if kind:
            statement = statement.where(
                Task.parent_id.is_(None)
                if kind == "root"
                else Task.parent_id.is_not(None)
            )
        async with db.sessions() as session:
            total = await session.scalar(
                select(func.count()).select_from(statement.subquery())
            )
            rows = (
                await session.execute(
                    statement.order_by(Task.created_at.desc(), Task.id)
                    .offset(offset)
                    .limit(50)
                )
            ).all()
            return {
                "total": total,
                "items": [
                    {
                        "id": t.id,
                        "conversation_id": t.conversation_id,
                        "name": t.definition.get("name", "智能体"),
                        "title": title
                        if not t.parent_id and title and title != "新对话"
                        else t.prompt[:120],
                        "owner": email or "已删除账户",
                        "status": t.status,
                        "created_at": t.created_at,
                        "finished_at": t.finished_at,
                    }
                    for t, email, title in rows
                ],
            }

    @api.get("/agents")
    async def agents(
        offset: Annotated[int, Query(ge=0)] = 0,
        search: str = "",
        status: Literal["", "draft", "published", "archived"] = "",
        owner_id: uuid.UUID | None = None,
    ) -> dict:
        statement = (
            select(AgentDefinition, User.email, AgentVersion.definition)
            .outerjoin(User, AgentDefinition.owner_id == User.id)
            .outerjoin(
                AgentVersion, AgentDefinition.published_version == AgentVersion.id
            )
        )
        if owner_id:
            statement = statement.where(AgentDefinition.owner_id == owner_id)
        if search.strip():
            pattern = search_pattern(search)
            statement = statement.where(
                AgentDefinition.name.ilike(pattern, escape="\\")
                | User.email.ilike(pattern, escape="\\")
            )
        if status == "archived":
            statement = statement.where(AgentDefinition.archived.is_(True))
        elif status:
            statement = statement.where(
                AgentDefinition.archived.is_(False),
                AgentDefinition.published_version.is_(None)
                if status == "draft"
                else AgentDefinition.published_version.is_not(None),
            )
        async with db.sessions() as session:
            total = await session.scalar(
                select(func.count()).select_from(statement.subquery())
            )
            rows = (
                await session.execute(
                    statement.order_by(
                        AgentDefinition.created_at.desc(), AgentDefinition.id
                    )
                    .offset(offset)
                    .limit(50)
                )
            ).all()
            skill_ids = {
                b["id"]
                for a, _, published in rows
                for definition in (a.draft, published or {})
                for b in definition.get("skills", [])
            }
            names = dict(
                (
                    await session.execute(
                        select(Skill.id, Skill.name).where(Skill.id.in_(skill_ids))
                    )
                ).all()
            )
            return {
                "total": total,
                "items": [
                    {
                        "id": a.id,
                        "name": a.name,
                        "description": a.description,
                        "published_version": a.published_version,
                        "owner": email or "已删除账户",
                        "status": "已归档"
                        if a.archived
                        else "已发布"
                        if a.published_version
                        else "草稿",
                        "created_at": a.created_at,
                        "draft_skills": [
                            names.get(b["id"], "已移除的 Skill")
                            for b in a.draft.get("skills", [])
                        ],
                        "published_skills": [
                            names.get(b["id"], "已移除的 Skill")
                            for b in (published or {}).get("skills", [])
                        ],
                    }
                    for a, email, published in rows
                ],
            }

    return api
