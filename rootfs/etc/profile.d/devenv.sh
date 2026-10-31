# shellcheck shell=sh
# Shell setup for the dev user (login shells; tmux starts login shells).

case ":$PATH:" in
  *":$HOME/.npm-global/bin:"*) ;;
  *) PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH" ;;
esac
export PATH

# Welcome text, shown once per tmux session.
if [ -n "$PS1" ] && [ "$(id -un)" = "dev" ] && [ -z "$DEVENV_WELCOME_SHOWN" ]; then
  if [ -n "$TMUX" ]; then tmux set-environment DEVENV_WELCOME_SHOWN 1 2>/dev/null; fi
  export DEVENV_WELCOME_SHOWN=1
  cat <<'EOF'

  Claude Dev Studio on Railway (Claude Agent SDK)
  -----------------------------------------------
  Web UI: http://127.0.0.1:7681
  Projects directory: ~/projects (persisted across restarts)
  git clone https://github.com/OWNER/REPO ~/projects/REPO (token added automatically)

  tmux:  Ctrl-b c  new window    Ctrl-b n  next window    Shift + drag  select text
  Your session keeps running when you close the browser tab.

EOF
fi
