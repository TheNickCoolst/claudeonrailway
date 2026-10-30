#!/usr/bin/env bash
# Creates a one-click Railway template for this dev box. Afterwards, deploying is:
# click "Deploy on Railway", fill in your tokens, done.
#
# Run it once on your own computer, from a checkout of this repo:
#
#   scripts/create-railway-template.sh
#
# What it does:
#   1. Checks that the prebuilt image (ghcr.io/OWNER/REPO:latest, published by
#      GitHub Actions after the tests pass) can be pulled without logging in.
#   2. Builds a throwaway Railway project with NO secrets in it: a service running
#      that image, the /home/dev volume, a domain on port 8080, and empty variables
#      that whoever deploys the template fills in.
#   3. Turns that project into a template (like "Generate Template" in the
#      dashboard), publishes it, and deletes the throwaway project.
#   4. Prints the deploy link and a "Deploy on Railway" button for your README.
#
# Needs: the Railway CLI (npm install -g @railway/cli, or brew install railway), curl.
# Non-interactive: --yes (uses SETUP_IMAGE, SETUP_WORKSPACE from the environment).
set -euo pipefail

RAILWAY="${RAILWAY_BIN:-railway}"
REGISTRY_URL="${SETUP_REGISTRY_URL:-https://ghcr.io}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="Claude Code Dev Box"
SERVICE=claude-code
MOUNT_PATH=/home/dev
APP_PORT=8080
# Variables the person deploying the template fills in.
TEMPLATE_VARS=(CLAUDE_CODE_OAUTH_TOKEN GITHUB_TOKEN TERMINAL_PASSWORD GIT_USER_NAME GIT_USER_EMAIL)
CATEGORY="AI/ML"
DESCRIPTION="Claude Code in your browser, with your API keys hidden from the AI"

INTERACTIVE=true
if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" || ! -t 0 ]]; then INTERACTIVE=false; fi

