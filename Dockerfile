# Claude Code dev environment for Railway.
# See README.md for how it works and how to deploy.

FROM node:24-bookworm-slim AS node

FROM ubuntu:24.04

# Claude Code version to bake in. It can still update itself afterwards
# (updates go into /home/dev, which lives on your Railway volume).
ARG CLAUDE_CODE_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git openssh-client gnupg \
      tmux ttyd tini \
      bash-completion less nano vim-tiny jq ripgrep fd-find tree file \
      unzip zip xz-utils procps lsof iproute2 dnsutils ncurses-term \
      build-essential python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/*

# Node.js + npm from the official Node image.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && if [ -e /usr/local/lib/node_modules/corepack ]; then \
      ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack; fi \
 && node --version && npm --version

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && claude --version

# Users:
#   broker - runs the gateway and is the only user that can see secrets
#   dev    - you and Claude Code (no sudo, no secrets)
RUN userdel -r ubuntu 2>/dev/null || true \
 && useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin broker \
 && useradd --create-home --uid 1000 --shell /bin/bash dev

COPY gateway/ /opt/gateway/
COPY rootfs/ /
RUN chmod 755 /usr/local/bin/entrypoint.sh \
 && chmod -R a+rX /opt/gateway /etc/claude-code /etc/profile.d/devenv.sh /etc/tmux.conf

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
