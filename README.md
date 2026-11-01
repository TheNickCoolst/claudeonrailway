# Claude Dev Studio on Railway (Claude Agent SDK)

[![Tests](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/test.yml/badge.svg)](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/test.yml)
[![Lint](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/lint.yml/badge.svg)](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/lint.yml)
[![Security](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/security.yml/badge.svg)](https://github.com/TheNickCoolst/claudeonrailway/actions/workflows/security.yml)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/TheNickCoolst/claudeonrailway/pkgs/container/claudeonrailway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Your own cloud dev studio: Autonomous AI coding powered by the official
**Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)** with a modern **Web UI**,
connected to your GitHub projects and running cheaply on [Railway](https://railway.com).

Work on your codebases directly from the browser: Claude explores code, edits files,
runs tests, and lets you review git diffs and commit & push back to GitHub with one click.

Your API keys live securely in Railway variables. **Claude can use them, but cannot see or leak them**:
they never appear in its environment, its files, or its context. Works with a Claude API key or your Claude Pro/Max subscription.

🇩🇪 **Deutsche Schritt-für-Schritt-Anleitung: [DEPLOY.de.md](DEPLOY.de.md)**

```
 Browser ──HTTPS──▶ Railway ──▶ gateway (Linux user "broker")
                                  │  checks your password
                                  │  holds ALL your secrets
                                  ▼
                              web studio (Linux user "dev")
                                  Claude Agent SDK + Web UI + your projects
                                  no secrets, only placeholders
                                  │
           requests go to http://127.0.0.1:8787/...   (the gateway)
                                  │
                                  ▼
         gateway adds the real key ──▶ api.anthropic.com / github.com / ...
```

## Features

- 🤖 **Multi-Provider AI Agents:**
  - 🟣 **Claude (Anthropic):** Powered by the official Claude Agent SDK & Anthropic SDK (Claude 3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku, Opus).
  - 🔵 **Antigravity (Google DeepMind):** Gemini 2.5 Pro & 2.0 Flash with expansive reasoning context via Google AI Studio.
  - 🟢 **Codex / OpenAI:** GPT-4o, GPT-4o-mini, o3-mini & o1 reasoning models.
  - 🟠 **OpenCode:** Open-source AI ecosystem with DeepSeek V3, DeepSeek R1, Qwen 2.5 Coder, and local Ollama runtimes.
  - 🎁 **Freebuff (Free Tier):** 100% free community ad-funded model access without requiring credit cards or subscriptions!
- 🌐 **Modern Web Studio:** Single-page dashboard to chat with the agents, inspect real-time tool execution cards, and switch models on the fly.
- 📁 **Cloud Workspace & Projects:** Clone repos from GitHub or switch between projects in `/home/dev/projects`.
- 🔍 **Live Diff Review:** Inspect all modified, untracked, and deleted files with unified syntax highlighting.
- ✨ **Universal AI Commit Message Generator:** Auto-generates clean conventional commit messages from the actual diff with any chosen provider.
- 🚀 **1-Click Commit & Push:** Stages, commits, and pushes changes back to GitHub through the authenticated gateway proxy.
- 💻 **Integrated Cloud Terminal:** Run arbitrary bash commands (`npm test`, `git log`, etc.) right from the browser.

## Supported AI Providers & Keys

| Provider | Recommended Models | Environment Variable | Cost / Tier |
|---|---|---|---|
| **🐙 GitHub Models** | GPT-4o, DeepSeek-R1, Llama 3.3 | Uses your `GITHUB_TOKEN` automatically | **100% Free** (GitHub Prototyping Tier) |
| **🟠 OpenCode** | OpenRouter Auto, Qwen 2.5 Coder 32B, Gemini 2.0 Flash Exp | `OPENCODE_API_KEY` or `OPENCODE_BASE_URL` | **100% Free** (`:free` Pool & local Ollama) |
| **🎁 Freebuff** | Freebuff Auto, DeepSeek V3, GLM 4 | *(No key required)* or `FREEBUFF_API_KEY` | **100% Free** (Ad-Funded) |
| **🔵 Antigravity** | Gemini 2.0 Flash, Gemini Thinking, 1.5 Flash | `ANTIGRAVITY_API_KEY` or `GEMINI_API_KEY` | **100% Free** (1500 req/day on Google AI Studio) |
| **🟣 Claude** | Claude 3.7 Sonnet, 3.5 Sonnet | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | Pay-as-you-go or Claude Pro/Max subscription |
| **🟢 Codex / OpenAI** | GPT-4o, o3-mini, o1 | `OPENAI_API_KEY` or `CODEX_API_KEY` | OpenAI API balance |

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

## Tokens you need

| Token | What for | Where to get it | Ends up in |
|---|---|---|---|
| Railway login | Lets the setup script configure Railway | `railway login` (browser), no token needed | stays on your computer |
| Claude subscription token **or** API key | Claude Code's access to Claude | `claude setup-token` (Pro/Max, valid 1 year) or [console.anthropic.com](https://console.anthropic.com) | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| GitHub fine-grained token | `git clone`/`push`, pull requests | [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new): only your repos, *Contents* and *Pull requests* read & write (optionally *Workflows*) | `GITHUB_TOKEN` |
| Terminal password | Logging in to the web terminal | generated by the setup script | `TERMINAL_PASSWORD` |
| Railway API token (optional) | Only for running the setup script unattended (CI) | Railway → Account Settings → Tokens | `RAILWAY_API_TOKEN` when running the script, never inside the box |

## One-click deploy (Railway template)

Set this up once; after that, deploying is: click the button, fill in your
tokens, done. The template runs a prebuilt image, so Railway needs no access
to this repo, which can stay private.

1. **Image:** after the tests pass on `main`, GitHub Actions publishes
   `ghcr.io/OWNER/REPO:latest` (job *Publish image*).
2. **Make the image public, once:** GitHub → your profile → *Packages* → this
   repo's package → *Package settings* → *Change visibility* → *Public*. It
   contains the code but no secrets; tokens are only added when deploying.
3. **Create the template, once** (needs the Railway CLI):

   ```bash
   scripts/create-railway-template.sh
   ```

   The script does the following:
   - Checks that the image is public.
   - Builds a throwaway Railway project **without secrets**: the image, the
     `/home/dev` volume, a domain on port 8080, and empty variables.
   - Turns it into a template, publishes it, and deletes the throwaway project.
   - Prints the deploy link and a "Deploy on Railway" button for this README.

   Published templates are listed in Railway's marketplace; they hold no
   secrets.

Deploying then asks for `CLAUDE_CODE_OAUTH_TOKEN` (a subscription token from
`claude setup-token`, or an API key), `GITHUB_TOKEN`, `TERMINAL_PASSWORD`,
`GIT_USER_NAME` and `GIT_USER_EMAIL`. The overview shown on Railway's deploy
page is [TEMPLATE.md](TEMPLATE.md). New versions arrive as a new image when
the tests pass on `main`; click *Redeploy* on the service to update.

## Deploy with the setup script

On your own computer, with the [Railway CLI](https://www.npmjs.com/package/@railway/cli)
installed (`npm install -g @railway/cli` or `brew install railway`), and
Railway's GitHub app allowed to see this repo
([GitHub → Settings → Applications](https://github.com/settings/installations) → Railway → Configure):

```bash
scripts/setup-railway.sh
```

It logs you in to Railway and asks for your tokens. It can run
`claude setup-token` for you, and checks each token before saving anything.
Then it creates the project, service, variables, the `/home/dev` volume and a
domain, connects this repo, deploys, waits until the box is up, and prints the
URL, login name and password. The login name defaults to `dev`; set
`TERMINAL_USERNAME` (or answer the prompt) to choose another.

- **Tokens stay off the screen:** they're typed hidden and sent to Railway via
  stdin, so they never appear in your shell history or process list.
- **Safe to run again:** use it to change a token. Existing resources are
  reused and empty answers keep current values.
- **Unattended:** `--yes` reads everything from environment variables (see the
  top of the script).

## Deploy by hand (about 10 minutes)

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
   | `CLAUDE_CODE_OAUTH_TOKEN` | | Claude Pro/Max subscription token from `claude setup-token` (see [below](#api-key-or-subscription)) |
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
- **`CLAUDE_CODE_OAUTH_TOKEN`** (Claude Pro/Max subscription): usually cheaper
  for heavy use. On your own computer, run `claude setup-token`, log in, and
  paste the `sk-ant-oat01-...` token it prints into Railway. It's valid for one
  year.
  - The gateway sends the token with the same headers Claude Code uses in
    subscription mode (`Authorization: Bearer` plus the `oauth-2025-04-20`
    beta). I compared both side by side against a fake API. It hasn't been run
    against the real API with a real token yet, so your first deploy is the
    real test. If it fails, the Railway logs say why.
  - Claude Code's header shows "API Usage Billing". That's only a label: usage
    counts against your subscription, because that's the credential the
    gateway sends.
  - The default model is Opus. Switch with `/model` if your plan doesn't
    include it or you want your limits to last longer.
  - Spaces or line breaks pasted along with the token are removed, and a
    subscription token put into `ANTHROPIC_API_KEY` by mistake is detected.
  - Anthropic's terms say subscription credentials are for the person who pays
    for the plan, so keep the box to yourself.

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

## If something doesn't work

Open the service's deploy logs in Railway. The gateway explains common problems:

| Log line | Meaning |
|---|---|
| `anthropic: answered 401` | Key or subscription token wrong or expired. Make a new one (`claude setup-token`). |
| `anthropic: answered 403` | Not allowed, e.g. your plan doesn't include the model. Use `/model`. |
| `anthropic: answered 429` | Rate or usage limit reached. Wait for it to reset. |
| `github: answered 401/403/404` | `GITHUB_TOKEN` is wrong, expired, or has no access to that repo. |
| `ERROR: cannot switch to the dev/broker users` | The platform blocks switching Linux users. The box refuses to start rather than expose your keys. |

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

## Testing

```bash
test/smoke-test.sh
```

```bash
test/setup-script-test.sh
```

- **`test/smoke-test.sh`** needs Docker and Node. It builds the image and starts
  it with fake keys and a fake API (including a real git server). Then it
  checks the login, Claude Code, git clone and push, subscription mode, and
  that no secret reaches the `dev` user or the logs. With Playwright installed,
  it also drives the terminal in a real browser.
- **`test/setup-script-test.sh`** runs the setup script against a fake Railway
  CLI (`test/fake-railway`), which only accepts the argument shapes the real
  CLI accepts. It covers a first setup, a re-run that switches to an API key,
  a rejected token, and an interactive run typed into a terminal. It also
  covers the template script: a published template, a private image that's
  refused, and several workspaces. The fake applies the CLI's publish rules
  to `TEMPLATE.md`.

Both run on every push in GitHub Actions (`.github/workflows/test.yml`).

## Files

| Path | What it does |
|---|---|
| `Dockerfile` | Ubuntu 24.04, Node 24, Claude Code, ttyd, tmux, common dev tools |
| `railway.toml` | Railway build and health check settings |
| `scripts/setup-railway.sh` | Sets everything up on Railway, asks for your tokens |
| `scripts/create-railway-template.sh` | Creates and publishes the one-click Railway template |
| `TEMPLATE.md` | Overview shown on the template's deploy page |
| `rootfs/usr/local/bin/entrypoint.sh` | Start script: splits secrets from the terminal, starts everything |
| `gateway/server.js` | Password check for the terminal, and the proxy that adds your keys |
| `rootfs/etc/claude-code/CLAUDE.md` | Tells Claude Code how this machine works |
| `test/` | Smoke test for the image, tests for the setup script |
| `.github/workflows/test.yml` | Runs both test suites on every push; publishes the image from `main` |
