#!/usr/bin/env bash
# Local smoke test. Builds the image, starts it with FAKE secrets and a fake
# upstream API, then checks that:
#   - the login works and the WebSocket is protected
#   - inside the terminal, Claude Code and git work through the gateway
#   - the dev user cannot see any secret
#   - the upstream receives the real secrets (added by the gateway)
#
# Needs: docker, node. Optional: playwright (for the browser part).
# Usage: test/smoke-test.sh          (SKIP_BUILD=1 to reuse an existing image)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-claude-railway:test}"
NAME=claude-railway-smoke
HOST_PORT="${HOST_PORT:-18080}"
BASE="http://127.0.0.1:${HOST_PORT}"
# Every fake secret contains "SECRET" so the checks can grep for leaks.
PASSWORD="smoke-SECRET-password-123456"

if [[ "${SKIP_BUILD:-}" != 1 ]]; then docker build -t "$IMAGE" .; fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -p "${HOST_PORT}:8080" \
  -e PORT=8080 \
  -e TERMINAL_PASSWORD="$PASSWORD" \
  -e ANTHROPIC_API_KEY=sk-ant-SECRET-api-key \
  -e ANTHROPIC_UPSTREAM=http://127.0.0.1:9999/anthropic-up \
  -e GITHUB_TOKEN=ghp_SECRET_github_token \
  -e GITHUB_UPSTREAM=http://127.0.0.1:9999/gh \
  -e GITHUB_API_UPSTREAM=http://127.0.0.1:9999/ghapi \
  -e CUSTOM_KEY=custom-SECRET-key \
  -e 'PROXY_ROUTES={"custom":{"target":"http://127.0.0.1:9999/custom-up","headers":{"X-Custom-Key":"${CUSTOM_KEY}"}}}' \
  -e GIT_USER_NAME="Smoke Test" \
  -e GIT_USER_EMAIL=smoke@example.com \
  -e DEVENV_MY_SETTING=hello \
  -e DEVENV_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  "$IMAGE" >/dev/null

docker cp test/mock-upstream.js "$NAME:/root/mock-upstream.js"
# A bare repo "octo/demo" for the fake GitHub, with one commit.
docker exec "$NAME" bash -c '
  set -e
  git init -q --bare -b main /root/git-repos/octo/demo
  git -C /root/git-repos/octo/demo config http.receivepack true
  tmp=$(mktemp -d) && cd "$tmp" && git init -q -b main
  echo hello > README.md && git add README.md
  git -c user.name=seed -c user.email=seed@example.com commit -qm init
  git push -q /root/git-repos/octo/demo main'
docker exec -d "$NAME" node /root/mock-upstream.js
docker cp test/dev-checks.sh "$NAME:/srv/dev-checks.sh"
docker exec "$NAME" chmod 755 /srv/dev-checks.sh

echo "Waiting for the container..."
for _ in $(seq 1 30); do
  curl -sf "$BASE/healthz" >/dev/null && break
  sleep 1
done

echo "== Login and WebSocket"
node test/ws-check.js "$BASE" dev "$PASSWORD"

echo "== Inside the terminal (as dev)"
if node -e 'require("playwright")' 2>/dev/null; then
  node test/browser-test.js "$BASE" dev "$PASSWORD" "$NAME" \
    "bash /srv/dev-checks.sh > /tmp/dev-checks.out 2>&1" /tmp/dev-checks.out "${SCREENSHOT:-}" || true
else
  echo "(playwright not installed: attaching to the terminal with tmux instead)"
  node test/open-session.js "$BASE" dev "$PASSWORD" 3 # starts the tmux session
  docker exec -u dev "$NAME" tmux send-keys -t main "bash /srv/dev-checks.sh > /tmp/dev-checks.out 2>&1" Enter
  for _ in $(seq 1 120); do
    docker exec "$NAME" grep -q DONE /tmp/dev-checks.out 2>/dev/null && break
    sleep 1
  done
fi
docker exec "$NAME" cat /tmp/dev-checks.out

echo "== What the upstream received (should be the real secrets)"
docker exec "$NAME" grep -q "About this machine" /root/mock-requests.jsonl.anthropic-bodies \
  && echo "PASS Claude Code loaded /etc/claude-code/CLAUDE.md" || { echo "FAIL Claude Code loaded /etc/claude-code/CLAUDE.md"; exit 1; }
docker exec "$NAME" git -C /root/git-repos/octo/demo log --oneline -1 main | grep -q "smoke test" \
  && echo "PASS pushed commit arrived in the repo" || { echo "FAIL pushed commit arrived in the repo"; exit 1; }
docker exec "$NAME" node -e '
const lines = require("fs").readFileSync("/root/mock-requests.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const b64 = (s) => Buffer.from(s.replace(/^Basic /, ""), "base64").toString();
let failed = false;
const check = (ok, name) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) failed = true; };
const anth = lines.filter((l) => l.path.startsWith("/anthropic-up/"));
check(anth.length > 0 && anth.every((l) => l["x-api-key"] === "sk-ant-SECRET-api-key" && !l.authorization),
  `Claude API got the real API key and no placeholder (${anth.length} requests)`);
const gh = lines.filter((l) => l.path.startsWith("/gh/"));
check(gh.length > 0 && gh.every((l) => b64(l.authorization || "") === "x-access-token:ghp_SECRET_github_token"),
  `git requests got the GitHub token (${gh.length} requests)`);
const api = lines.filter((l) => l.path.startsWith("/ghapi/"));
check(api.length > 0 && api.every((l) => l.authorization === "Bearer ghp_SECRET_github_token"), "GitHub API got the token");
const custom = lines.filter((l) => l.path.startsWith("/custom-up/"));
check(custom.length > 0 && custom.every((l) => l["x-custom-key"] === "custom-SECRET-key"), "custom route got its key");
check(lines.every((l) => l.host === "127.0.0.1:9999"), "no request was sent to another host");
check(!JSON.stringify(lines).includes("managed-by-gateway"), "placeholder never reached the upstream");
process.exit(failed ? 1 : 0);
'

if docker exec "$NAME" grep -q '^FAIL' /tmp/dev-checks.out || ! docker exec "$NAME" grep -q DONE /tmp/dev-checks.out; then
  echo "Some checks inside the terminal failed."
  exit 1
fi
echo "All checks passed."
