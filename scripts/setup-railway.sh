#!/usr/bin/env bash
# Sets up this dev environment on Railway, step by step:
#
#   login -> collect tokens -> project -> service -> variables -> volume
#         -> domain -> connect GitHub repo -> deploy -> wait until it's up
#
# Run it on your own computer, from a checkout of this repo:
#
#   scripts/setup-railway.sh
#
# Safe to run again later, for example to change a token: existing project,
# service, volume and domain are reused, and empty answers keep current values.
#
# Needs: the Railway CLI (npm i -g @railway/cli, or brew install railway),
# git and curl. Tokens are read without echoing and passed to Railway via
# stdin, so they never show up in your shell history or process list.
#
# Non-interactive use (e.g. CI): pass --yes, set RAILWAY_API_TOKEN, and set the
# values as environment variables:
#   SETUP_PROJECT, SETUP_SERVICE, SETUP_REPO, SETUP_BRANCH,
#   CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, GITHUB_TOKEN,
#   TERMINAL_PASSWORD (generated if missing), GIT_USER_NAME, GIT_USER_EMAIL,
#   SETUP_WORKSPACE (only if your Railway account has several workspaces),
#   SETUP_WAIT_SECONDS (how long to wait for the deploy, default 900, 0 = don't wait)
set -euo pipefail

RAILWAY="${RAILWAY_BIN:-railway}"
GITHUB_API="${SETUP_GITHUB_API:-https://api.github.com}"
ANTHROPIC_API="${SETUP_ANTHROPIC_API:-https://api.anthropic.com}"
MOUNT_PATH=/home/dev
APP_PORT=8080

INTERACTIVE=true
if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]]; then INTERACTIVE=false; fi
if [[ ! -t 0 ]]; then INTERACTIVE=false; fi

# --- Output helpers ------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' DIM=$'\033[2m' RESET=$'\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' DIM='' RESET=''
fi
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s[%d] %s%s\n' "$BOLD" "$STEP" "$*" "$RESET"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '\n%sError:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

# ask VAR "Question" "default"  (keeps the default in non-interactive mode)
ask() {
  local __var=$1 __question=$2 __default=${3:-} __answer=''
  if $INTERACTIVE; then
    if [[ -n "$__default" ]]; then
      read -r -p "    $__question [$__default]: " __answer </dev/tty || true
    else
      read -r -p "    $__question: " __answer </dev/tty || true
    fi
  fi
  printf -v "$__var" '%s' "${__answer:-$__default}"
}

# ask_secret VAR "Question"  (input is hidden; empty answer allowed)
ask_secret() {
  local __var=$1 __question=$2 __answer=''
  read -r -s -p "    $__question: " __answer </dev/tty || true
  printf '\n'
  # Remove spaces and line breaks that come along when pasting.
  __answer="$(printf '%s' "$__answer" | tr -d '[:space:]')"
  printf -v "$__var" '%s' "$__answer"
}

# confirm "Question" [Y|N]  (default answer; non-interactive mode takes the default)
confirm() {
  local question=$1 default=${2:-Y} answer=''
  if ! $INTERACTIVE; then [[ "$default" == Y ]]; return; fi
  if [[ "$default" == Y ]]; then
    read -r -p "    $question [Y/n]: " answer </dev/tty || true
    [[ -z "$answer" || "$answer" =~ ^[YyJj] ]]
  else
    read -r -p "    $question [y/N]: " answer </dev/tty || true
    [[ "$answer" =~ ^[YyJj] ]]
  fi
}

# Read a string field from (pretty or compact) JSON on stdin. Good enough for the
# small, flat objects the Railway CLI prints. Prints nothing (and never fails) if missing.
json_field() {
  { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/'
}

gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32
  else
    od -An -N48 -tx1 /dev/urandom | tr -dc 'a-f0-9' | cut -c1-32
  fi
}

# Calls an HTTPS API with a secret header passed via stdin (not visible in `ps`).
# Prints the HTTP status code; the response body goes to the file given as $3.
http_with_secret_header() {
  local url=$1 header=$2 body_file=$3; shift 3
  printf '%s\n' "$header" | curl -sS -m 20 -o "$body_file" -w '%{http_code}' -H @- "$@" "$url" 2>/dev/null || echo 000
}

check_github_token() {
  local tmp code login
  tmp="$(mktemp)"
  code="$(http_with_secret_header "$GITHUB_API/user" "Authorization: Bearer $1" "$tmp" \
    -H 'Accept: application/vnd.github+json')"
  login="$(json_field login <"$tmp" || true)"
  rm -f "$tmp"
  if [[ "$code" == 200 && -n "$login" ]]; then printf '%s' "$login"; return 0; fi
  return 1
}

