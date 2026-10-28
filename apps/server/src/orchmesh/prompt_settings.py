"""Current administrator prompt configuration and immutable task snapshots."""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings
from .storage import User

PROMPT_ROOT = Path(__file__).with_name("prompts")
DEFAULT_CONTINUATION = (PROMPT_ROOT / "continuation.md").read_text().strip()


class Prompts(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    continuation: str = Field(min_length=1, max_length=32000)
    assistant: str = Field(min_length=1, max_length=32000)
    builder: str = Field(min_length=1, max_length=32000)
    platform: str = Field(min_length=1, max_length=32000)


DEFAULTS = Prompts(
    **{
        key: (PROMPT_ROOT / f"{key}.md").read_text().strip()
        for key in ("assistant", "builder", "platform", "continuation")
    }
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
