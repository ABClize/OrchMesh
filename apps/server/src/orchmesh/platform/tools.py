"""Platform business tools; DSH supplies the agent loop and execution tools."""

import uuid

from sqlalchemy import select

from ..storage import AgentDefinition, Memory, Preference, Task, ToolReceipt


def definitions(creator: bool) -> list[dict]:
    tools = [
        {
            "name": "search_knowledge",
            "description": (
                "Search the agent version's knowledge or your own private "
                "assistant knowledge. Cite the source title."
            ),
            "parameters": {"query": {"type": "string", "required": True}},
        },
        {
            "name": "remember_preference",
            "description": (
                "Remember a stable user preference explicitly expressed by the user. "
                "Do not store task results or secrets as personal habits."
            ),
            "parameters": {"content": {"type": "string", "required": True}},
        },
        {
            "name": "request_execution",
            "description": (
                "Allocate a temporary isolated code and file workspace for "
                "this task, then continue using its official tools."
            ),
            "parameters": {},
        },
        {
            "name": "discover_agents",
            "description": "List published reusable agents available for delegation.",
            "parameters": {},
        },
        {
            "name": "collaboration_status",
            "description": (
                "Inspect ancestor and sibling task assignments before "
                "delegating. Reuse existing work instead of repeating it."
            ),
            "parameters": {},
        },
        {
            "name": "start_agent_task",
            "description": (
                "Start a distinct published agent task through A2A and immediately "
                "return its task_id without waiting. Start independent tasks first, "
                "continue your own work, then wait_for_tasks for status "
                "and get_task_result for output. "
                "Reuse work_key for the same assignment; never duplicate work."
            ),
            "parameters": {
                "agent_id": {"type": "string", "required": True},
                "task": {"type": "string", "required": True},
                "work_key": {"type": "string", "required": True},
            },
        },
        {
            "name": "wait_for_tasks",
            "description": (
                "Wait for any or all specified task_ids and return statuses ONLY. "
                "Read output explicitly with get_task_result. Start independent tasks "
                "before waiting. Failed/stopped tasks return their status too. "
                "Never wait on yourself or an ancestor."
            ),
            "parameters": {
                "mode": {"type": "string", "enum": ["any", "all"]},
                "task_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "required": True,
                },
            },
        },
        {
            "name": "list_agent_tasks",
            "description": "List collaboration identities and statuses only.",
            "parameters": {},
        },
        {
            "name": "get_task_result",
            "description": (
                "Read final output explicitly after checking task status. "
                "No execution history. Does not wait."
            ),
            "parameters": {"task_id": {"type": "string", "required": True}},
        },
        {
            "name": "delegate_task",
            "description": (
                "Legacy synchronous delegation, retained for saved sessions. "
                "Prefer start_agent_task then wait_for_tasks for new work. "
                "This waits for the result. Do not delegate the same work "
                "twice or wait on an ancestor."
            ),
            "parameters": {
                "agent_id": {"type": "string", "required": True},
                "task": {"type": "string", "required": True},
                "work_key": {
                    "type": "string",
                    "required": True,
                    "description": (
                        "Stable semantic identifier for this unit of work, reused for"
                        " duplicates within the root task."
                    ),
                },
            },
        },
    ]
    if creator:
        tools.append(
            {
                "name": "save_agent_draft",
                "description": (
                    "Save an editable reusable agent draft. "
                    "Publication requires explicit user confirmation."
                ),
                "parameters": {
                    "tools": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Allowed capabilities: collaboration, execution, web; "
                            "use [] for none."
                        ),
                    },
                    "knowledge_ids": {"type": "array", "items": {"type": "string"}},
                    "id": {
                        "type": "string",
                        "description": "Existing draft ID, omit for a new draft",
                    },
                    "name": {"type": "string", "required": True},
                    "description": {"type": "string", "required": True},
                    "instructions": {"type": "string", "required": True},
                },
            }
        )
    return tools


