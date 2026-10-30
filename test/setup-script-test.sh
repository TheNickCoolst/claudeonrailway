#!/usr/bin/env bash
# Checks are single-quoted on purpose (check() evals them); `a && pass || fail` is intended.
# shellcheck disable=SC2016,SC2034,SC2015
# Tests scripts/setup-railway.sh against a fake Railway CLI (test/fake-railway) and a
# fake GitHub/Anthropic API, so no accounts or network are needed.
# Usage: test/setup-script-test.sh      (needs bash, node, python3, curl)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
WORK="$(mktemp -d)"
FAILED=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILED=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# Fake GitHub + Anthropic API + the deployed app's /healthz.
PORT=$((20000 + RANDOM % 20000))
node -e '
require("http").createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/healthz") return send(200, "ok");
  if (req.url === "/user") return req.headers.authorization === "Bearer ghp_TESTSECRET" ? send(200, { login: "tester" }) : send(401, {});
  if (req.url === "/v1/models") return req.headers["x-api-key"] === "sk-ant-api03-TESTSECRET" ? send(200, { data: [] }) : send(401, {});
  send(404, {});
}).listen(Number(process.argv[1]), "127.0.0.1");
' "$PORT" &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.1; done

# A fake `claude` that "creates" a subscription token.
mkdir -p "$WORK/bin"
printf '#!/bin/sh\necho "Your OAuth token: sk-ant-oat01-PTYSECRET"\n' >"$WORK/bin/claude"
chmod +x "$WORK/bin/claude"

run_setup() { # STATE_DIR [env assignments...] -- [script args]
  local state=$1; shift
  (cd "$WORK" && env -u GITHUB_TOKEN -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN -u TERMINAL_PASSWORD \
    -u GIT_USER_NAME -u GIT_USER_EMAIL \
    RAILWAY_BIN="$ROOT/test/fake-railway" FAKE_STATE="$state" FAKE_URL="http://127.0.0.1:$PORT" \
    SETUP_GITHUB_API="http://127.0.0.1:$PORT" SETUP_ANTHROPIC_API="http://127.0.0.1:$PORT" \
    SETUP_REPO=octo/demo SETUP_BRANCH=main SETUP_WAIT_SECONDS=20 PATH="$WORK/bin:$PATH" \
    "$@")
}
var() { cat "$1/vars/$2" 2>/dev/null || true; }

echo "== 1. First setup, non-interactive, subscription token with stray spaces"
S1="$WORK/state1"
out1="$(run_setup "$S1" CLAUDE_CODE_OAUTH_TOKEN=$'  sk-ant-oat01-TESTSECRET \n' GITHUB_TOKEN=ghp_TESTSECRET \
  GIT_USER_NAME="Test User" GIT_USER_EMAIL=test@example.com "$ROOT/scripts/setup-railway.sh" --yes 2>&1)" \
  && pass "script finished" || { fail "script finished"; echo "$out1"; }
check "project created"                 '[ "$(cat "$S1/linked")" = claude-dev ]'
check "service created"                 '[ -e "$S1/service_claude-code" ]'
check "subscription token saved, trimmed" '[ "$(var "$S1" CLAUDE_CODE_OAUTH_TOKEN)" = sk-ant-oat01-TESTSECRET ]'
check "GitHub token saved"              '[ "$(var "$S1" GITHUB_TOKEN)" = ghp_TESTSECRET ]'
check "random 32-char password saved"   '[[ "$(var "$S1" TERMINAL_PASSWORD)" =~ ^[A-Za-z0-9]{32}$ ]]'
check "git author saved"                '[ "$(var "$S1" GIT_USER_NAME)" = "Test User" ] && [ "$(var "$S1" GIT_USER_EMAIL)" = test@example.com ]'
check "volume at /home/dev"             '[ "$(cat "$S1/volume")" = /home/dev ]'
check "domain on port 8080"             '[ "$(cat "$S1/domain_port")" = port=8080 ]'
check "repo and branch connected"       '[ "$(cat "$S1/source")" = octo/demo@main ]'
check "exactly one deploy triggered"    '[ "$(wc -l <"$S1/deploys")" -eq 1 ]'
check "waited until /healthz was up"    '[[ "$out1" == *"it'"'"'s up"* ]]'
check "password shown at the end"       '[[ "$out1" == *"Password:  $(var "$S1" TERMINAL_PASSWORD)"* ]]'
check "no secret on any command line"   '! grep -q SECRET "$S1/argv.log"'
check "no secret printed"               '[[ "$out1" != *SECRET* ]]'

echo "== 2. Second run: switch to an API key, keep everything else"
pw_before="$(var "$S1" TERMINAL_PASSWORD)"
out2="$(run_setup "$S1" ANTHROPIC_API_KEY=sk-ant-api03-TESTSECRET "$ROOT/scripts/setup-railway.sh" --yes 2>&1)" \
  && pass "script finished" || { fail "script finished"; echo "$out2"; }