check_anthropic_api_key() {
  local tmp code
  tmp="$(mktemp)"
  code="$(http_with_secret_header "$ANTHROPIC_API/v1/models" "x-api-key: $1" "$tmp" \
    -H 'anthropic-version: 2023-06-01')"
  rm -f "$tmp"
  [[ "$code" == 200 ]]
}

# set_var KEY VALUE: value goes through stdin; no deploy is triggered yet.
set_var() {
  printf '%s' "$2" | "$RAILWAY" variable set "$1" --stdin --skip-deploys --service "$SERVICE" >/dev/null \
    || die "could not set variable $1"
  ok "$1 set"
}

# =============================================================================
printf '%sClaude Code on Railway: setup%s\n' "$BOLD" "$RESET"
$INTERACTIVE || info "(non-interactive mode)"

# --- 1. Tools ------------------------------------------------------------------
step "Checking tools"
command -v "$RAILWAY" >/dev/null 2>&1 || die "the Railway CLI is not installed.
  Install it with one of:
    npm install -g @railway/cli
    brew install railway
  then run this script again."
command -v curl >/dev/null 2>&1 || die "curl is not installed."
ok "Railway CLI: $("$RAILWAY" --version 2>/dev/null | head -1)"

# --- 2. Railway login --------------------------------------------------------------
step "Railway login"
if ! "$RAILWAY" whoami >/dev/null 2>&1; then
  $INTERACTIVE || die "not logged in to Railway. Set RAILWAY_API_TOKEN or run \`railway login\`."
  info "A browser window opens for the Railway login."
  "$RAILWAY" login || die "Railway login failed."
fi
ok "logged in: $("$RAILWAY" whoami 2>/dev/null | tail -1)"

