#!/usr/bin/env bash
# 启动 Prompt Forge 并在浏览器打开。已在运行则直接打开，不重复起进程。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}"
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/prompt-forge.log"

open_url() {
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 &
  return 0
}

alive() {
  curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1
}

if alive; then
  open_url
  exit 0
fi

mkdir -p "$(dirname "$LOG")"
cd "$DIR"
nohup node server.mjs >>"$LOG" 2>&1 &

for _ in $(seq 1 60); do
  if alive; then break; fi
  sleep 0.25
done

if alive; then
  open_url
else
  echo "启动失败，日志：$LOG" >&2
  tail -20 "$LOG" >&2 || true
  exit 1
fi
