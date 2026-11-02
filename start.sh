#!/usr/bin/env bash
# 启动 Prompt Forge（零依赖，无需 npm install）
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
HOST="${HOST:-127.0.0.1}"

if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  echo "→ 使用环境变量 DEEPSEEK_API_KEY"
else
  echo "→ 未检测到 DEEPSEEK_API_KEY，请在页面右上角 ⚙ 里填 Key"
fi

echo "→ http://${HOST}:${PORT}"
exec node server.mjs
