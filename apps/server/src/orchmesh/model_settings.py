"""Administrator-only model settings. Public composer catalog stays secret-free."""

import asyncio
import uuid
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import SecretStr
from sqlalchemy import select

from .config import ModelProfile
from .dsh.model_probe import probe_model
from .model_registry import stored_catalog, write_catalog
from .platform.engine import ACTIVE
from .storage import Task, User


class ModelWrite(ModelProfile):
    api_key: SecretStr = SecretStr("")
    revision: str = "environment"
    make_default: bool = False
    creating: bool = False


def router(settings, auth, db):
    api = APIRouter(prefix="/api/settings/models", tags=["model-settings"])
    lock = settings._model_lock
    probes = asyncio.Semaphore(2)

    async def administrator(user: Annotated[User, Depends(auth.current_user)]):
        if not user.is_superuser:
            raise HTTPException(403, "仅管理员可以管理模型。")
        return user

    def catalog():
        stored = stored_catalog(settings)
        if stored:
            return stored
        models = settings.model_profiles()
        return models, settings.resolve_model().key if models else "", "environment"

    def public(profile):
        return {
            **profile.model_dump(mode="json", exclude={"api_key"}),
            "has_key": bool(profile.api_key.get_secret_value()),
        }

    def candidate(body, models):
        previous = next((p for p in models if p.key == body.key), None)
        key = body.api_key
        if not key.get_secret_value() and previous:
            key = previous.api_key
        if not key.get_secret_value():
            raise HTTPException(422, "请输入 API 密钥。")
        url = urlsplit(body.base_url)
        if (
            url.scheme not in ("https", "http")
            or not url.hostname
            or url.username
            or url.query
            or url.fragment
        ):
            raise HTTPException(
                422, "请输入不含认证信息或查询参数的 HTTP(S) API 地址。"
            )
        # Blank means retaining a secret, not sending it to a newly edited host.
        if (
            previous
            and not body.api_key.get_secret_value()
            and body.base_url != previous.base_url
        ):
            raise HTTPException(422, "修改接口地址时请重新填写密钥。")
        return ModelProfile.model_validate(
            {
                **body.model_dump(exclude={"revision", "make_default", "creating"}),
                "api_key": key,
                "supported_efforts": [],
            }
        )

    @api.get("")
    async def list_models(user: Annotated[User, Depends(administrator)]) -> dict:
        models, default, revision = catalog()
        return {
            "models": [public(p) for p in models],
            "default": default,
            "revision": revision,
        }

    @api.post("/probe")
    async def probe(
        body: ModelWrite,
        user: Annotated[User, Depends(administrator)],
        test: bool = False,
    ) -> dict:
        profile = candidate(body, catalog()[0])
        try:
            async with probes:
                return await probe_model(settings, profile, test=test)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @api.put("")
    async def save(
        body: ModelWrite, user: Annotated[User, Depends(administrator)]
    ) -> dict:
        async with lock:
            models, default, revision = catalog()
            if revision != body.revision:
                raise HTTPException(409, "配置已被更新，请刷新设置后重新编辑。")
            if body.creating and any(p.key == body.key for p in models):
                raise HTTPException(409, "模型标识已存在，请使用其他标识。")
            profile = candidate(body, models)
            try:
                async with probes:
                    info = await probe_model(settings, profile)
            except ValueError as error:
                raise HTTPException(422, str(error)) from None
            profile.supported_efforts = [e["id"] for e in info["efforts"]]
            # Serialize with admission across all conversations: the file commit
            # must not rotate credentials for already-admitted work.
            async with db.sessions.begin() as session:
                active = (
                    await session.scalars(select(Task).where(Task.status.in_(ACTIVE)))
                ).all()
                if any(
                    t.model.get("key", "default") == profile.key
                    or (body.make_default and "key" not in t.model)
                    for t in active
                ):
                    raise HTTPException(
                        409, "该模型仍有运行或等待中的任务，请结束后再编辑。"
                    )
                models = [profile if p.key == profile.key else p for p in models]
                if not any(p.key == profile.key for p in models):
                    models.append(profile)
                if body.make_default or not default:
                    default = profile.key
                write_catalog(settings, models, default, str(uuid.uuid4()))
            return {"model": public(profile), "efforts": info["efforts"]}

    return api
