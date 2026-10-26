import argparse
import asyncio
import getpass
import os
import subprocess

from sqlalchemy import select

from .accounts import UserCreate, create_account
from .config import Settings
from .dsh.containers import Containers
from .storage import Database, User


async def create_user(email: str):
    settings = Settings()
    settings.secret()
    db = Database(settings)
    password = getpass.getpass("Password (12+ characters): ")
    if password != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords do not match")
    try:
        async with db.sessions() as session:
            user = await create_account(
                session, UserCreate(email=email, password=password)
            )
            root = Containers(settings).prepare(user.id)
            print(
                f"Created {user.email}\nUser ID: {user.id}\n"
                f"Model config: {root / 'config'}"
            )
    finally:
        await db.engine.dispose()


async def configure_model(email: str, base_url: str, model: str, api: str):
    from pydantic import SecretStr

    from .dsh.configuration import sync_model, validate_model

    settings = Settings().model_copy(
        update={
            "model_base_url": base_url,
            "model_id": model,
            "model_api": api,
            "model_api_key": SecretStr(getpass.getpass("Model API key: ")),
        }
    )
    validate_model(settings)
    db = Database(settings)
    try:
        async with db.sessions() as session:
            user = await session.scalar(select(User).where(User.email == email))
            if user is None:
                raise SystemExit("User not found")
            sync_model(settings, user.id)
            print("Model configured for this user; effective on the next run.")
    finally:
        await db.engine.dispose()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="OrchMesh local administration")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    sub.add_parser("dev")
    sub.add_parser("build-image")
    create = sub.add_parser("create-user")
    create.add_argument("email")
    config = sub.add_parser("configure-model")
    config.add_argument("email")
    config.add_argument("--base-url", required=True)
    config.add_argument("--model", required=True)
    config.add_argument("--api", default="openai-completions")
    args = parser.parse_args()
    if args.command in ("run", "dev"):
        from .serve import serve

        serve(dev=args.command == "dev")
    elif args.command == "build-image":
        from .config import ROOT

        subprocess.run(
            [
                "docker",
                "build",
                "-f",
                "deploy/dsh.Dockerfile",
                "-t",
                Settings().dsh_image,
                ".",
            ],
            cwd=ROOT,
            check=True,
        )
    elif args.command == "create-user":
        asyncio.run(create_user(args.email))
    else:
        asyncio.run(configure_model(args.email, args.base_url, args.model, args.api))
