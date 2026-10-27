FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server python3 bash ca-certificates procps bubblewrap && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd /home/node/.ssh /workspace && chown -R node:node /home/node /workspace && passwd -d node
COPY deploy/sandbox-sshd_config /etc/ssh/sshd_config
ENTRYPOINT ["/usr/sbin/sshd", "-D", "-e"]
