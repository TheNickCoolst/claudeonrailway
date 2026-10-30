# Deploy and Host Claude Code Dev Box with Railway

A cloud dev environment with Claude Code in your browser: a password-protected
terminal (tmux) where you clone your GitHub projects and run `claude`. Your
Claude and GitHub tokens are stored as Railway variables. Claude Code can use
them, but never sees them.

## About Hosting Claude Code Dev Box

The box runs as one Railway service with a volume at `/home/dev` for your
projects, Claude Code history and settings.

- **Gateway:** a small gateway runs as its own Linux user and is the only
  process that holds your tokens. It adds them to requests for the Claude API
  and GitHub on the way out.
- **Terminal:** the terminal and Claude Code run as a separate user with no
  secrets in its environment and no sudo.
- **Git:** `git clone` and `git push` to GitHub work normally; the gateway adds
  your token.

### Fill in when deploying

| Variable | What to enter |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Your Claude Pro/Max token: run `claude setup-token` on your computer (starts with `sk-ant-oat01-`). A Claude API key (`sk-ant-api...`) works here too. |
| `GITHUB_TOKEN` | A GitHub fine-grained token with access to your repos: *Contents* and *Pull requests* read & write. |
| `TERMINAL_PASSWORD` | A long password (16+ characters) for the web terminal. You log in as user `dev`. |
| `GIT_USER_NAME`, `GIT_USER_EMAIL` | Author name and email for your commits. |

After the deploy, open the service's URL, log in as `dev`, and run `claude`.

## Why Deploy Claude Code Dev Box on Railway

- **Cheap:** about 20 MB of memory when idle, so it fits the Hobby plan.
  Turn on Serverless to let it sleep when unused.
- **Always there:** your session keeps running when you close the tab, and you
  can reach it from any browser, including your phone.
- **Safer by design:** tokens stay out of Claude's reach, so a prompt
  injection can't leak them.

## Common Use Cases

- Let Claude Code work on your GitHub repos from anywhere, without a laptop.
- Run long Claude Code tasks in the cloud and check in later.
- A separate, disposable environment for agent work, away from your own machine.

## Dependencies for Claude Code Dev Box Hosting

- A Claude Pro/Max subscription (token from `claude setup-token`) or a Claude API key.
- A GitHub account with a fine-grained personal access token.

### Deployment Dependencies

- Claude Code: https://code.claude.com
- GitHub fine-grained tokens: https://github.com/settings/personal-access-tokens/new
- Anthropic Console (for API keys): https://console.anthropic.com
