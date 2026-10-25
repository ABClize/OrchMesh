FROM node:24-bookworm-slim
ARG PI_VERSION=1.4.0
RUN apt-get update && apt-get install -y --no-install-recommends bash git ca-certificates ripgrep python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION} \
    && npm cache clean --force
ENV PI_CODING_AGENT_DIR=/state/config HOME=/tmp
WORKDIR /workspace
ENTRYPOINT ["pi"]
