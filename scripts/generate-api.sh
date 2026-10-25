#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv run --directory apps/server python -c 'import json; from orchmesh.main import app; from pathlib import Path; Path("../web/openapi.json").write_text(json.dumps(app.openapi(), indent=2) + "\n")'
npm --prefix apps/web run openapi-typescript -- openapi.json -o src/lib/api-schema.d.ts
npm --prefix apps/web run prettier -- --write src/lib/api-schema.d.ts
