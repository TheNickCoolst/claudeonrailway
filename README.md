# Claude Code on Railway

Your own cloud dev box: Claude Code in a browser terminal, connected to your
GitHub projects, running cheaply on [Railway](https://railway.com).

Your API keys live in Railway variables. **Claude Code can use them, but it
can't see them**: they never appear in its environment, its files or its context.

```
 Browser ──HTTPS──▶ Railway ──▶ gateway (Linux user "broker")
                                  │  checks your password
                                  │  holds ALL your secrets
                                  ▼
                               web terminal (Linux user "dev")
                                  tmux + Claude Code + your projects
                                  no secrets, only placeholders
                                  │
           requests go to http://127.0.0.1:8787/...   (the gateway)
                                  │
                                  ▼
         gateway adds the real key ──▶ api.anthropic.com / github.com / ...
```

## How the keys stay hidden

1. Railway passes your variables to the container's start script.
2. The start script gives them **only** to the gateway, which runs as its own
   Linux user (`broker`).
3. The terminal, and Claude Code inside it, run as user `dev` with a fresh
   environment built from an allowlist. It contains no secrets.
4. Claude Code is pointed at the gateway (`ANTHROPIC_BASE_URL`), and git
   rewrites `https://github.com/...` to the gateway. The gateway swaps in the
   real key and forwards the request.
5. Linux stops `dev` from reading the gateway's environment or memory, and
   `dev` has no `sudo`.

The smoke test in `test/` checks all of this: no secret in the environment, in
`/proc`, or in any file `dev` can read, while the upstream API does receive
the real keys.

**What this does not do:** Claude can still *use* your keys. That's the point:
it can spend API credit and push to any repo your GitHub token can reach. It
just can't read, print or leak them. So use a GitHub token limited to the repos
you want, and set a spending limit in the Anthropic Console.

## Deploy (about 10 minutes)

1. **Create the service.** In Railway, go to *New Project → Deploy from GitHub
   repo* and pick this repo. Railway finds the `Dockerfile` by itself.
2. **Add a volume.** Right-click the service → *Attach volume*, with mount path
   **`/home/dev`**. This keeps your projects, Claude Code history and settings
   across restarts. Without it, everything is wiped on each deploy.
3. **Add variables** (service → *Variables*):

   | Variable | Needed? | What it is |
   |---|---|---|
   | `TERMINAL_PASSWORD` | **yes** | Password for the web terminal. Use 16+ random characters. |
   | `ANTHROPIC_API_KEY` | one of these two | Claude API key from [console.anthropic.com](https://console.anthropic.com) |
   | `CLAUDE_CODE_OAUTH_TOKEN` | | Claude Pro/Max subscription token (see [below](#api-key-or-subscription)) |
   | `GITHUB_TOKEN` | recommended | GitHub [fine-grained token](https://github.com/settings/personal-access-tokens/new): pick your repos, then *Contents: read & write* and *Pull requests: read & write* |
   | `GIT_USER_NAME`, `GIT_USER_EMAIL` | recommended | Author name and email for your commits |
   | `TERMINAL_USERNAME` | no | Login name, default `dev` |
   | `PROXY_ROUTES` | no | More APIs with hidden keys, see [below](#other-api-keys) |
   | `DEVENV_*` | no | Non-secret settings for the terminal, see [below](#non-secret-settings) |

4. **Get a URL.** Service → *Settings → Networking → Generate Domain*. If it
   asks for a port, enter `8080`.
5. **Open the URL** and log in as `dev` with your `TERMINAL_PASSWORD`.

Then, in the terminal:

```bash
git clone https://github.com/YOU/YOUR-REPO ~/projects/YOUR-REPO
```

```bash
cd ~/projects/YOUR-REPO && claude
```

`git pull` and `git push` work normally; the gateway adds your token. Your
session keeps running in tmux when you close the tab, so you can come back
later (from your phone too) and pick up where you left off.

Terminal tips: `Ctrl-b c` opens a new tmux window, `Ctrl-b n` switches windows.
To select text for copying, hold `Shift` while you drag.

## API key or subscription?

- **`ANTHROPIC_API_KEY`**: pay per use. Pointing Claude Code at a gateway
  through `ANTHROPIC_BASE_URL` is a documented, supported setup.
- **`CLAUDE_CODE_OAUTH_TOKEN`** (Claude Pro/Max): run `claude setup-token` on
  your own computer and paste the result. Usually cheaper for heavy use.
  **Experimental:** the gateway sends the token the way Claude Code does
  (tested against a fake API), but this first version hasn't been tried against
  the real Claude API yet. If it doesn't work, use an API key.

If neither is set, Claude Code asks you to log in inside the terminal. That
works, but the login is then stored in the terminal's home folder, where Claude
could read it.

## Other API keys

To give your projects (or Claude) access to other APIs without showing the
keys, add a route. Example for OpenAI:

```
OPENAI_API_KEY          = sk-...
PROXY_ROUTES            = {"openai":{"target":"https://api.openai.com","headers":{"Authorization":"Bearer ${OPENAI_API_KEY}"}}}
DEVENV_OPENAI_BASE_URL  = http://127.0.0.1:8787/openai/v1
DEVENV_OPENAI_API_KEY   = placeholder
```

Code in the terminal then uses the OpenAI SDK as usual. Requests go to the
gateway, which adds the real key. `${NAME}` in a header value is replaced with
the Railway variable `NAME`. Run `curl -s $GATEWAY_URL/_routes` in the terminal
to list all routes.

For the GitHub REST API (opening pull requests, for example), use
`$GATEWAY_URL/github-api/...`. Claude Code already knows this from
`/etc/claude-code/CLAUDE.md`. The `gh` CLI is not set up in this version.

## Non-secret settings

Every variable is hidden from the terminal by default. To pass a harmless
setting through, prefix it with `DEVENV_`: `DEVENV_NODE_ENV=development`
becomes `NODE_ENV=development` inside the terminal. Never put secrets in
`DEVENV_` variables.

## Keeping it cheap

At the time of writing, Railway's Hobby plan is $5/month and includes $5 of
usage. Check [railway.com/pricing](https://railway.com/pricing) for current
numbers. Measured memory use: about 20 MB idle, about 100 MB with Claude Code
open, more while it builds or runs your code.

- **Turn on sleeping:** service → *Settings → Serverless*. The box sleeps after
  about 10 minutes without network traffic and wakes when you open the URL
  (the first load takes a few seconds). An open browser tab or a working Claude
  keeps it awake. On sleep, running programs and tmux windows stop, but your
  files and Claude history stay on the volume (`claude --continue` resumes).
- **Cap resources:** service → *Settings → Resource limits* (for example 2 vCPU, 2 GB).
- **Set a usage limit** in your Railway workspace billing settings.

## Updating

- Claude Code updates itself. Updates go into `/home/dev` on the volume.
- Pushing to this repo makes Railway rebuild the image.

## Limits of this first version

- No root or `sudo` in the terminal (that's what keeps the keys safe). Install
  tools in user space (`npm i -g`, `pip install --user`, `uv`), or add system
  packages to the `apt-get install` line in the `Dockerfile`.
- The `gh` CLI isn't wired up; use the GitHub REST API through the gateway.
- One public port only: you can't yet open a web app running in the box
  (like `localhost:3000`) in your browser.
- Browser terminal only: no SSH and no VS Code.
- If `TERMINAL_PASSWORD` isn't set, a temporary one is generated on every start
  and printed in the Railway deploy logs.

## Testing locally

```bash
test/smoke-test.sh
```

This needs Docker and Node. It builds the image, starts it with fake keys and a
fake API (including a real git server), then checks the login, Claude Code, git
clone and push, and that no secret reaches the `dev` user. With Playwright
installed, it also drives the terminal in a real browser.

## Files

| Path | What it does |
|---|---|
| `Dockerfile` | Ubuntu 24.04, Node 24, Claude Code, ttyd, tmux, common dev tools |
| `railway.toml` | Railway build and health check settings |
| `rootfs/usr/local/bin/entrypoint.sh` | Start script: splits secrets from the terminal, starts everything |
| `gateway/server.js` | Password check for the terminal, and the proxy that adds your keys |
| `rootfs/etc/claude-code/CLAUDE.md` | Tells Claude Code how this machine works |
| `test/` | Local smoke test |
