#!/usr/bin/env bash
# ============================================================================
# sync-patches.sh — 从当前环境生成 Unified Diff 格式补丁
# 用于更新 patches/v5.3/ 目录
# 用法: bash scripts/sync-patches.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$SCRIPT_DIR/patches/v5.3"
mkdir -p "$PATCH_DIR"

# 确定插件路径（优先 v5.3）
if [ -d "$HOME/.openclaw/npm/node_modules/@larksuite/openclaw-lark" ]; then
    PLUGIN_DIR="$HOME/.openclaw/npm/node_modules/@larksuite/openclaw-lark"
elif [ -d "/usr/lib/node_modules/@larksuite/openclaw-lark" ]; then
    PLUGIN_DIR="/usr/lib/node_modules/@larksuite/openclaw-lark"
else
    echo "✗ 未找到 @larksuite/openclaw-lark 插件"
    exit 1
fi

echo "使用插件目录: $PLUGIN_DIR"

# 生成补丁
# 注意: 需要原始未修改的文件作为参考
# 若没有原始文件，将使用当前文件与备份对比
if [ ! -d "$SCRIPT_DIR/orig" ]; then
    echo "⚠️  未找到 orig/ 原始文件目录"
    echo "   创建 $SCRIPT_DIR/orig/ 并放入原始字节跳动的插件文件"
    echo "   或手动从 npm registry 下载 @larksuite/openclaw-lark@2026.4.10"
    exit 0
fi

for file in src/core/footer-config.js src/card/builder.js src/card/streaming-card-controller.js src/card/reply-dispatcher.js; do
    if [ -f "$PLUGIN_DIR/$file" ] && [ -f "$SCRIPT_DIR/orig/$file" ]; then
        patch_name=$(echo "$file" | sed 's|src/||; s|/|-|')
        patch_file="$PATCH_DIR/$(printf '%02d' $((++i)))-${patch_name}.patch"
        diff -u "$SCRIPT_DIR/orig/$file" "$PLUGIN_DIR/$file" > "$patch_file" && \
            echo "✓ 生成: $(basename "$patch_file")" || \
            echo "  (无差异: $file)"
    fi
done

echo "✅ 补丁同步完成: $PATCH_DIR"
