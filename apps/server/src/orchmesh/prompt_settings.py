"""Current administrator prompt configuration and immutable task snapshots."""

import hashlib
import json
import os
import tempfile
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings
from .storage import User

DEFAULT_CONTINUATION = (
    "Continue the saved task. Check existing results before repeating any "
    "operation with an unknown outcome. The temporary execution environment "
    "is available if configured. Use list_agent_tasks to check collaborator "
    "status and get_task_result only when you need its output."
)


class Prompts(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    continuation: str = Field(min_length=1, max_length=32000)
    assistant: str = Field(min_length=1, max_length=32000)
    builder: str = Field(min_length=1, max_length=32000)
    platform: str = Field(min_length=1, max_length=32000)


DEFAULTS = Prompts(
    continuation=DEFAULT_CONTINUATION,
    assistant="Help the user. Discover suitable published agents and "
    "delegate distinct work. Never duplicate work already "
    "delegated in this root task.",
    builder="Interview the user to clarify a reusable agent's "
    "responsibility, tools, knowledge and behavior. Ask focused "
    "questions using ask_user_question. Create or update a draft "
    "only after clarifying requirements. Never publish: the user "
    "must explicitly confirm publication in the interface.",
    platform="Use request_execution before code or filesystem work. After"
    " it completes, continue using the official remote tools. Use"
    " present to deliver files. Verify unknown tool outcomes "
    "before repeating effects. Never claim a tool succeeded "
    "without evidence. For independent collaborators use start_agent_task "
    "for each assignment first; these return immediately. Continue your own "
    "work, then use wait_for_tasks (any/all) for status only "
    "and get_task_result to read outputs before your "
    "final summary. delegate_task is only the legacy blocking alternative.",
)


def read_prompts(settings: Settings) -> Prompts:
    path = settings.data_dir / "platform-prompts.json"
    return (
        Prompts.model_validate(
            {"continuation": DEFAULT_CONTINUATION, **json.loads(path.read_text())}
        )
        if path.exists()
        else DEFAULTS.model_copy()
    )


def revision(prompts: Prompts) -> str:
    return hashlib.sha256(prompts.model_dump_json().encode()).hexdigest()


def write_prompts(settings: Settings, prompts: Prompts) -> None:
    path = settings.data_dir / "platform-prompts.json"
    fd, temporary = tempfile.mkstemp(prefix=".prompts-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(prompts.model_dump(), stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class PromptCatalog(BaseModel):
    prompts: Prompts
    defaults: Prompts
    revision: str


class PromptWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompts: Prompts
    revision: str


def router(settings, auth):
    api = APIRouter(prefix="/api/settings/prompts", tags=["prompt-settings"])

    async def administrator(user: Annotated[User, Depends(auth.current_user)]):
        if not user.is_superuser:
            raise HTTPException(403, "仅管理员可以管理提示词。")
        return user

    def catalog():
        prompts = read_prompts(settings)
        return PromptCatalog(
            prompts=prompts, defaults=DEFAULTS, revision=revision(prompts)
        )

    @api.get("")
    async def get(user: Annotated[User, Depends(administrator)]) -> PromptCatalog:
        return catalog()

    @api.put("")
    async def save(
        body: PromptWrite, user: Annotated[User, Depends(administrator)]
    ) -> PromptCatalog:
        # Synchronous atomic replacement in the single API owner; no await between
        # compare and write. The hash is a conflict token, not a version archive.
        if revision(read_prompts(settings)) != body.revision:
            raise HTTPException(409, "提示词已被更新，请重新读取后再编辑。")
        write_prompts(settings, body.prompts)
        return catalog()

    return api
