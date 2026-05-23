#!/usr/bin/env bash
# deploy.sh — 将本项目源码部署到 OpenClaw 扩展目录
# 用法: bash deploy.sh [openclaw-lark 路径]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${1:-$HOME/.openclaw/extensions/openclaw-lark}"

if [ ! -d "$PLUGIN_DIR" ]; then
    echo "❌ 插件目录不存在: $PLUGIN_DIR"
    echo "请先安装 @larksuite/openclaw-lark"
    echo "  npm install -g @larksuite/openclaw-lark@latest"
    echo "  cp -a /path/to/node_modules/@larksuite/openclaw-lark \$HOME/.openclaw/extensions/openclaw-lark"
    exit 1
fi

# 备份
BACKUP_DIR="/tmp/openclaw-lark-backup-$(date +%s)"
cp -r "$PLUGIN_DIR/src" "$BACKUP_DIR" 2>/dev/null || true
echo "📦 已备份到 $BACKUP_DIR"

# 复制源码
echo "📋 部署 src/ ..."
cp -r "$SCRIPT_DIR/src/"* "$PLUGIN_DIR/src/"
echo "✅ 部署完成！请确保在 openclaw.json 中设置了:"
echo "   agents.defaults.verboseDefault: on"
echo ""
echo "然后重启网关: systemctl --user restart openclaw-gateway"
