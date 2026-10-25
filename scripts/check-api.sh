#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
ORCHMESH_DATA_DIR="$scratch/data" uv run --directory apps/server python -c 'import json,sys; from orchmesh.main import app; from pathlib import Path; Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=2) + "\n")' "$scratch/openapi.json"
npm --prefix apps/web run openapi-typescript -- "$scratch/openapi.json" -o "$scratch/api-schema.d.ts"
npm --prefix apps/web run prettier -- --write "$scratch/api-schema.d.ts"
diff -u apps/web/openapi.json "$scratch/openapi.json"
diff -u apps/web/src/lib/api-schema.d.ts "$scratch/api-schema.d.ts"
