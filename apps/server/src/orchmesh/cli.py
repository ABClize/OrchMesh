import argparse
import asyncio
import getpass
import os
import subprocess

from .accounts import UserCreate, create_account
from .config import Settings
from .storage import Database


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
            print(f"Created {user.email}; User ID: {user.id}")
    finally:
        await db.engine.dispose()


def setup():
    """Prepare dependencies elsewhere; generate local DB credentials once."""
    import secrets

    from .config import ROOT

    path = ROOT / ".env"
    if not path.exists():
        path.write_text((ROOT / ".env.example").read_text())
        path.chmod(0o600)
    content = path.read_text()
    lines = content.splitlines()
    if not any(
        line.startswith("ORCHMESH_DB_PASSWORD=") and line.partition("=")[2]
        for line in lines
    ):
        lines = [line for line in lines if not line.startswith("ORCHMESH_DB_PASSWORD=")]
        lines.append("ORCHMESH_DB_PASSWORD=" + secrets.token_urlsafe(32))
        path.write_text("\n".join(lines) + "\n")
        path.chmod(0o600)
    subprocess.run(
        ["docker", "compose", "up", "-d", "--wait", "db"], cwd=ROOT, check=True
    )


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="OrchMesh local administration")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    sub.add_parser("dev")
    sub.add_parser("build-image")
    create = sub.add_parser("create-user")
    create.add_argument("email")
    sub.add_parser("setup")
    sub.add_parser("import-legacy")
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
                "deploy/sandbox.Dockerfile",
                "-t",
                Settings().dsh_image,
                ".",
            ],
            cwd=ROOT,
            check=True,
        )
    elif args.command == "create-user":
        asyncio.run(create_user(args.email))
    elif args.command == "setup":
        setup()
    elif args.command == "import-legacy":
        from .import_legacy import migrate

        print(asyncio.run(migrate(Settings())))
