#!/usr/bin/env bash
# Container start script. Runs as root and starts two things:
#
#   gateway  (user "broker")  holds every secret, serves the public port
#   ttyd     (user "dev")     the web terminal where you run Claude Code
#
# Railway puts ALL service variables (your API keys too) into this script's
# environment. The dev user gets a brand-new environment instead, built from
# an allowlist below, so no secret is ever passed to it.
set -euo pipefail

DEV_USER=dev
DEV_HOME=/home/dev
export PORT="${PORT:-8080}"
export GATEWAY_LOCAL_PORT="${GATEWAY_LOCAL_PORT:-8787}"
export TTYD_PORT="${TTYD_PORT:-7681}"
GATEWAY_URL="http://127.0.0.1:${GATEWAY_LOCAL_PORT}"

log() { echo "[entrypoint] $*"; }

# --- Preflight: the secret split only works if we can switch Linux users ----
if [[ "$(id -u)" != 0 ]]; then
  log "ERROR: this container must start as root so it can keep your secrets away from the terminal."
  log "       Remove RAILWAY_RUN_UID (or any setting that runs the container as another user)."
  exit 1
fi
if ! setpriv --reuid="$DEV_USER" --regid="$DEV_USER" --init-groups -- true 2>/dev/null \
   || ! setpriv --reuid=broker --regid=broker --init-groups -- true 2>/dev/null; then
  log "ERROR: cannot switch to the dev/broker users (the platform blocks setuid?). Not starting,"
  log "       because the terminal would otherwise see your secrets."
  exit 1
fi

# --- Terminal password -------------------------------------------------------
if [[ -z "${TERMINAL_PASSWORD:-}" ]]; then
  TERMINAL_PASSWORD="$(node -e 'process.stdout.write(require("crypto").randomBytes(18).toString("base64url"))')"
  export TERMINAL_PASSWORD
  log "WARNING: TERMINAL_PASSWORD is not set."
  log "         Temporary password for this start only: ${TERMINAL_PASSWORD}"
  log "         Set TERMINAL_PASSWORD in your Railway variables to keep a fixed one."
elif (( ${#TERMINAL_PASSWORD} < 16 )); then
  log "WARNING: TERMINAL_PASSWORD is short. Use 16+ random characters; this box can push to your GitHub."
fi

# --- Home directory (a Railway volume should be mounted here) ----------------
mkdir -p "$DEV_HOME"
if [[ ! -e "$DEV_HOME/.devenv-initialized" ]]; then
  log "First start: setting up $DEV_HOME"
  cp -a --update=none /etc/skel/. "$DEV_HOME/"
  mkdir -p "$DEV_HOME/projects" "$DEV_HOME/.npm-global"
  chown -R "$DEV_USER:$DEV_USER" "$DEV_HOME"
  touch "$DEV_HOME/.devenv-initialized"
fi
chown "$DEV_USER:$DEV_USER" "$DEV_HOME"
chmod 750 "$DEV_HOME"
if ! mountpoint -q "$DEV_HOME"; then
  log "NOTE: no volume mounted at $DEV_HOME, so files are lost on every redeploy."
fi

# --- Git: send GitHub traffic through the gateway, which adds the token -------
# Written to the system config (root-owned), so it can't be changed by accident.
rm -f /etc/gitconfig
git config --system url."${GATEWAY_URL}/github/".insteadOf "https://github.com/"
git config --system --add url."${GATEWAY_URL}/github/".insteadOf "git@github.com:"
git config --system --add url."${GATEWAY_URL}/github/".insteadOf "ssh://git@github.com/"
git config --system init.defaultBranch main
git config --system push.autoSetupRemote true
if [[ -n "${GIT_USER_NAME:-}" ]]; then git config --system user.name "$GIT_USER_NAME"; fi
if [[ -n "${GIT_USER_EMAIL:-}" ]]; then git config --system user.email "$GIT_USER_EMAIL"; fi

# --- Environment for the dev user (allowlist, no secrets) --------------------
dev_env=(
  "HOME=$DEV_HOME"
  "USER=$DEV_USER"
  "LOGNAME=$DEV_USER"
  "SHELL=/bin/bash"
  "PATH=$DEV_HOME/.local/bin:$DEV_HOME/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  "LANG=C.UTF-8"
  "TERM=xterm-256color"
  "COLORTERM=truecolor"
  "NPM_CONFIG_PREFIX=$DEV_HOME/.npm-global"
  "GATEWAY_URL=$GATEWAY_URL"
)
if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  # Claude Code talks to the gateway. The token below is a dummy value;
  # the gateway replaces it with the real key on the way out.
  dev_env+=(
    "ANTHROPIC_BASE_URL=$GATEWAY_URL/anthropic"
    "ANTHROPIC_AUTH_TOKEN=managed-by-gateway"
    "ANTHROPIC_API_KEY=managed-by-gateway"
    "DEV_PROJECTS_DIR=$DEV_HOME/projects"
    "APP_PORT=$TTYD_PORT"
  )
else
  log "NOTE: neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set; Claude SDK will ask you to configure credentials."
fi
# Non-secret settings you want inside the terminal: add them in Railway with a
# DEVENV_ prefix. DEVENV_NODE_ENV=development becomes NODE_ENV=development.
for name in $(compgen -e); do
  if [[ "$name" == DEVENV_?* ]]; then
    dev_env+=("${name#DEVENV_}=${!name}")
  fi
done

# --- Start ------------------------------------------------------------------
pids=()
# shellcheck disable=SC2329 # called by the trap below
shutdown() {
  log "Stopping..."
  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait || true
  exit 0
}
trap shutdown TERM INT

setpriv --reuid=broker --regid=broker --init-groups -- node /opt/gateway/server.js &
pids+=($!)

cd "$DEV_HOME"
env -i "${dev_env[@]}" setpriv --reuid="$DEV_USER" --regid="$DEV_USER" --init-groups -- \
  node /opt/app/server.js &
pids+=($!)

log "Ready. Open your Railway URL and log in as \"${TERMINAL_USERNAME:-dev}\"."

# If either process dies, exit so Railway restarts the container.
wait -n || true
log "A process exited unexpectedly; exiting so Railway restarts the container."
kill -TERM "${pids[@]}" 2>/dev/null || true
exit 1
