import argparse
import asyncio
import fcntl
import getpass
import json
import os
import subprocess
import uuid

from sqlalchemy import select

from .accounts import UserCreate, create_account
from .config import Settings
from .pi.containers import Containers
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
                f"Pi config: {root / 'config'}"
            )
    finally:
        await db.engine.dispose()


async def configure_pi(email: str, provider: str, model: str):
    settings = Settings()
    db = Database(settings)
    try:
        async with db.sessions() as session:
            user = await session.scalar(
                select(User).where(User.__table__.c.email == email)
            )
            if user is None:
                raise SystemExit("User not found")
            root = Containers(settings).prepare(user.id) / "config"
            path = root / "settings.json"
            config = json.loads(path.read_text()) if path.exists() else {}
            config.update(defaultProvider=provider, defaultModel=model)
            path.write_text(json.dumps(config, indent=2) + "\n")
            path.chmod(0o600)
            print(
                "Configured provider/model. Put this user's Pi auth.json "
                f"or models.json in {root}"
            )
            print("No credentials were copied or changed.")
    finally:
        await db.engine.dispose()


async def pi_login(email: str):
    """Launch the official Pi TUI with only this project's user configuration."""
    settings = Settings()
    db = Database(settings)
    try:
        async with db.sessions() as session:
            user = await session.scalar(
                select(User).where(User.__table__.c.email == email)
            )
            if user is None:
                raise SystemExit("User not found")
            containers = Containers(settings)
            # Same runtime name: Docker refuses if this user's Pi is already active.
            command = containers.command(user.id, uuid.uuid4())[:-4]
            command.insert(2, "--tty")
            print("Use Pi /login, /model (Ctrl+S saves default), then /exit.")
            with (settings.data_dir / "runtime.lock").open("a") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise SystemExit("Stop the API before opening Pi configuration.")
                await asyncio.to_thread(subprocess.run, command, check=True)
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
    config = sub.add_parser("configure-pi")
    config.add_argument("email")
    config.add_argument("--provider", required=True)
    config.add_argument("--model", required=True)
    login = sub.add_parser("pi-login")
    login.add_argument("email")
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
                "deploy/pi.Dockerfile",
                "-t",
                Settings().pi_image,
                ".",
            ],
            cwd=ROOT,
            check=True,
        )
    elif args.command == "create-user":
        asyncio.run(create_user(args.email))
    elif args.command == "configure-pi":
        asyncio.run(configure_pi(args.email, args.provider, args.model))
    else:
        asyncio.run(pi_login(args.email))
