"""Authenticated transport for DSH's live human and task controls."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from .dsh.events import history
from .dsh.manager import Busy
from .storage import Conversation, User


class AnswerItem(BaseModel):
    id: str
    selected: list[str] = Field(default_factory=list)
    custom: str | None = Field(default=None, max_length=32000)


class ActivityAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["answer", "prompt", "queue", "child-stop"]
    request_id: str | None = None
    outcome: Literal["allowed-once", "rejected"] | None = None
    answers: list[AnswerItem] | None = None
    text: str | None = Field(default=None, min_length=1, max_length=32000)
    mode: Literal["queue", "steer"] = "queue"
    item_id: str | None = None
    action: Literal["edit", "remove", "steer"] | None = None
    child_id: str | None = None


def router(auth, db, manager):
    routes = APIRouter(prefix="/api/conversations/{conversation_id}/activity")

    async def owner(
        conversation_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        row = await session.get(Conversation, conversation_id)
        if row is None or row.user_id != user.id:
            raise HTTPException(404, "Conversation not found")
        return user

    @routes.get("")
    async def read(conversation_id: str, user: Annotated[User, Depends(owner)]) -> dict:
        return await manager.activity(user.id, conversation_id, "activity/read")

    @routes.get("/children/{child_id}")
    async def child_history(
        conversation_id: str, child_id: str, user: Annotated[User, Depends(owner)]
    ) -> dict:
        try:
            result = await manager.activity(
                user.id, conversation_id, "activity/child-history", childId=child_id
            )
        except RuntimeError as exc:
            raise HTTPException(404, "Child history unavailable") from exc
        messages, _ = history(result["events"])
        return {"messages": messages}

    @routes.post("")
    async def act(
        conversation_id: str,
        body: ActivityAction,
        user: Annotated[User, Depends(owner)],
    ) -> dict:
        params = {}
        if body.kind == "answer":
            if not body.request_id or (body.outcome is None and body.answers is None):
                raise HTTPException(422, "An explicit answer is required")
            params = {"requestId": body.request_id, "outcome": body.outcome}
            if body.answers is not None:
                params["answers"] = [
                    a.model_dump(exclude_none=True) for a in body.answers
                ]
            method = "activity/answer"
        elif body.kind == "prompt":
            if not body.text or not body.text.strip():
                raise HTTPException(422, "Message must not be blank")
            method = "session/prompt"
            params = {
                "mode": body.mode,
                "contentBlocks": [{"type": "text", "text": body.text}],
            }
        elif body.kind == "queue":
            if not body.item_id or not body.action:
                raise HTTPException(422, "Queue item and action required")
            action: dict = {"kind": body.action}
            if body.action == "edit":
                if not body.text or not body.text.strip():
                    raise HTTPException(422, "Message must not be blank")
                action["content"] = [{"type": "text", "text": body.text}]
            method = "activity/queue"
            params = {"itemId": body.item_id, "action": action}
        else:
            if not body.child_id:
                raise HTTPException(422, "Child required")
            method = "activity/child-stop"
            params = {"childId": body.child_id}
        try:
            return await manager.activity(
                user.id, conversation_id, method, mutate=True, **params
            )
        except RuntimeError as exc:
            raise HTTPException(
                409, "请求已结束、内容无效或状态已变化，请刷新后重试"
            ) from exc
        except Busy:
            raise

    return routes
