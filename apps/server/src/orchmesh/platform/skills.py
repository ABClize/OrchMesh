"""Public skill catalog, immutable bundles and creator-scoped management."""

import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import signal
import tempfile
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..storage import AgentDefinition, Skill, SkillRevision

MAX_BYTES = 25 * 1024 * 1024


class SourceImport(BaseModel):
    source: str = Field(min_length=1, max_length=2000)
    name: str = Field(min_length=1, max_length=128)
    replace_id: str | None = None
    revision: str | None = None


class FileEdit(BaseModel):
    path: str
    content: str = Field(max_length=1_000_000)
    revision: str


class SkillState(BaseModel):
    enabled: bool
    revision: str


def safe_path(value: str) -> str:
    p = PurePosixPath(value)
    if (
        not p.parts
        or "\x00" in value
        or p.is_absolute()
        or ".." in p.parts
        or "\\" in value
    ):
        raise ValueError("Invalid skill resource path")
    return str(p)


async def subprocess_json(settings, script: str, *args: str, cwd=None):
    process = await asyncio.create_subprocess_exec(
        "node",
        str(settings.runtime_dir / script),
        *args,
        cwd=cwd,
        env={**os.environ, "DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1"},
        start_new_session=True,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), 120)
    except BaseException:
        os.killpg(process.pid, signal.SIGKILL)
        await process.wait()
        raise
    if process.returncode:
        raise ValueError("Skill 导入或解析失败，请检查来源、名称和 SKILL.md 格式。")
    return json.loads(output)


async def parse_bundle(settings, directory: Path) -> dict:
    # Official DSH filesystem parser owns frontmatter and invocation semantics.
    with tempfile.TemporaryDirectory(prefix="orchmesh-parse-") as temporary:
        isolated = Path(temporary) / "bundle"
        shutil.copytree(directory, isolated, symlinks=True)
        return await subprocess_json(settings, "skill-probe.mjs", str(isolated))


def pack(directory: Path) -> dict[str, str]:
    files = {}
    total = 0
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("Skill 包不能包含符号链接")
        if not path.is_file():
            continue
        data = path.read_bytes()
        total += len(data)
        if total > MAX_BYTES or len(files) >= 1000:
            raise ValueError("Skill 包超过 25 MiB 或 1000 个文件")
        files[safe_path(path.relative_to(directory).as_posix())] = base64.b64encode(
            data
        ).decode()
    if "SKILL.md" not in files:
        raise ValueError("Skill 包缺少 SKILL.md")
    return files


def unpack(files: dict[str, str], directory: Path):
    for name, data in files.items():
        target = directory / safe_path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(data, validate=True))


async def store(session, settings, directory, source, replace_id=None, expected=None):
    files = pack(directory)
    definition = await parse_bundle(settings, directory)
    digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    existing = (
        await session.get(
            Skill, replace_id, with_for_update=True, populate_existing=True
        )
        if replace_id
        else None
    )
    if replace_id and not existing:
        raise ValueError("Skill 不存在")
    if existing and expected != existing.revision:
        raise ValueError("Skill 已更新，请重新读取后再编辑")
    conflict = await session.scalar(
        select(Skill).where(Skill.name == definition["name"])
    )
    if conflict and (not existing or conflict.id != existing.id):
        raise ValueError("同名 Skill 已存在，请使用更新或替换入口")
    if existing and existing.name != definition["name"]:
        raise ValueError("更新不能改变 Skill 名称，请作为新 Skill 导入")
    if not await session.get(SkillRevision, digest):
        session.add(SkillRevision(id=digest, files=files, definition=definition))
    item = existing or Skill(id=str(uuid.uuid4()), name=definition["name"])
    item.description = definition["description"]
    item.revision, item.source = digest, source
    if not existing:
        item.enabled = True
        session.add(item)
    await session.flush()
    return export(item)


def export(item):
    return {
        key: getattr(item, key)
        for key in ("id", "name", "description", "source", "revision", "enabled")
    }


async def import_source(session, settings, body: SourceImport):
    # Deliberately reject local paths / arbitrary CLI flags from remote callers.
    if not (
        body.source.startswith("https://")
        or (
            len(body.source.split("/")) == 2
            and all(
                part
                and all(c.isalnum() or c in "-_." for c in part)
                and part not in (".", "..")
                for part in body.source.split("/")
            )
        )
    ):
        raise ValueError("来源需为 HTTPS 地址或 owner/repository")
    if body.name.startswith("-"):
        raise ValueError("无效 Skill 名称")
    with tempfile.TemporaryDirectory(prefix="orchmesh-skills-") as temporary:
        root = Path(temporary)
        await subprocess_json(
            settings, "skill-import.mjs", body.source, body.name, str(root)
        )
        candidates = list((root / ".agents" / "skills").glob("*/SKILL.md"))
        if len(candidates) != 1:
            raise ValueError("请选择来源中的一个明确 Skill")
        return await store(
            session,
            settings,
            candidates[0].parent,
            body.source,
            body.replace_id,
            body.revision,
        )


