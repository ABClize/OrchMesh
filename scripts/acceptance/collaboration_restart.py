"""Opt-in real-model recovery acceptance. Run only against an idle local API."""

import asyncio
import json
import os
import signal
import subprocess
import uuid
from pathlib import Path

import httpx
from sqlalchemy import select

from orchmesh.config import ROOT, Settings
from orchmesh.storage import Database, Task


async def main():
    s = Settings()
    db = Database(s)
    async with httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{s.port}", timeout=60
    ) as c:
        r = await c.post(
            "/api/login/access-token",
            data={
                "username": s.bootstrap_admin_email,
                "password": s.bootstrap_admin_password.get_secret_value(),
            },
        )
        r.raise_for_status()
        c.headers["Authorization"] = "Bearer " + r.json()["access_token"]
        d = {
            "name": "验收助手：委派恢复",
            "description": "仅验收跨任务恢复",
            "instructions": (
                "Follow the requested task, inspect existing files before "
                "repeating operations. Do not delegate."
            ),
            "tools": ["execution"],
            "knowledge_ids": [],
        }
        r = await c.post("/api/agents", json=d)
        r.raise_for_status()
        aid = r.json()["id"]

        async def admit(agent, prompt, title):
            cid = (await c.post("/api/conversations", json={"agent_id": agent})).json()[
                "id"
            ]
            await c.patch(f"/api/conversations/{cid}", json={"title": title})
            r = await c.post(
                f"/api/conversations/{cid}/runs",
                json={"text": prompt, "request_id": str(uuid.uuid4())},
            )
            r.raise_for_status()
            return cid, r.json()["id"]

        cid, tid = await admit(
            "draft:" + aid, "只回复READY，不用工具。", "迁移验收：协作恢复草稿试运行"
        )
        for _ in range(120):
            await asyncio.sleep(1)
            v = (await c.get(f"/api/conversations/{cid}")).json()
            if v["status"] != "running":
                break
        assert v["status"] == "completed"
        r = await c.post(f"/api/agents/{aid}/publish", json={"confirm": True})
        r.raise_for_status()
        childprompt = (
            "申请执行环境。用 bash 运行：如果 effect.txt 不存在就写一行 ONCE，"
            "然后 sleep 20，最后写 A2A_RECOVERED 到 report.txt。"
            "如果任务中断先查看 effect.txt，不能追加第二行。用 present 交付这两个文件。"
        )
        cid, root = await admit(
            None,
            (
                f"用 delegate_task 调用智能体 {aid}，work_key 必须为 restart-child，"
                f"任务逐字传入：{childprompt}。等它完成再回复 A2A_RESTART_OK。"
                "你自己不执行命令。"
            ),
            "迁移验收：A2A父子任务重启恢复",
        )
        child = None
        for _ in range(180):
            async with db.sessions() as sess:
                children = (
                    await sess.scalars(select(Task).where(Task.parent_id == root))
                ).all()
            if children:
                child = children[0]
                work = s.data_dir / "tasks" / child.id / "work"
                if (work / "effect.txt").exists():
                    break
            await asyncio.sleep(0.5)
        else:
            raise RuntimeError("No child effect")
        async with db.sessions() as sess:
            active = (
                await sess.scalars(
                    select(Task).where(
                        Task.status.in_(["running", "waiting", "queued"])
                    )
                )
            ).all()
            assert all(t.root_id == root for t in active)
        candidates = []
        for path in Path("/proc").glob("[0-9]*/cmdline"):
            try:
                args = path.read_bytes().split(b"\0")
            except OSError:
                continue
            if (
                str(ROOT / "apps/server/.venv/bin/uvicorn").encode() in args
                and b"orchmesh.main:app" in args
            ):
                candidates.append(path.parent)
        assert len(candidates) == 1
        os.kill(int(candidates[0].name), signal.SIGKILL)
        await asyncio.sleep(1)
        with open(s.data_dir / "acceptance-service.log", "ab") as log:
            proc = subprocess.Popen(
                [
                    str(ROOT / "apps/server/.venv/bin/uvicorn"),
                    "orchmesh.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(s.port),
                ],
                cwd=str(ROOT / "apps/server"),
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
        for _ in range(240):
            await asyncio.sleep(1)
            try:
                r = await c.get(f"/api/conversations/{cid}")
                r.raise_for_status()
            except httpx.TransportError:
                continue
            v = r.json()
            if v["status"] != "running":
                break
        assert v["status"] == "completed", v["status"]
        final = v["messages"][-1]
        assert final["role"] == "assistant"
        assert "A2A_RESTART_OK" in "".join(p.get("text", "") for p in final["content"])
        async with db.sessions() as sess:
            children = (
                await sess.scalars(
                    select(Task).where(
                        Task.root_id == root, Task.parent_id.is_not(None)
                    )
                )
            ).all()
        assert (
            len(children) == 1
            and children[0].id == child.id
            and children[0].status == "completed"
        )
        assert (work / "effect.txt").read_text().splitlines() == ["ONCE"]
        result = {
            "root_recovered": True,
            "same_child": True,
            "effect_count": 1,
            "root": root,
            "child": child.id,
            "conversation": cid,
            "server_pid": proc.pid,
        }
        (s.data_dir / "acceptance-collaboration-restart.json").write_text(
            json.dumps(result)
        )
        print(json.dumps(result))
    await db.engine.dispose()


if __name__ == "__main__":
    import sys

    if "--allow-restart" not in sys.argv:
        raise SystemExit(
            "Requires --allow-restart: creates real-model test data "
            "and restarts the local API"
        )
    asyncio.run(main())