# --- 3. What to deploy -------------------------------------------------------------
step "What to deploy"
default_repo=''
if origin_url="$(git remote get-url origin 2>/dev/null)"; then
  default_repo="$(printf '%s' "$origin_url" | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##')"
  [[ "$default_repo" == */* && "$default_repo" != *:* ]] || default_repo=''
fi
default_branch=main
if current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" && [[ "$current_branch" != HEAD ]] \
   && git rev-parse --verify --quiet "refs/remotes/origin/$current_branch" >/dev/null; then
  default_branch="$current_branch"
fi
ask REPO "GitHub repo with this project (owner/repo)" "${SETUP_REPO:-$default_repo}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "repo must look like owner/repo (got \"$REPO\")."
ask BRANCH "Branch to deploy" "${SETUP_BRANCH:-$default_branch}"
ask PROJECT "Railway project name" "${SETUP_PROJECT:-claude-dev}"
ask SERVICE "Railway service name" "${SETUP_SERVICE:-claude-code}"
info "${DIM}Railway needs access to $REPO: github.com/settings/installations → Railway → Configure.${RESET}"

# --- 4. Railway project ------------------------------------------------------------
step "Railway project"
if "$RAILWAY" status >/dev/null 2>&1 && confirm "This folder is already linked to a Railway project (see \`railway status\`). Use that project?" Y; then
  ok "using the linked project"
else
  workspace_args=()
  if [[ -n "${SETUP_WORKSPACE:-}" ]]; then workspace_args=(--workspace "$SETUP_WORKSPACE"); fi
  "$RAILWAY" init --name "$PROJECT" ${workspace_args[@]+"${workspace_args[@]}"} || die "could not create the project."
  ok "project \"$PROJECT\" created and linked to this folder"
fi

# --- 5. Service --------------------------------------------------------------------
step "Service"
EXISTING_SERVICE=false
if "$RAILWAY" service link "$SERVICE" >/dev/null 2>&1; then
  EXISTING_SERVICE=true
  ok "using existing service \"$SERVICE\""
else
  out="$("$RAILWAY" add --service "$SERVICE" --json 2>&1)" || die "could not create the service: $out"
  [[ -n "$(printf '%s' "$out" | json_field id)" ]] || die "unexpected answer from \`railway add\`: $out"
  ok "service \"$SERVICE\" created"
fi
KEEP_HINT=''
if $EXISTING_SERVICE; then KEEP_HINT=' (or keep current)'; fi

# --- 6. Tokens -----------------------------------------------------------------------
step "Claude access"
CLAUDE_VAR='' CLAUDE_VALUE=''
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] && confirm "Use CLAUDE_CODE_OAUTH_TOKEN from your environment?" Y; then
  CLAUDE_VAR=CLAUDE_CODE_OAUTH_TOKEN CLAUDE_VALUE="$(printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" | tr -d '[:space:]')"
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]] && confirm "Use ANTHROPIC_API_KEY from your environment?" Y; then
  CLAUDE_VAR=ANTHROPIC_API_KEY CLAUDE_VALUE="$(printf '%s' "$ANTHROPIC_API_KEY" | tr -d '[:space:]')"
elif $INTERACTIVE; then
  info "1) Claude Pro/Max subscription (token from \`claude setup-token\`)"
  info "2) Claude API key (pay per use, from console.anthropic.com)"
  if $EXISTING_SERVICE; then info "3) keep what's already set"; fi
  choice=''
  ask choice "Choose" 1
  case "$choice" in
    1)
      CLAUDE_VAR=CLAUDE_CODE_OAUTH_TOKEN
      if command -v claude >/dev/null 2>&1 && confirm "Run \`claude setup-token\` now? (opens a browser to log in)" Y; then
        claude setup-token || warn "claude setup-token did not finish."
        info "Copy the token it printed (starts with sk-ant-oat01-)."
      else
        info "Run \`claude setup-token\` in another terminal and copy the token (sk-ant-oat01-...)."
      fi
      ask_secret CLAUDE_VALUE "Paste the subscription token (hidden)"
      ;;
    2)
      CLAUDE_VAR=ANTHROPIC_API_KEY
      ask_secret CLAUDE_VALUE "Paste the API key (hidden)"
      ;;
    3) ;;
    *) die "please answer 1, 2 or 3." ;;
  esac
fi
if [[ -n "$CLAUDE_VAR" && -z "$CLAUDE_VALUE" ]]; then
  $EXISTING_SERVICE || die "a Claude token or API key is required."
  CLAUDE_VAR=''
fi
if [[ "$CLAUDE_VALUE" == sk-ant-oat* ]]; then CLAUDE_VAR=CLAUDE_CODE_OAUTH_TOKEN; fi
if [[ "$CLAUDE_VAR" == CLAUDE_CODE_OAUTH_TOKEN ]]; then
  [[ "$CLAUDE_VALUE" == sk-ant-oat* ]] || warn "this doesn't look like a subscription token (expected sk-ant-oat...)."
  ok "subscription token received (it's checked on first use)"
elif [[ "$CLAUDE_VAR" == ANTHROPIC_API_KEY ]]; then
  if check_anthropic_api_key "$CLAUDE_VALUE"; then
    ok "API key works"
  else
    warn "the Claude API did not accept this key."
    confirm "Continue anyway?" N || die "stopped. Nothing secret was saved yet."
  fi
elif ! $EXISTING_SERVICE; then
  die "a Claude token or API key is required (set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)."
else
  ok "keeping the current Claude access"
fi

step "GitHub access (for git clone/push of your projects)"
GITHUB_VALUE=''
if [[ -n "${GITHUB_TOKEN:-}" ]] && confirm "Use GITHUB_TOKEN from your environment?" Y; then
  GITHUB_VALUE="$(printf '%s' "$GITHUB_TOKEN" | tr -d '[:space:]')"
elif $INTERACTIVE; then
  info "Create a fine-grained token: https://github.com/settings/personal-access-tokens/new"
  info "  Repository access: only the repos Claude should work on"
  info "  Permissions: Contents = Read and write, Pull requests = Read and write"
  info "  (optional: Workflows = Read and write, so Claude may change GitHub Actions files)"
  ask_secret GITHUB_VALUE "Paste the GitHub token (hidden, empty = skip)$KEEP_HINT"
fi
if [[ -n "$GITHUB_VALUE" ]]; then
  if gh_login="$(check_github_token "$GITHUB_VALUE")"; then
    ok "token works (GitHub user @$gh_login)"
  else
    warn "GitHub did not accept this token."
    confirm "Continue anyway?" N || die "stopped. Nothing secret was saved yet."
  fi
else
  if $EXISTING_SERVICE; then ok "keeping the current GitHub access"; else warn "no GitHub token: only public repos can be cloned, and no pushes."; fi
fi

step "Terminal login"
NEW_PASSWORD=''
if [[ -n "${TERMINAL_PASSWORD:-}" ]]; then
  NEW_PASSWORD="$TERMINAL_PASSWORD"
  ok "using TERMINAL_PASSWORD from your environment"
elif $EXISTING_SERVICE && confirm "Keep the current terminal password?" Y; then
  ok "keeping the current password"
else
  NEW_PASSWORD="$(gen_password)"
  ok "generated a new random password (shown at the end)"
fi
[[ -z "$NEW_PASSWORD" || ${#NEW_PASSWORD} -ge 16 ]] || warn "the password is short; 16+ characters are recommended."

step "Git author for your commits"
ask GIT_NAME "Name" "${GIT_USER_NAME:-$(git config --get user.name 2>/dev/null || true)}"
ask GIT_EMAIL "Email" "${GIT_USER_EMAIL:-$(git config --get user.email 2>/dev/null || true)}"

# --- 7. Apply ------------------------------------------------------------------------
step "Saving settings on Railway"
info "Project \"$PROJECT\", service \"$SERVICE\", repo $REPO ($BRANCH)"
confirm "Apply now?" Y || die "stopped before saving any settings."

if [[ -n "$CLAUDE_VAR" ]]; then
  set_var "$CLAUDE_VAR" "$CLAUDE_VALUE"
  # Only one kind of Claude access may be set (an API key would win over a subscription token).
  other=ANTHROPIC_API_KEY
  [[ "$CLAUDE_VAR" == ANTHROPIC_API_KEY ]] && other=CLAUDE_CODE_OAUTH_TOKEN
  if "$RAILWAY" variable delete "$other" --service "$SERVICE" >/dev/null 2>&1; then
    ok "removed the old $other"
  fi
fi
[[ -n "$GITHUB_VALUE" ]] && set_var GITHUB_TOKEN "$GITHUB_VALUE"
[[ -n "$NEW_PASSWORD" ]] && set_var TERMINAL_PASSWORD "$NEW_PASSWORD"
[[ -n "$GIT_NAME" ]] && set_var GIT_USER_NAME "$GIT_NAME"
[[ -n "$GIT_EMAIL" ]] && set_var GIT_USER_EMAIL "$GIT_EMAIL"
CLAUDE_VALUE='' GITHUB_VALUE=''

step "Volume (keeps your files across restarts)"
if out="$("$RAILWAY" volume add --mount-path "$MOUNT_PATH" --json 2>&1)"; then
  ok "volume mounted at $MOUNT_PATH"
elif printf '%s' "$out" | grep -qi "already mounted"; then
  ok "volume already exists"
else
  die "could not create the volume: $out"
fi

step "Public address"
out="$("$RAILWAY" domain --port "$APP_PORT" --service "$SERVICE" --json 2>&1)" || die "could not create a domain: $out"
URL="$(printf '%s' "$out" | json_field domain)"
[[ -n "$URL" ]] || URL="$(printf '%s' "$out" | { grep -o 'https\?://[^"[:space:]]*' || true; } | head -1)"
[[ -n "$URL" ]] || die "unexpected answer from \`railway domain\`: $out"
[[ "$URL" == http* ]] || URL="https://$URL"
ok "$URL"

step "Connecting $REPO ($BRANCH) and deploying"
if ! out="$("$RAILWAY" service source connect --repo "$REPO" --branch "$BRANCH" --service "$SERVICE" --json 2>&1)"; then
  die "could not connect the repo: $out
  Make sure Railway's GitHub app can see $REPO: github.com/settings/installations → Railway → Configure."
fi
ok "repo connected; pushes to $BRANCH deploy automatically from now on"
"$RAILWAY" redeploy --from-source --service "$SERVICE" --yes >/dev/null || die "could not start the deploy."
ok "deploy started"

WAIT="${SETUP_WAIT_SECONDS:-900}"
if (( WAIT > 0 )); then
  step "Waiting until it's up (the first build takes a few minutes)"
  info "${DIM}Build logs in another terminal: railway logs --build --service $SERVICE${RESET}"
  deadline=$(( $(date +%s) + WAIT ))
  up=false
  while (( $(date +%s) < deadline )); do
    if [[ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL/healthz" || true)" == 200 ]]; then up=true; break; fi
    printf '.'
    sleep 10
  done
  printf '\n'
  if $up; then ok "it's up"; else warn "not up yet. Check: railway logs --build --service $SERVICE"; fi
fi

# --- Done ------------------------------------------------------------------------------
printf '\n%sDone.%s\n\n' "$BOLD" "$RESET"
printf '  Open:      %s\n' "$URL"
printf '  User:      %s\n' "dev"
if [[ -n "$NEW_PASSWORD" ]]; then
  printf '  Password:  %s\n' "$NEW_PASSWORD"
  printf '  %sSave the password in your password manager now; it is not shown again.%s\n' "$YELLOW" "$RESET"
else
  printf '  Password:  unchanged\n'
fi
cat <<EOF

  In the terminal:   claude
  Clone a project:   git clone https://github.com/OWNER/REPO ~/projects/REPO

  Optional, in the Railway dashboard (service → Settings):
    - Serverless: on, so it sleeps when unused and costs less
    - Resource limits: e.g. 2 vCPU / 2 GB
    - Variables: "Seal" CLAUDE_CODE_OAUTH_TOKEN / GITHUB_TOKEN so nobody can read them back
EOF