async def freeze_skills(session, bindings: list[dict]) -> list[dict]:
    result, names = [], set()
    for binding in bindings:
        item = await session.get(Skill, binding["id"])
        revision = await session.get(SkillRevision, binding["revision"])
        if (
            not item
            or not item.enabled
            or not revision
            or revision.definition["name"] != item.name
        ):
            raise ValueError("Skill 不可用，请重新选择绑定")
        if item.name in names:
            raise ValueError("同一 Agent 不能绑定重复名称的 Skill")
        names.add(item.name)
        result.append(
            {
                "id": item.id,
                "revision": revision.id,
                "name": item.name,
                "description": revision.definition["description"],
            }
        )
    return result


async def task_skills(session, bindings, root: Path) -> list[dict]:
    result = []
    target = root / "skills"
    target.mkdir(parents=True, exist_ok=True)
    for binding in bindings:
        revision = await session.get(SkillRevision, binding["revision"])
        if not revision:
            raise ValueError("任务绑定的 Skill 快照缺失")
        directory = target / revision.definition["name"]
        # Rebuild from immutable bundle, never from the task workspace.
        unpack(revision.files, directory)
        result.append(
            {
                **revision.definition,
                "revision": revision.id,
                "resourceBase": {
                    "kind": "directory",
                    "path": "/skills/" + revision.definition["name"],
                },
            }
        )
    return result


def router(settings, auth, db):
    api = APIRouter(prefix="/api/skills", tags=["skills"])

    def admin(user):
        if not user.is_superuser:
            raise HTTPException(403, "仅管理员可以修改公共 Skill 库")

    @api.get("")
    async def listing(user=Depends(auth.current_user)) -> list[dict]:
        async with db.sessions() as session:
            rows = (await session.scalars(select(Skill).order_by(Skill.name))).all()
            return [export(row) for row in rows]

    @api.get("/{identifier}")
    async def detail(
        identifier: str, revision: str | None = None, user=Depends(auth.current_user)
    ) -> dict:
        async with db.sessions() as session:
            item = await session.get(Skill, identifier)
            if not item or (not item.enabled and not user.is_superuser):
                raise HTTPException(404, "Skill 不存在")
            rev = await session.get(SkillRevision, revision or item.revision)
            if not rev or rev.definition["name"] != item.name:
                raise HTTPException(404, "Skill 版本不存在")
            agents = (await session.scalars(select(AgentDefinition))).all()
            return {
                **export(item),
                "definition": rev.definition,
                "revision": rev.id,
                "files": rev.files,
                "used_by": [
                    {"id": a.id, "name": a.name}
                    for a in agents
                    if any(b["id"] == identifier for b in a.draft.get("skills", []))
                    and (a.owner_id == user.id or user.is_superuser)
                ],
            }

    @api.post("/import")
    async def online(body: SourceImport, user=Depends(auth.current_user)) -> dict:
        admin(user)
        try:
            async with db.sessions.begin() as session:
                return await import_source(session, settings, body)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @api.post("/upload")
    async def upload(
        file: UploadFile,
        replace_id: str | None = None,
        revision: str | None = None,
        user=Depends(auth.current_user),
    ) -> dict:
        admin(user)
        data = await file.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(413, "上传限 10 MiB")
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                if (file.filename or "").endswith(".md"):
                    (root / "SKILL.md").write_bytes(data)
                else:
                    with zipfile.ZipFile(io.BytesIO(data)) as archive:
                        entries = archive.infolist()
                        if (
                            len(entries) > 1000
                            or sum(x.file_size for x in entries) > MAX_BYTES
                        ):
                            raise ValueError("解压后超过 25 MiB 或 1000 个文件")
                        for entry in entries:
                            name = safe_path(entry.filename)
                            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                                raise ValueError("不支持符号链接")
                            if not entry.is_dir():
                                target = root / name
                                target.parent.mkdir(parents=True, exist_ok=True)
                                target.write_bytes(archive.read(entry))
                candidates = list(root.rglob("SKILL.md"))
                if len(candidates) != 1:
                    raise ValueError(
                        "请上传包含一个 SKILL.md 的 ZIP 包或单独的 SKILL.md"
                    )
                async with db.sessions.begin() as session:
                    return await store(
                        session,
                        settings,
                        candidates[0].parent,
                        "upload",
                        replace_id,
                        revision,
                    )
        except (ValueError, zipfile.BadZipFile) as e:
            raise HTTPException(422, str(e)) from None

    @api.put("/{identifier}/file")
    async def edit(
        identifier: str, body: FileEdit, user=Depends(auth.current_user)
    ) -> dict:
        admin(user)
        try:
            async with db.sessions.begin() as session:
                item = await session.get(Skill, identifier)
                if not item:
                    raise ValueError("Skill 不存在")
                rev = await session.get(SkillRevision, item.revision)
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    unpack(rev.files, root)
                    target = root / safe_path(body.path)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(body.content)
                    return await store(
                        session, settings, root, item.source, identifier, body.revision
                    )
        except ValueError as e:
            raise HTTPException(422, str(e)) from None

    @api.put("/{identifier}/state")
    async def state(
        identifier: str, body: SkillState, user=Depends(auth.current_user)
    ) -> dict:
        admin(user)
        async with db.sessions.begin() as session:
            item = await session.get(Skill, identifier)
            if not item:
                raise HTTPException(404)
            if item.revision != body.revision:
                raise HTTPException(409, "Skill 已更新")
            item.enabled = body.enabled
            return export(item)

    return api
