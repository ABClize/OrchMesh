import uuid
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .storage import Project


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
