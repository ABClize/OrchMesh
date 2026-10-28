"""Builder-only skill management; normal tasks cannot acquire these privileges."""

import tempfile
from pathlib import Path

from sqlalchemy import select

from ..storage import (
    AgentDefinition,
    Conversation,
    Skill,
    SkillRevision,
    ToolReceipt,
    User,
)
from .skills import SourceImport, export, import_source, safe_path, store, unpack


async def manage(engine, task, name, args, key):
    async with engine.db.sessions.begin() as session:
        conversation = await session.get(Conversation, task.conversation_id)
        owner = await session.get(User, task.owner_id)
        if (
            not conversation
            or not conversation.creator
            or conversation.user_id != task.owner_id
        ):
            raise ValueError("Skill management is only available to Builder")
        if name == "list_skills":
            rows = (
                await session.scalars(select(Skill).where(Skill.enabled.is_(True)))
            ).all()
            return {"skills": [export(row) for row in rows]}
        if name == "list_agent_drafts":
            rows = (
                await session.scalars(
                    select(AgentDefinition).where(
                        AgentDefinition.owner_id == task.owner_id,
                        AgentDefinition.archived.is_(False),
                    )
                )
            ).all()
            return {"agents": [{"id": row.id, "draft": row.draft} for row in rows]}
        if name == "inspect_skill":
            item = await session.get(Skill, args["id"])
            if not item or not item.enabled:
                raise ValueError("Skill unavailable")
            revision = await session.get(SkillRevision, item.revision)
            return {
                **export(item),
                "definition": revision.definition,
                "files": list(revision.files),
            }
        if not owner or not owner.is_superuser:
            raise ValueError("Administrator permission required")
        if name == "import_skill":
            result = await import_source(
                session, engine.settings, SourceImport.model_validate(args)
            )
            session.add(ToolReceipt(id=key, task_id=task.id, result=result))
            return result
        item = await session.get(Skill, args["id"])
        if not item:
            raise ValueError("Skill not found")
        revision = await session.get(SkillRevision, item.revision)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            unpack(revision.files, root)
            path = root / safe_path(args["path"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(args["content"])
            result = await store(
                session, engine.settings, root, item.source, item.id, args["revision"]
            )

            session.add(ToolReceipt(id=key, task_id=task.id, result=result))
            return result
