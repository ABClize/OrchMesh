import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Auth
from .config import Settings
from .storage import Database, Project, User


def workspace_path(
    settings: Settings, user_id: uuid.UUID, project_id: uuid.UUID | None = None
) -> Path:
    root = settings.data_dir / "users" / str(user_id)
    return root / "projects" / str(project_id) / "work" if project_id else root / "work"


async def owned_project(
    session: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID
):
    project = await session.scalar(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    if project is None:
        raise HTTPException(404, "Project not found")
    return project


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"\S")


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80, pattern=r"\S")


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    created_at: str


def router(settings: Settings, auth: Auth, db: Database, navigation):
    api = APIRouter(prefix="/api/projects", tags=["projects"])

    @api.get("", response_model=list[ProjectRead])
    async def listing(
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        return (await navigation.snapshot(user.id))["projects"]

    @api.post("", response_model=ProjectRead, status_code=201)
    async def create(
        body: ProjectCreate,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        project = Project(id=uuid.uuid4(), user_id=user.id)
        workspace_path(settings, user.id, project.id).mkdir(parents=True, mode=0o700)
        async with navigation.transaction(user.id):
            result = await navigation.manager.control(
                user.id,
                "project/create",
                path=f"/workspaces/{project.id}",
                title=body.name.strip(),
            )
            project.native_id = result["workspace"]["workspaceId"]
            session.add(project)
            await session.commit()
        return {
            "id": project.id,
            "name": result["workspace"]["title"],
            "created_at": project.created_at,
        }

    @api.patch("/{project_id}", response_model=ProjectRead)
    async def update(
        project_id: uuid.UUID,
        body: ProjectUpdate,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        project = await owned_project(session, user.id, project_id)
        async with navigation.transaction(user.id):
            result = await navigation.manager.control(
                user.id,
                "project/rename",
                workspaceId=project.native_id,
                title=body.name.strip(),
            )
        return {
            "id": project.id,
            "name": result["workspace"]["title"],
            "created_at": project.created_at,
        }

    @api.delete("/{project_id}")
    async def remove(
        project_id: uuid.UUID,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ) -> dict[str, bool]:
        project = await owned_project(session, user.id, project_id)
        async with navigation.transaction(user.id):
            await navigation.manager.control(
                user.id, "project/delete", workspaceId=project.native_id
            )
        # Retain the directory ownership row: existing sessions and files still use it.
        return {"deleted": True}

    return api