check "project not created again"       '[ "$(grep -c "^init" "$S1/argv.log")" -eq 1 ]'
check "service reused"                  '[ "$(grep -c "^add" "$S1/argv.log")" -eq 1 ] && [[ "$out2" == *"using existing service"* ]]'
check "API key checked and saved"       '[[ "$out2" == *"API key works"* ]] && [ "$(var "$S1" ANTHROPIC_API_KEY)" = sk-ant-api03-TESTSECRET ]'
check "old subscription token removed"  '[ ! -e "$S1/vars/CLAUDE_CODE_OAUTH_TOKEN" ]'
check "password kept"                   '[ "$(var "$S1" TERMINAL_PASSWORD)" = "$pw_before" ] && [[ "$out2" == *"Password:  unchanged"* ]]'
check "GitHub token kept"               '[ "$(var "$S1" GITHUB_TOKEN)" = ghp_TESTSECRET ]'
check "existing volume accepted"        '[[ "$out2" == *"volume already exists"* ]]'
check "existing domain reused"          '[[ "$out2" == *"http://127.0.0.1:$PORT"* ]]'
check "no secret on any command line"   '! grep -q SECRET "$S1/argv.log"'

echo "== 3. Wrong GitHub token: stops before saving anything"
S3="$WORK/state3"
if out3="$(run_setup "$S3" CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-TESTSECRET GITHUB_TOKEN=ghp_WRONG \
  "$ROOT/scripts/setup-railway.sh" --yes 2>&1)"; then fail "script stopped"; else pass "script stopped"; fi
check "explains the problem"            '[[ "$out3" == *"GitHub did not accept this token"* ]]'
check "no variables saved"              '[ -z "$(ls -A "$S3/vars" 2>/dev/null)" ]'

echo "== 4. Interactive run (typed answers in a terminal)"
S4="$WORK/state4"
out4="$(run_setup "$S4" python3 -I - "$ROOT/scripts/setup-railway.sh" <<'PY' 2>&1
import os, pty, select, sys, time
answers = [  # (prompt text to wait for, what to type)
    ("owner/repo) [octo/demo]", ""),
    ("Branch to deploy [main]", ""),
    ("Railway project name [claude-dev]", ""),
    ("Railway service name [claude-code]", "my-box"),
    ("Choose [1]", "1"),
    ("Run `claude setup-token` now?", "y"),
    ("Paste the subscription token (hidden)", "  sk-ant-oat01-PTYSECRET  "),
    ("Paste the GitHub token (hidden, empty = skip)", "ghp_TESTSECRET"),
    ("Name [", "Pty User"),
    ("Email [", "pty@example.com"),
    ("Apply now? [Y/n]", ""),
]
pid, fd = pty.fork()
if pid == 0:
    os.execv("/bin/bash", ["bash", sys.argv[1]])
buf = b""   # output not yet matched against a prompt
full = b""  # complete transcript
def read_until(text, timeout=30):
    global buf, full
    end = time.time() + timeout
    while text.encode() not in buf:
        if time.time() > end:
            sys.stdout.write(full.decode(errors="replace")); sys.exit(f"timeout waiting for: {text}")
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: data = os.read(fd, 4096)
            except OSError: break
            buf += data; full += data
    buf = buf.split(text.encode(), 1)[1]
for prompt, answer in answers:
    read_until(prompt)
    time.sleep(0.05)
    os.write(fd, (answer + "\n").encode())
while True:
    try:
        data = os.read(fd, 4096)
    except OSError:
        break
    if not data: break
    full += data
_, status = os.waitpid(pid, 0)
sys.stdout.write(full.decode(errors="replace"))
sys.exit(os.waitstatus_to_exitcode(status))
PY
)" && pass "script finished" || { fail "script finished"; echo "$out4"; }
check "custom service name used"        '[ -e "$S4/service_my-box" ]'
check "token from setup-token saved"    '[ "$(var "$S4" CLAUDE_CODE_OAUTH_TOKEN)" = sk-ant-oat01-PTYSECRET ]'
check "GitHub token checked and saved"  '[[ "$out4" == *"@tester"* ]] && [ "$(var "$S4" GITHUB_TOKEN)" = ghp_TESTSECRET ]'
check "typed git author saved"          '[ "$(var "$S4" GIT_USER_NAME)" = "Pty User" ]'
check "pasted tokens not echoed"        '[[ "$out4" != *"ghp_TESTSECRET"* ]]'
check "deploy started and up"           '[ -e "$S4/deployed" ] && [[ "$out4" == *"it'"'"'s up"* ]]'

if ((FAILED)); then echo "Some checks failed."; exit 1; fi
echo "All setup script checks passed."
