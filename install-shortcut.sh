#!/usr/bin/env bash
# 安装桌面快捷方式（.desktop）
#   bash install-shortcut.sh                # 应用菜单 + 桌面
#   bash install-shortcut.sh --menu-only    # 只装应用菜单
#   bash install-shortcut.sh --desktop-only # 只装桌面
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ID="prompt-forge"
ICON="$DIR/public/icon-512.png"
MODE="${1:-both}"

chmod 755 "$DIR/launch.sh" "$DIR/start.sh" "$DIR/server.mjs" 2>/dev/null || true

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
EOF

# 0 组可写、其它可写都要去掉：
# ding 扩展源码 fileItem.js 里 (unixmode & S_IWOTH) 为真时直接拒绝启动。
chmod 755 "$DESKTOP_FILE"

# GNOME(ding) 判断可启动的依据是 metadata::trusted == 'true'（字符串，不是布尔）。
# 部分 gvfs 版本的 `gio set` 写不进去，这里用 pygobject 兜底。
set_trusted() {
  local f="$1"
  if gio set "$f" metadata::trusted true >/dev/null 2>&1; then
    :
  else
    /usr/bin/python3 - "$f" >/dev/null 2>&1 <<'PY' || true
import sys
from gi.repository import Gio
f = Gio.File.new_for_path(sys.argv[1])
info = Gio.FileInfo()
info.set_attribute_string('metadata::trusted', 'true')
f.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, None)
PY
  fi
  /usr/bin/python3 - "$f" <<'PY' 2>/dev/null || return 0
import sys
from gi.repository import Gio
f = Gio.File.new_for_path(sys.argv[1])
qi = f.query_info('metadata::trusted', Gio.FileQueryInfoFlags.NONE, None)
print('trusted =', qi.get_attribute_as_string('metadata::trusted'))
PY
}

echo "✓ 应用菜单：$DESKTOP_FILE"

if [ "$MODE" != "--menu-only" ]; then
  DESKTOP_DIR="$HOME/Desktop"
  if command -v xdg-user-dir >/dev/null 2>&1; then
    d="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
    [ -n "$d" ] && [ -d "$d" ] && DESKTOP_DIR="$d"
  fi
  if [ -d "$DESKTOP_DIR" ]; then
    cp "$DESKTOP_FILE" "$DESKTOP_DIR/${APP_ID}.desktop"
    chmod 755 "$DESKTOP_DIR/${APP_ID}.desktop"
    echo -n "✓ 桌面：$DESKTOP_DIR/${APP_ID}.desktop  "
    set_trusted "$DESKTOP_DIR/${APP_ID}.desktop"
  else
    echo "! 没找到桌面目录，跳过桌面图标"
  fi

  # 让桌面图标立即刷新（GNOME 的 ding 扩展会缓存元数据）
  if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable ding@rastersoft.com >/dev/null 2>&1 || true
    sleep 0.3
    gnome-extensions enable ding@rastersoft.com >/dev/null 2>&1 || true
  fi
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

echo "  搜「Prompt Forge」或「提示词工坊」即可打开。"
