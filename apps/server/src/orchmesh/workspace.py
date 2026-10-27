"""Authenticated, read-only access through pinned directory descriptors (Linux)."""

import mimetypes
import os
import stat
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.types import Receive, Scope, Send

from .auth import Auth
from .config import Settings
from .projects import owned_project, workspace_path
from .storage import Artifact, Database, User

MAX_FILE = 20 * 1024 * 1024


class OpenFileResponse(FileResponse):
    """Release the pinned descriptor even if the client disconnects."""

    def __init__(self, fd: int, **kwargs):
        self.fd = fd
        super().__init__(f"/proc/self/fd/{fd}", **kwargs)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            os.close(self.fd)


class Entry(BaseModel):
    path: str
    name: str
    directory: bool
    size: int


class Listing(BaseModel):
    entries: list[Entry]
    truncated: bool


def open_path(root: Path, path: str, *, directory=False) -> int:
    parts = path.split("/") if path else []
    if (
        len(path) > 4096
        or any(p in ("", ".", "..") for p in parts)
        or "\\" in path
        or "\x00" in path
    ):
        raise HTTPException(400, "Invalid workspace path")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for index, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if index < len(parts) - 1 or directory:
                flags |= os.O_DIRECTORY
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        valid = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        if not valid or (not directory and info.st_nlink != 1):
            raise HTTPException(404, "Not an accessible workspace file")
        return fd
    except BaseException:
        os.close(fd)
        raise


def router(settings: Settings, auth: Auth, db: Database) -> APIRouter:
    api = APIRouter(prefix="/api/workspace", tags=["workspace"])

    async def root(
        user: Annotated[User, Depends(auth.current_user)],
        project_id: uuid.UUID | None = None,
        path: str = "",
    ):
        if path.startswith("@artifacts/"):
            parts = path.split("/")
            if len(parts) != 3:
                raise HTTPException(400, "Invalid artifact reference")
            async with db.sessions() as session:
                artifact = await session.get(Artifact, parts[1])
                if (
                    not artifact
                    or artifact.owner_id != user.id
                    or artifact.name != parts[2]
                ):
                    raise HTTPException(404, "Artifact not found")
            return Path(artifact.path).parent
        if project_id:
            async with db.sessions() as session:
                await owned_project(session, user.id, project_id)
        directory = workspace_path(settings, user.id, project_id)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        return directory

    @api.get("/entries")
    def entries(
        workspace: Annotated[Path, Depends(root)],
        path: Annotated[str, Query(max_length=4096)] = "",
    ) -> Listing:
        try:
            fd = open_path(workspace, path, directory=True)
            try:
                result = []
                with os.scandir(fd) as items:
                    for item in items:
                        if len(result) >= 500:
                            return Listing(entries=result, truncated=True)
                        if item.is_symlink():
                            continue
                        info = item.stat(follow_symlinks=False)
                        if not (
                            stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)
                        ):
                            continue
                        result.append(
                            Entry(
                                path=f"{path}/{item.name}" if path else item.name,
                                name=item.name,
                                directory=stat.S_ISDIR(info.st_mode),
                                size=info.st_size,
                            )
                        )
                return Listing(
                    entries=sorted(result, key=lambda e: (not e.directory, e.name)),
                    truncated=False,
                )
            finally:
                os.close(fd)
        except OSError:
            raise HTTPException(404, "Workspace folder unavailable") from None

    @api.get("/file", response_class=FileResponse)
    def file(
        workspace: Annotated[Path, Depends(root)],
        path: Annotated[str, Query(min_length=1, max_length=4096)],
    ):
        try:
            fd = open_path(
                workspace,
                path.rsplit("/", 1)[-1] if path.startswith("@artifacts/") else path,
            )
        except OSError:
            raise HTTPException(404, "Workspace file unavailable") from None
        info = os.fstat(fd)
        if info.st_size > MAX_FILE:
            os.close(fd)
            raise HTTPException(413, "File exceeds the 20 MiB limit")
        # Hold the inode open through response completion, including Range.
        return OpenFileResponse(
            fd,
            stat_result=info,
            filename=path.rsplit("/", 1)[-1],
            media_type=mimetypes.guess_type(path)[0] or "application/octet-stream",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    return api