# --- Output helpers ------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' RESET=$'\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi
STEP=0
PROJECT_ID=''
step() { STEP=$((STEP + 1)); printf '\n%s[%d] %s%s\n' "$BOLD" "$STEP" "$*" "$RESET"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  {
  printf '\n%sError:%s %s\n' "$RED" "$RESET" "$*" >&2
  if [[ -n "$PROJECT_ID" ]]; then
    printf '  The throwaway project "%s" (%s) is left over; delete it in the Railway dashboard.\n' "$PROJECT_NAME" "$PROJECT_ID" >&2
  fi
  exit 1
}
ask() {
  local __var=$1 __question=$2 __default=${3:-} __answer=''
  if $INTERACTIVE; then
    read -r -p "    $__question${__default:+ [$__default]}: " __answer </dev/tty || true
  fi
  printf -v "$__var" '%s' "${__answer:-$__default}"
}
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
json_field() {
  { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/'
}

printf '%sClaude Code on Railway: create a one-click template%s\n' "$BOLD" "$RESET"

# --- 1. Tools and login --------------------------------------------------------------
step "Checking tools and Railway login"
command -v "$RAILWAY" >/dev/null 2>&1 || die "the Railway CLI is not installed.
  Install it with: npm install -g @railway/cli   (or: brew install railway)"
command -v curl >/dev/null 2>&1 || die "curl is not installed."
if ! "$RAILWAY" whoami >/dev/null 2>&1; then
  $INTERACTIVE || die "not logged in to Railway. Set RAILWAY_API_TOKEN or run \`railway login\`."
  "$RAILWAY" login || die "Railway login failed."
fi
ok "logged in: $("$RAILWAY" whoami 2>/dev/null | tail -1)"
[[ -f "$REPO_DIR/TEMPLATE.md" ]] || die "TEMPLATE.md is missing next to this script's folder."

# --- 2. Image ------------------------------------------------------------------------
step "Image the template deploys"
default_image=''
if origin_url="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null)"; then
  repo_path="$(printf '%s' "$origin_url" | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##' | tr '[:upper:]' '[:lower:]')"
  if [[ "$repo_path" == */* && "$repo_path" != *:* ]]; then default_image="ghcr.io/$repo_path:latest"; fi
fi
ask IMAGE "Image" "${SETUP_IMAGE:-$default_image}"
[[ -n "$IMAGE" ]] || die "no image given (expected something like ghcr.io/owner/repo:latest)."

if [[ "$IMAGE" == ghcr.io/* ]]; then
  ref="${IMAGE#ghcr.io/}"
  name="${ref%%:*}"
  tag=latest
  if [[ "$ref" == *:* ]]; then tag="${ref##*:}"; fi
  token="$(curl -s -m 20 "$REGISTRY_URL/token?service=ghcr.io&scope=repository:$name:pull" | json_field token)"
  code=000
  if [[ -n "$token" ]]; then
    code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
      -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json' \
      "$REGISTRY_URL/v2/$name/manifests/$tag" || true)"
  fi
  if [[ "$code" != 200 ]]; then
    die "$IMAGE can't be pulled without logging in, so Railway couldn't deploy it.
  1. Check that GitHub Actions published it: your repo → Actions → latest \"Tests\" run on main
     → the \"Publish image\" job is green.
  2. Make the image public: github.com → your profile → Packages → ${name##*/}
     → Package settings → Change visibility → Public.
     It contains this repo's code but no secrets (tokens are only added when deploying).
  Then run this script again."
  fi
  ok "$IMAGE is publicly available"
else
  warn "not a ghcr.io image; skipping the public-access check."
fi

# --- 3. Throwaway project ----------------------------------------------------------------
step "Building a throwaway project without secrets"
# Work in an empty folder, so this doesn't change which project the repo folder is linked to.
WORKDIR="$(mktemp -d)"
cd "$WORKDIR"
init_args=(init --name "$PROJECT_NAME" --json)
if [[ -n "${SETUP_WORKSPACE:-}" ]]; then init_args+=(--workspace "$SETUP_WORKSPACE"); fi
if ! out="$("$RAILWAY" "${init_args[@]}" 2>&1)"; then
  if [[ "$out" == *"--workspace required"* ]] && $INTERACTIVE; then
    workspace=''
    ask workspace "You have several Railway workspaces. Which one should own the template (name)?" ""
    out="$("$RAILWAY" init --name "$PROJECT_NAME" --json --workspace "$workspace" 2>&1)" || die "could not create the project: $out"
  else
    die "could not create the project: $out"
  fi
fi
PROJECT_ID="$(printf '%s' "$out" | json_field id)"
[[ -n "$PROJECT_ID" ]] || die "unexpected answer from \`railway init\`: $out"
ok "project \"$PROJECT_NAME\" ($PROJECT_ID)"

out="$("$RAILWAY" add --service "$SERVICE" --json 2>&1)" || die "could not create the service: $out"
ok "service \"$SERVICE\""

empty_vars=()
for v in "${TEMPLATE_VARS[@]}"; do empty_vars+=("$v="); done
"$RAILWAY" variable set "${empty_vars[@]}" --skip-deploys --service "$SERVICE" >/dev/null || die "could not add the variables."
ok "empty variables for the deploy form: ${TEMPLATE_VARS[*]}"

out="$("$RAILWAY" volume add --mount-path "$MOUNT_PATH" --json 2>&1)" || die "could not create the volume: $out"
ok "volume at $MOUNT_PATH"

out="$("$RAILWAY" domain --port "$APP_PORT" --service "$SERVICE" --json 2>&1)" || die "could not create a domain: $out"
ok "public domain on port $APP_PORT"

out="$("$RAILWAY" service source connect --image "$IMAGE" --service "$SERVICE" --json 2>&1)" || die "could not set the image: $out"
ok "service runs $IMAGE"

# --- 4. Template ---------------------------------------------------------------------------
step "Creating the template"
out="$("$RAILWAY" templates create --json 2>&1)" || die "could not create the template: $out"
TEMPLATE_ID="$(printf '%s' "$out" | json_field id)"
EDITOR_URL="$(printf '%s' "$out" | json_field editorUrl)"
[[ -n "$TEMPLATE_ID" ]] || die "unexpected answer from \`railway templates create\`: $out"
ok "template draft created"

DEPLOY_URL=''
if confirm "Publish it now? This is needed for the Deploy button. The template holds no secrets, but it is listed in Railway's template marketplace." Y; then
  out="$("$RAILWAY" templates publish "$TEMPLATE_ID" --category "$CATEGORY" --description "$DESCRIPTION" \
    --readme-file "$REPO_DIR/TEMPLATE.md" --json 2>&1)" || die "could not publish the template: $out
  The draft is still there: $EDITOR_URL"
  DEPLOY_URL="$(printf '%s' "$out" | json_field url)"
  ok "published"
fi

# --- 5. Clean up ------------------------------------------------------------------------------
step "Cleaning up"
if confirm "Delete the throwaway project? (the template is a separate copy)" Y; then
  if "$RAILWAY" delete --project "$PROJECT_ID" --yes >/dev/null 2>&1; then
    ok "throwaway project deleted"
    PROJECT_ID=''
  else
    warn "couldn't delete it (2FA?). Delete \"$PROJECT_NAME\" in the Railway dashboard."
  fi
else
  info "kept the throwaway project \"$PROJECT_NAME\"."
fi
cd "$REPO_DIR"
rmdir "$WORKDIR" 2>/dev/null || true

# --- Done ---------------------------------------------------------------------------------------
printf '\n%sDone.%s\n\n' "$BOLD" "$RESET"
if [[ -n "$DEPLOY_URL" ]]; then
  printf '  Deploy link:  %s\n\n' "$DEPLOY_URL"
  printf '  Button for your README:\n'
  printf '    [![Deploy on Railway](https://railway.com/button.svg)](%s)\n\n' "$DEPLOY_URL"
fi
printf '  Template editor (optional: add descriptions to the variables): %s\n' "${EDITOR_URL:-see Railway → Workspace → Templates}"
cat <<'EOF'

  To deploy: open the deploy link, fill in CLAUDE_CODE_OAUTH_TOKEN (from
  `claude setup-token`), GITHUB_TOKEN, TERMINAL_PASSWORD, GIT_USER_NAME and
  GIT_USER_EMAIL, and click Deploy. Then open the service's URL and log in as dev.
EOF
