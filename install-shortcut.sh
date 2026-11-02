#!/usr/bin/env bash
# 安装桌面快捷方式：应用菜单 + 桌面图标（GNOME / KDE / XFCE 通用 .desktop）
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ID="prompt-forge"
ICON="$DIR/public/icon-512.png"

chmod +x "$DIR/launch.sh" "$DIR/start.sh" "$DIR/server.mjs"

APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"

DESKTOP_FILE="$APPS/${APP_ID}.desktop"
cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Prompt Forge
Name[zh_CN]=提示词工坊
GenericName=Prompt Generator
Comment=Turn one-line requirements into copy-paste prompts for Claude, GPT and DeepSeek
Comment[zh_CN]=把一句话需求，按各家模型特性生成可直接粘贴的提示词
Exec=${DIR}/launch.sh
Icon=${ICON}
Terminal=false
Categories=Development;Utility;
Keywords=prompt;llm;claude;gpt;deepseek;ai;
StartupNotify=true
StartupWMClass=prompt-forge
EOF

chmod +x "$DESKTOP_FILE"

# 桌面图标
DESKTOP_DIR="$HOME/Desktop"
if command -v xdg-user-dir >/dev/null 2>&1; then
  d="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  [ -n "$d" ] && [ -d "$d" ] && DESKTOP_DIR="$d"
fi
if [ -d "$DESKTOP_DIR" ]; then
  cp "$DESKTOP_FILE" "$DESKTOP_DIR/${APP_ID}.desktop"
  chmod +x "$DESKTOP_DIR/${APP_ID}.desktop"
  # GNOME 需要标记为可信，否则桌面图标显示为“不受信任”
  command -v gio >/dev/null 2>&1 && gio set "$DESKTOP_DIR/${APP_ID}.desktop" metadata::trusted true 2>/dev/null || true
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

echo "✓ 已安装：$DESKTOP_FILE"
[ -d "$DESKTOP_DIR" ] && echo "✓ 桌面图标：$DESKTOP_DIR/${APP_ID}.desktop"
echo "  在应用菜单搜索「Prompt Forge」或「提示词工坊」即可打开。"
