"""JWT/password primitives following FastAPI's official full-stack template."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pwdlib.hashers.bcrypt import BcryptHasher

ALGORITHM = "HS256"
password_hash = PasswordHash((Argon2Hasher(), BcryptHasher()))


def create_access_token(subject: uuid.UUID, secret: str, minutes: int) -> str:
    return jwt.encode(
        {"sub": str(subject), "exp": datetime.now(UTC) + timedelta(minutes=minutes)},
        secret,
        algorithm=ALGORITHM,
    )


def decode_subject(token: str, secret: str) -> uuid.UUID:
    payload = jwt.decode(
        token, secret, algorithms=[ALGORITHM], options={"require": ["sub", "exp"]}
    )
    return uuid.UUID(payload["sub"])
