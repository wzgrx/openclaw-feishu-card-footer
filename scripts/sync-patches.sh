#!/usr/bin/env bash
# ============================================================================
# sync-patches.sh — 从当前环境生成 Unified Diff 格式补丁（v5.7）
# 用于更新 patches/v5.7/ 目录
# 用法: bash scripts/sync-patches.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$SCRIPT_DIR/patches/v5.7"
mkdir -p "$PATCH_DIR"

# 确定插件路径（优先 OpenClaw 本地缓存）
if [ -d "$HOME/.openclaw/npm/node_modules/@larksuite/openclaw-lark" ]; then
    PLUGIN_DIR="$HOME/.openclaw/npm/node_modules/@larksuite/openclaw-lark"
elif [ -d "/usr/lib/node_modules/@larksuite/openclaw-lark" ]; then
    PLUGIN_DIR="/usr/lib/node_modules/@larksuite/openclaw-lark"
else
    echo "✗ 未找到 @larksuite/openclaw-lark 插件"
    exit 1
fi

echo "使用插件目录: $PLUGIN_DIR"
echo "补丁输出目录: $PATCH_DIR"
echo ""

# patch definitions: (label, src_path_in_repo, plugin_file)
PATCHES=(
    "001-builder.patch:src/card/builder.js:src/card/builder.js"
    "002-reply-dispatcher.patch:src/card/reply-dispatcher.js:src/card/reply-dispatcher.js"
    "003-streaming-card-controller.patch:src/card/streaming-card-controller.js:src/card/streaming-card-controller.js"
    "004-token-aggregator.patch:src/channel/token-aggregator.js:src/channel/token-aggregator.js"
)

for entry in "${PATCHES[@]}"; do
    IFS=':' read -r patch_name repo_file plugin_file <<< "$entry"
    repo_path="$SCRIPT_DIR/$repo_file"
    plugin_path="$PLUGIN_DIR/$plugin_file"

    if [ ! -f "$repo_path" ]; then
        echo "⚠️  跳过: $patch_name (repo 文件不存在: $repo_path)"
        continue
    fi
    if [ ! -f "$plugin_path" ]; then
        echo "⚠️  跳过: $patch_name (插件文件不存在: $plugin_path)"
        continue
    fi

    patch_file="$PATCH_DIR/$patch_name"
    if diff -u "$repo_path" "$plugin_path" > "$patch_file" 2>/dev/null; then
        echo "  (无差异: $patch_name)"
        rm -f "$patch_file"
    else
        echo "✓ 生成: $patch_name ($(wc -l < "$patch_file") 行)"
    fi
done

echo ""
echo "✅ 补丁同步完成: $PATCH_DIR"
ls -la "$PATCH_DIR"/*.patch 2>/dev/null && echo "" || echo "  (无补丁文件)"
echo "提示: 若插件文件未修改，补丁将为空。手动修改插件文件后重新运行此脚本。"