async def invoke(engine, task: Task, name: str, args: dict, call_id: str):
    key = f"{task.id}:{call_id}"
    async with engine.db.sessions() as session:
        receipt = await session.get(ToolReceipt, key)
        if receipt:
            return receipt.result
    if name in (
        "delegate_task",
        "start_agent_task",
        "wait_for_tasks",
        "get_task_result",
        "list_agent_tasks",
    ):
        if engine.protocol is None:
            raise RuntimeError("A2A service unavailable")
        if name == "start_agent_task":
            result = await engine.protocol.start(task, args)
        elif name == "wait_for_tasks":
            result = await engine.protocol.collect(
                task, args["task_ids"], args.get("mode", "all")
            )
        elif name == "get_task_result":
            result = await engine.protocol.read_result(task, args["task_id"])
        elif name == "list_agent_tasks":
            result = {"tasks": await engine.protocol.statuses(task)}
        else:
            result = await engine.protocol.delegate(task, args)
    else:
        async with engine.db.sessions.begin() as session:
            if name == "search_knowledge":
                from .knowledge import search

                result = await search(session, task, args["query"])
            elif name == "remember_preference":
                preference = await session.get(Preference, task.owner_id)
                if preference and not preference.memory_enabled:
                    raise ValueError("Memory is disabled")
                content = args["content"].strip()
                if not content or len(content) > 32000:
                    raise ValueError("Invalid memory")
                identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, key))
                session.add(
                    Memory(
                        id=identifier,
                        owner_id=task.owner_id,
                        agent_id=task.agent_id,
                        content=content,
                    )
                )
                result = {"memory_id": identifier}
            elif name == "request_execution":
                saved = await session.get(Task, task.id)
                saved.sandbox = True
                result = {"status": "execution_requested", "workspace": "/workspace"}
            elif name == "discover_agents":
                agents = (
                    await session.scalars(
                        select(AgentDefinition).where(
                            AgentDefinition.archived.is_(False),
                            AgentDefinition.published_version.is_not(None),
                        )
                    )
                ).all()
                result = {
                    "agents": [
                        {
                            "id": agent.id,
                            "name": agent.name,
                            "description": agent.description,
                        }
                        for agent in agents
                    ]
                }
            elif name == "collaboration_status":
                tasks = (
                    await session.scalars(
                        select(Task).where(
                            Task.root_id == task.root_id, Task.owner_id == task.owner_id
                        )
                    )
                ).all()
                result = {
                    "tasks": [
                        {
                            "id": row.id,
                            "parent": row.parent_id,
                            "agent": row.agent_id,
                            "task": row.prompt,
                            "status": row.status,
                        }
                        for row in tasks
                    ]
                }
            elif name == "save_agent_draft":
                # Caller capability is fixed by the creator
                # conversation, never by a model flag.
                from ..storage import Conversation

                conversation = await session.get(Conversation, task.conversation_id)
                if not conversation.creator:
                    raise ValueError("Draft authoring unavailable")
                identifier = args.get("id") or str(uuid.uuid5(uuid.NAMESPACE_URL, key))
                agent = await session.get(AgentDefinition, identifier)
                if agent and agent.owner_id != task.owner_id:
                    raise ValueError("Draft ownership mismatch")
                definition = {
                    "name": args["name"],
                    "description": args["description"],
                    "instructions": args["instructions"],
                }
                from .catalog import Definition

                definition = Definition.model_validate(
                    {
                        **definition,
                        "tools": args.get("tools", []),
                        "knowledge_ids": args.get("knowledge_ids", []),
                    }
                ).model_dump()
                if agent is None:
                    agent = AgentDefinition(
                        id=identifier, owner_id=task.owner_id, name=args["name"]
                    )
                    session.add(agent)
                agent.name, agent.description, agent.draft = (
                    args["name"],
                    args["description"],
                    definition,
                )
                result = {
                    "draft_id": identifier,
                    "status": "draft",
                    "definition": definition,
                }
            else:
                raise ValueError("Unknown platform tool")
            session.add(ToolReceipt(id=key, task_id=task.id, result=result))
        return result
    async with engine.db.sessions.begin() as session:
        if await session.get(ToolReceipt, key) is None:
            session.add(ToolReceipt(id=key, task_id=task.id, result=result))
    return result
