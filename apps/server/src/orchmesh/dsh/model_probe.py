"""Use the pinned DSH adapter for capability resolution and bounded connection tests."""

import asyncio
import json
import os

from ..config import ModelProfile, Settings


async def probe_model(
    settings: Settings, profile: ModelProfile, *, test: bool = False
) -> dict:
    environment = dict(os.environ)
    if settings.http_proxy.get_secret_value():
        environment["HTTPS_PROXY"] = settings.http_proxy.get_secret_value()
        environment["HTTP_PROXY"] = settings.http_proxy.get_secret_value()
    environment["NO_PROXY"] = settings.no_proxy
    process = await asyncio.create_subprocess_exec(
        "node",
        str(settings.runtime_dir / "model-probe.mjs"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=environment,
    )
    payload = json.dumps(
        {
            "key": profile.api_key.get_secret_value(),
            "model": profile.snapshot("default"),
            "test": test,
        }
    ).encode()
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(payload), timeout=25)
        result = json.loads(stdout)
        if process.returncode or not result.get("ok"):
            raise ValueError(
                "DSH 无法解析模型或连接失败，请检查模型 ID、协议、地址和密钥。"
            )
        return result
    except (TimeoutError, json.JSONDecodeError):
        raise ValueError("模型检测超时或未返回有效结果，请检查网络和配置。") from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
