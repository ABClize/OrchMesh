"""Agent drafts, immutable publication and owner-scoped durable user context."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from ..storage import (
    AgentComment,
    AgentDefinition,
    AgentVersion,
    Knowledge,
    Memory,
    Preference,
    Task,
    User,
)


class SkillBinding(BaseModel):
    id: str
    revision: str


class Definition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    instructions: str = Field(min_length=1, max_length=32000)
    tools: list[Literal["collaboration", "execution", "web"]] = Field(
        default_factory=lambda: ["collaboration", "execution"]
    )
    knowledge_ids: list[str] = Field(default_factory=list)
    skills: list[SkillBinding] = Field(default_factory=list, max_length=50)


class MemorySettings(BaseModel):
    enabled: bool


class Publication(BaseModel):
    confirm: bool


class CommentBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ContextBody(BaseModel):
    content: str = Field(min_length=1, max_length=32000)
    title: str = Field(default="", max_length=255)
    enabled: bool = True
    agent_id: str | None = None


async def freeze_definition(session, agent):
    definition = Definition.model_validate(agent.draft)
    frozen = definition.model_dump()
    from .skills import freeze_skills

    try:
        frozen["skills"] = await freeze_skills(session, frozen["skills"])
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    frozen["knowledge"] = []
    for identifier in definition.knowledge_ids:
        item = await session.get(Knowledge, identifier)
        if not item or item.owner_id != agent.owner_id:
            raise HTTPException(422, "Knowledge must belong to the author")
        frozen["knowledge"].append({"title": item.title, "content": item.content})
    return frozen


def router(auth, db):
    api = APIRouter(prefix="/api", tags=["platform"])

    def export(agent):
        return {
            "id": agent.id,
            "owner_id": str(agent.owner_id),
            "name": agent.name,
            "description": agent.description,
            "published_version": agent.published_version,
            "archived": agent.archived,
            "draft": agent.draft,
        }

    async def editable(session, identifier, user):
        agent = await session.get(AgentDefinition, identifier)
        if not agent or (agent.owner_id != user.id and not user.is_superuser):
            raise HTTPException(404, "Agent not found")
        return agent

    @api.get("/agents")
    async def listing(
        user: Annotated[User, Depends(auth.current_user)], mine: bool = False
    ) -> list[dict]:
        async with db.sessions() as session:
            query = select(AgentDefinition).where(AgentDefinition.archived.is_(False))
            query = (
                query.where(AgentDefinition.owner_id == user.id)
                if mine
                else query.where(AgentDefinition.published_version.is_not(None))
            )
            values = (await session.scalars(query)).all()
            result = []
            for agent in values:
                value = export(agent)
                if not mine:
                    version = await session.get(AgentVersion, agent.published_version)
                    value["draft"] = version.definition
                    value["name"] = version.definition["name"]
                    value["description"] = version.definition.get("description", "")
                result.append(value)
            return result

    @api.get("/agents/{agent_id}")
    async def detail(
        agent_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        async with db.sessions() as session:
            return export(await editable(session, agent_id, user))

    @api.get("/agents/{agent_id}/knowledge")
    async def agent_knowledge(
        agent_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> list[dict]:
        async with db.sessions() as session:
            agent = await editable(session, agent_id, user)
            items = (
                await session.scalars(
                    select(Knowledge).where(Knowledge.owner_id == agent.owner_id)
                )
            ).all()
            return [
                {
                    "id": item.id,
                    "title": item.title,
                    "content": item.content,
                    "enabled": True,
                    "agent_id": item.agent_id,
                }
                for item in items
            ]

    @api.post("/agents", status_code=201)
    async def create(
        body: Definition, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        async with db.sessions.begin() as session:
            from .skills import freeze_skills

            try:
                await freeze_skills(session, [b.model_dump() for b in body.skills])
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            agent = AgentDefinition(
                owner_id=user.id,
                name=body.name,
                description=body.description,
                draft=body.model_dump(),
            )
            session.add(agent)
        return export(agent)

    @api.put("/agents/{agent_id}")
    async def edit(
        agent_id: str,
        body: Definition,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        async with db.sessions.begin() as session:
            agent = await editable(session, agent_id, user)
            from .skills import freeze_skills

            try:
                await freeze_skills(session, [b.model_dump() for b in body.skills])
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            for identifier in body.knowledge_ids:
                item = await session.get(Knowledge, identifier)
                if not item or item.owner_id != agent.owner_id:
                    raise HTTPException(422, "只能添加此智能体所属用户的知识。")
            agent.name, agent.description, agent.draft = (
                body.name,
                body.description,
                body.model_dump(),
            )
        return export(agent)

    @api.post("/agents/{agent_id}/publish")
    async def publish(
        agent_id: str,
        body: Publication,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        if body.confirm is not True:
            raise HTTPException(422, "Explicit publication confirmation is required")
        async with db.sessions.begin() as session:
            agent = await editable(session, agent_id, user)
            frozen = await freeze_definition(session, agent)
            trials = (
                await session.scalars(
                    select(Task).where(
                        Task.agent_id == "draft:" + agent.id,
                        Task.owner_id == agent.owner_id,
                        Task.status == "completed",
                    )
                )
            ).all()
            if not any(
                {**trial.definition, "skills": trial.definition.get("skills", [])}
                == frozen
                for trial in trials
            ):
                raise HTTPException(
                    409, "Complete a trial of this draft before publishing"
                )
            version = AgentVersion(
                id=str(uuid.uuid4()), agent_id=agent.id, definition=frozen
            )
            session.add(version)
            agent.published_version = version.id
        return export(agent)

    @api.delete("/agents/{agent_id}")
    async def archive(
        agent_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        async with db.sessions.begin() as session:
            agent = await editable(session, agent_id, user)
            agent.archived = True
        return {"status": "archived"}

    @api.get("/agents/{agent_id}/comments")
    async def comments(
        agent_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> list[dict]:
        async with db.sessions() as session:
            agent = await session.get(AgentDefinition, agent_id)
            if not agent or not agent.published_version:
                raise HTTPException(404, "Published agent not found")
            rows = (
                await session.scalars(
                    select(AgentComment).where(AgentComment.agent_id == agent_id)
                )
            ).all()
        return [
            {"id": row.id, "text": row.text, "owner_id": str(row.owner_id)}
            for row in rows
        ]

    @api.post("/agents/{agent_id}/comments", status_code=201)
    async def comment(
        agent_id: str,
        body: CommentBody,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        async with db.sessions.begin() as session:
            agent = await session.get(AgentDefinition, agent_id)
            if not agent or not agent.published_version:
                raise HTTPException(404, "Published agent not found")
            row = AgentComment(agent_id=agent_id, owner_id=user.id, text=body.text)
            session.add(row)
        return {"id": row.id}

    @api.get("/memory-settings")
    async def memory_settings(
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        async with db.sessions() as session:
            preference = await session.get(Preference, user.id)
            return {"enabled": preference.memory_enabled if preference else True}

    @api.put("/memory-settings")
    async def set_memory_settings(
        body: MemorySettings, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        async with db.sessions.begin() as session:
            preference = await session.get(Preference, user.id)
            if preference is None:
                session.add(Preference(owner_id=user.id, memory_enabled=body.enabled))
            else:
                preference.memory_enabled = body.enabled
        return {"enabled": body.enabled}

    @api.get("/context/{kind}")
    async def context(
        kind: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> list[dict]:
        model = (
            Memory if kind == "memory" else Knowledge if kind == "knowledge" else None
        )
        if model is None:
            raise HTTPException(404, "Context collection not found")
        async with db.sessions() as session:
            rows = (
                await session.scalars(select(model).where(model.owner_id == user.id))
            ).all()
        return [
            {
                "id": row.id,
                "content": row.content,
                "agent_id": row.agent_id,
                "enabled": getattr(row, "enabled", True),
                "title": getattr(row, "title", ""),
            }
            for row in rows
        ]

    @api.post("/context/{kind}", status_code=201)
    async def add_context(
        kind: str, body: ContextBody, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        if kind not in ("memory", "knowledge"):
            raise HTTPException(404, "Context collection not found")
        async with db.sessions.begin() as session:
            if body.agent_id:
                agent = await session.get(AgentDefinition, body.agent_id)
                if not agent or (
                    agent.owner_id != user.id and not agent.published_version
                ):
                    raise HTTPException(404, "Agent not found")
            values = {
                "owner_id": user.id,
                "agent_id": body.agent_id,
                "content": body.content,
            }
            row = (
                Memory(**values, enabled=body.enabled)
                if kind == "memory"
                else Knowledge(**values, title=body.title)
            )
            session.add(row)
        return {"id": row.id}

    @api.put("/context/{kind}/{identifier}")
    async def edit_context(
        kind: str,
        identifier: str,
        body: ContextBody,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        model = (
            Memory if kind == "memory" else Knowledge if kind == "knowledge" else None
        )
        if model is None:
            raise HTTPException(404, "Context collection not found")
        async with db.sessions.begin() as session:
            row = await session.get(model, identifier)
            if not row or row.owner_id != user.id:
                raise HTTPException(404, "Context not found")
            row.content = body.content
            if kind == "memory":
                row.enabled = body.enabled
            else:
                row.title = body.title
        return {"id": row.id}

    @api.delete("/context/{kind}/{identifier}")
    async def delete_context(
        kind: str, identifier: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        model = (
            Memory if kind == "memory" else Knowledge if kind == "knowledge" else None
        )
        if model is None:
            raise HTTPException(404, "Context collection not found")
        async with db.sessions.begin() as session:
            row = await session.get(model, identifier)
            if not row or row.owner_id != user.id:
                raise HTTPException(404, "Context not found")
            await session.delete(row)
        return {"status": "deleted"}

    return api
