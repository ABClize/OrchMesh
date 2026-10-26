FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash git ca-certificates ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/orchmesh
COPY apps/runtime/package.json apps/runtime/package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY apps/runtime/bridge.mjs apps/runtime/launch.mjs ./
ENV DSH_HOME=/state/dsh HOME=/tmp NARB_DISABLE_NATIVE_CACHE=1
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/orchmesh/launch.mjs"]
