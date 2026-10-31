#!/usr/bin/env bash
# Checks are single-quoted on purpose: check() evals them later.
# shellcheck disable=SC2016,SC2034
# Runs INSIDE the web terminal as the dev user (typed in by the smoke test).
# Prints PASS/FAIL lines. Secrets used by the smoke test all contain "SECRET".
set -u
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

check "running as dev"                     '[ "$(id -un)" = dev ]'
check "no secrets in environment"          '! env | grep -q SECRET'
check "no sudo"                            '! sudo -n true 2>/dev/null'
check "cannot read PID 1 environment"      '! cat /proc/1/environ >/dev/null 2>&1'
GW_PID=$(pgrep -f gateway/server.js | head -1)
check "cannot read gateway environment"    '[ -n "$GW_PID" ] && ! cat /proc/$GW_PID/environ >/dev/null 2>&1'
check "no secret in any readable /proc/*/environ" \
  '! cat /proc/[0-9]*/environ 2>/dev/null | tr "\0" "\n" | grep -q SECRET'
check "no secret in readable files"        '! grep -rqs SECRET /etc /opt /home/dev /tmp 2>/dev/null'
check "ANTHROPIC_BASE_URL points at gateway" '[ "$ANTHROPIC_BASE_URL" = "$GATEWAY_URL/anthropic" ]'
check "DEVENV_ prefix passthrough works"   '[ "${MY_SETTING:-}" = hello ]'
check "routes list works"                  'curl -sf "$GATEWAY_URL/_routes" | grep -q github-api'
check "git user from GIT_USER_NAME"        '[ "$(git config user.name)" = "Smoke Test" ]'
check "gateway only on loopback"           '! ss -ltn | grep -E ":(8787|7681)\b" | grep -vq "127.0.0.1"'
check "web studio answers on 7681"         'curl -sf http://127.0.0.1:7681/healthz | grep -q ok'
check "claude agent sdk loads"             'node -e "import(\"@anthropic-ai/claude-agent-sdk\").then(() => process.exit(0))" 2>/dev/null'

out=$(timeout 120 claude -p "say hi" 2>&1)
if [[ "$out" == *"Hello from the mock upstream"* ]]; then pass "claude -p answers through gateway"
else fail "claude -p answers through gateway"; echo "  claude output: $out"; fi

check "git clone from github.com"         'git clone -q https://github.com/octo/demo /tmp/demo'
check "remote URL stays github.com"        '[ "$(git -C /tmp/demo config remote.origin.url)" = https://github.com/octo/demo ]'
check "git push to github.com" \
  'cd /tmp/demo && echo change > file.txt && git add file.txt && git commit -qm "smoke test" && git push -q origin HEAD 2>/dev/null; rc=$?; cd ~; [ $rc = 0 ]'
check "github-api route answers"           'curl -sf "$GATEWAY_URL/github-api/user" | grep -q "\"ok\":true"'
check "custom route answers"               'curl -sf "$GATEWAY_URL/custom/v1/ping" | grep -q "\"ok\":true"'
check "non-git github path blocked"        '[ "$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL/github/settings/tokens")" = 403 ]'
check "dot-dot path blocked"               '[ "$(curl -s --path-as-is -o /dev/null -w "%{http_code}" "$GATEWAY_URL/github/../anthropic/v1/messages")" = 400 ]'
curl -s --path-as-is "$GATEWAY_URL/custom//evil.example/x" >/dev/null
echo "DONE"
