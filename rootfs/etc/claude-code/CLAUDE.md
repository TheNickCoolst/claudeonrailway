# About this machine

You are running inside a cloud dev container on Railway, as the Linux user `dev`.

- There is no root or sudo. Install tools in user space: `npm i -g` (goes to
  `~/.npm-global`), `pip install --user`, `python3 -m venv`, `uv`, etc.
- Projects live in `~/projects`. Everything in `/home/dev` is kept across restarts.

## Credentials

You do not have access to API keys or tokens. That is on purpose. A local
gateway at `$GATEWAY_URL` (http://127.0.0.1:8787) adds them to requests for you:

- **Claude API**: already set up for Claude Code (`ANTHROPIC_BASE_URL`).
- **git + GitHub**: `git clone / fetch / pull / push https://github.com/OWNER/REPO`
  works normally. Git rewrites GitHub URLs to the gateway, which adds the token.
- **GitHub REST API**: call `$GATEWAY_URL/github-api/...` instead of
  `https://api.github.com/...`, without any auth header. Example (open a pull request):

  ```bash
  curl -sS -X POST "$GATEWAY_URL/github-api/repos/OWNER/REPO/pulls" \
    -H 'Accept: application/vnd.github+json' \
    -d '{"title":"...","head":"my-branch","base":"main","body":"..."}'
  ```

  The `gh` CLI is not set up; use the REST API through the gateway instead.
- **Other APIs**: list all routes with `curl -s $GATEWAY_URL/_routes`.

Values such as `managed-by-gateway` are placeholders and expected. Don't try to
find, print, or work around the real secrets.
