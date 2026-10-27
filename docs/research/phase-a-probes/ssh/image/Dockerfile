FROM orchmesh-dsh:0.2.1-rc.3
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server procps bubblewrap && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd /home/node/.ssh /workspace && chown -R node:node /home/node /workspace && passwd -d node
COPY sshd_config /etc/ssh/sshd_config
ENTRYPOINT ["/usr/sbin/sshd", "-D", "-e"]
