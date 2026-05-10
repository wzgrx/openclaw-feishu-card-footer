#!/usr/bin/env bash
# ============================================================================
# auto-patch.sh — OpenClaw Feishu Card Footer 全自动部署脚本 (v5.7)
# 支持 OpenClaw v2026.5.2 / v2026.5.3 / v2026.5.6 / v2026.5.7
# 自动检测版本 → 备份 → 打补丁 → 安装聚合器 → 启动服务 → 验证
# ============================================================================
set -euo pipefail

# ─── 颜色 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
NC='\033[0m'; BOLD='\033[1m'
info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
header(){ echo -e "\n${CYAN}${BOLD}══════════════════════════════════════════${NC}"; echo -e "${BOLD}  $1${NC}"; echo -e "${CYAN}${BOLD}══════════════════════════════════════════${NC}\n"; }

# ─── 0. 获取脚本所在目录 ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── 1. 检测环境 ──────────────────────────────────────────────────────────
header "🔍 环境检测"

# 1a. Node.js
if ! command -v node &>/dev/null; then
    error "Node.js 未安装，请先安装 Node.js >= 18"
    exit 1
fi
NODE_VER=$(node -v | sed 's/v//')
info "Node.js $NODE_VER"

# 1b. OpenClaw 版本
if ! command -v openclaw &>/dev/null; then
    error "OpenClaw 未安装或不在 PATH 中"
    exit 1
fi
OC_VER=$(openclaw --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+')
info "OpenClaw v$OC_VER"

# 1c. 版本归类
case "$OC_VER" in
    2026.5.2)   OC_MAJOR="5.2" ;;
    2026.5.3)   OC_MAJOR="5.3" ;;
    2026.5.6)   OC_MAJOR="5.6" ;;
    2026.5.7)   OC_MAJOR="5.7" ;;
    *)
        warn "未识别的版本 v$OC_VER，将尝试 v5.7 方式部署"
        OC_MAJOR="5.7"
        ;;
esac
info "目标版本: OpenClaw v${OC_MAJOR}"

# 1d. 确定插件路径
if [[ "$OC_MAJOR" == "5.2" ]]; then
    PLUGIN_DIR="/usr/lib/node_modules/@larksuite/openclaw-lark"
    info "插件路径: $PLUGIN_DIR (全局 npm)"
elif [[ "$OC_MAJOR" == "5.7" ]]; then
    # v5.7: npx install 安装到 extensions/ 路径（与 v5.3/v5.6 不同！）
    EXT_PLUGIN="$HOME/.openclaw/extensions/openclaw-lark"
    if [ ! -d "$EXT_PLUGIN" ]; then
        info "插件未安装，执行: npx -y @larksuite/openclaw-lark@2026.5.7 install"
        cd "$HOME/.openclaw" 2>/dev/null
        npx -y "@larksuite/openclaw-lark@2026.5.7" install --version 2026.5.7 --tools-version 1.0.43 2>/dev/null || {
            warn "npx install 失败，尝试降级 tools-version..."
            npx -y "@larksuite/openclaw-lark@2026.5.7" install --version 2026.5.7 --tools-version 1.0.42
        }
        cd "$SCRIPT_DIR" 2>/dev/null
    fi
    PLUGIN_DIR="$EXT_PLUGIN"
    info "插件路径: $PLUGIN_DIR (extensions/)"
else
    # v5.3/v5.6: 检查是否已安装，未安装则自动安装
    LOCAL_PLUGIN="$HOME/.openclaw/npm/node_modules/@larksuite/openclaw-lark"
    if [ ! -d "$LOCAL_PLUGIN" ]; then
        info "插件未安装，执行: openclaw plugins install @larksuite/openclaw-lark"
        echo "Y" | openclaw plugins install "@larksuite/openclaw-lark" 2>/dev/null || {
            warn "openclaw plugins install 失败，尝试 npm 全局安装..."
            npm install -g "@larksuite/openclaw-lark"
        }
    fi
    PLUGIN_DIR="$LOCAL_PLUGIN"
    info "插件路径: $PLUGIN_DIR (OpenClaw 本地缓存)"
fi

if [ ! -d "$PLUGIN_DIR" ]; then
    error "插件目录不存在: $PLUGIN_DIR"
    exit 1
fi

# 1e. 确定补丁目录
PATCH_DIR="$SCRIPT_DIR/patches/v$OC_MAJOR"

# ─── 2. 备份 ──────────────────────────────────────────────────────────────
header "📦 文件备份"
BACKUP_DIR="/tmp/openclaw-lark-backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"
cp -r "$PLUGIN_DIR/src" "$BACKUP_DIR/src"
info "已备份到 $BACKUP_DIR"

# ─── 3. 应用补丁 ──────────────────────────────────────────────────────────
header "🩹 应用补丁"

if [[ "$OC_MAJOR" == "5.7" ]]; then
    # v5.7: 优先尝试 patches/v5.7/ 补丁
    # ⚠️ patches 可能与 v5.7 源码行号不匹配（streaming-card-controller.js 和 builder.js 有结构性变化）
    # 如果补丁失败，自动回退到 src/ 完整覆盖
    PATCH_OK=true
    if [ -d "$PATCH_DIR" ]; then
        PATCH_COUNT=0
        for patch_file in "$PATCH_DIR"/*.patch; do
            [ -f "$patch_file" ] || continue
            info "尝试: $(basename "$patch_file")"
            if patch -d "$PLUGIN_DIR" -p0 --no-backup-if-mismatch -r- < "$patch_file" 2>/dev/null; then
                ((PATCH_COUNT++))
            else
                if patch -d "$PLUGIN_DIR" -p1 --no-backup-if-mismatch -r- < "$patch_file" 2>/dev/null; then
                    ((PATCH_COUNT++))
                else
                    warn "补丁 $(basename "$patch_file") 失败"
                    PATCH_OK=false
                fi
            fi
        done
        if [ "$PATCH_COUNT" -gt 0 ]; then
            info "已应用 $PATCH_COUNT 个补丁"
        fi
    else
        warn "补丁目录不存在: $PATCH_DIR"
        PATCH_OK=false
    fi

    # 补丁失败 → 回退到 src/ 完整覆盖 + 手动补充
    if [ "$PATCH_OK" != "true" ]; then
        warn "补丁未完全应用，回退到 src/ 完整覆盖模式..."

        # 4a. 覆盖 card/ 目录的核心文件
        info "覆盖 src/card/ （builder.js + reply-dispatcher.js + streaming-card-controller.js）..."
        cp "$SCRIPT_DIR/src/card/builder.js" "$PLUGIN_DIR/src/card/builder.js"
        cp "$SCRIPT_DIR/src/card/reply-dispatcher.js" "$PLUGIN_DIR/src/card/reply-dispatcher.js"
        cp "$SCRIPT_DIR/src/card/streaming-card-controller.js" "$PLUGIN_DIR/src/card/streaming-card-controller.js"

        # 4b. 补充 event-bus.js（v5.7 移除了该文件！但 streaming-card-controller 依赖它）
        # 如果没有 event-bus.js，require("../channel/event-bus.js") 会报 MODULE_NOT_FOUND
        info "补充 src/channel/event-bus.js（v5.7 移除文件）..."
        mkdir -p "$PLUGIN_DIR/src/channel/"
        cp "$SCRIPT_DIR/src/channel/event-bus.js" "$PLUGIN_DIR/src/channel/event-bus.js"

        # 4c. 替换 gate.js（实现群聊免 @ 回复 + requireMention/groupPolicy 配置继承）
        info "替换 gate.js（群聊放行策略）..."
        mkdir -p "$PLUGIN_DIR/src/messaging/inbound/"
        cp "$SCRIPT_DIR/src/messaging/inbound/gate.js" "$PLUGIN_DIR/src/messaging/inbound/gate.js"

        info "✅ v5.7 完整覆盖完成（含 event-bus.js + gate.js）"
    fi

elif [[ "$OC_MAJOR" == "5.6" ]]; then
    # v5.6: 使用 src/ 完整覆盖模式
    info "v5.6 使用完整覆盖模式..."
    SRC_DIR="$SCRIPT_DIR/src"
    for subdir in core card channel; do
        if [ -d "$SRC_DIR/$subdir" ]; then
            info "从 src/$subdir/ 复制文件..."
            cp "$SRC_DIR/$subdir/"* "$PLUGIN_DIR/src/$subdir/" 2>/dev/null || true
        fi
    done
    info "✅ v5.6 核心补丁已应用"

elif [ -d "$PATCH_DIR" ]; then
    # v5.2/v5.3: 传统补丁模式
    PATCH_COUNT=0
    for patch_file in "$PATCH_DIR"/*.patch; do
        [ -f "$patch_file" ] || continue
        info "应用: $(basename "$patch_file")"
        # Try -p0 first, then -p1, then -p4 (legacy format)
        if patch -d "$PLUGIN_DIR" -p0 --no-backup-if-mismatch -r- < "$patch_file" 2>/dev/null; then
            ((PATCH_COUNT++))
        elif patch -d "$PLUGIN_DIR" -p1 --no-backup-if-mismatch -r- < "$patch_file" 2>/dev/null; then
            ((PATCH_COUNT++))
        elif patch -d "$PLUGIN_DIR" -p4 --no-backup-if-mismatch -r- < "$patch_file" 2>/dev/null; then
            ((PATCH_COUNT++))
        else
            warn "补丁 $(basename "$patch_file") 应用失败，继续..."
        fi
    done
    info "已应用 $PATCH_COUNT 个补丁"
else
    warn "补丁目录不存在: $PATCH_DIR，尝试从 src/ 直接复制..."
    SRC_DIR="$SCRIPT_DIR/src"
    if [ -d "$SRC_DIR/card" ]; then
        cp -r "$SRC_DIR/card/"* "$PLUGIN_DIR/src/card/" 2>/dev/null || true
    fi
    if [ -d "$SRC_DIR/core" ]; then
        cp -r "$SRC_DIR/core/"* "$PLUGIN_DIR/src/core/" 2>/dev/null || true
    fi
fi

# ─── 4. 安装 Token 聚合器 ────────────────────────────────────────────────
header "📊 安装 Token 聚合器"

AGGR_DIR="$HOME/.openclaw/channels/feishu"
mkdir -p "$AGGR_DIR"

# 复制 channel 组件
if [ -d "$SCRIPT_DIR/src/channel" ]; then
    info "从 src/channel/ 安装组件..."
    cp "$SCRIPT_DIR/src/channel/"* "$AGGR_DIR/" 2>/dev/null || true
    for f in "$AGGR_DIR"/*; do
        info "  $(basename "$f")"
    done
fi

# 复制/更新 standalone token-aggregator
if [ -f "$SCRIPT_DIR/token-aggregator/token-aggregator.js" ]; then
    cp "$SCRIPT_DIR/token-aggregator/token-aggregator.js" "$AGGR_DIR/token-aggregator.js"
    info "token-aggregator.js (standalone) ✓"
fi

# ─── 5. 初始化 token-stats.json ──────────────────────────────────────────
header "📈 初始化 Token 统计种子"

STATS_FILE="$HOME/.openclaw/token-stats.json"
SEED_FILE="$SCRIPT_DIR/scripts/token-stats.json.seed"

if [ ! -f "$STATS_FILE" ] && [ -f "$SEED_FILE" ]; then
    cp "$SEED_FILE" "$STATS_FILE"
    info "已创建 $STATS_FILE"
else
    if [ -f "$STATS_FILE" ]; then
        info "token-stats.json 已存在，跳过"
    else
        # 手动创建默认种子
        cat > "$STATS_FILE" <<JSONEOF
{
  "dateKey": "$(date +%Y-%m-%d)",
  "todayTokens": 0,
  "monthTokens": 0,
  "allTimeTokens": 0
}
JSONEOF
        info "已创建默认 token-stats.json"
    fi
fi

# ─── 6. 安装 / 重启 systemd 服务 ─────────────────────────────────────────
header "⚙️ 配置 systemd 服务"

mkdir -p "$HOME/.config/systemd/user"

# 6a. openclaw-gateway.service
GATEWAY_SERVICE="$HOME/.config/systemd/user/openclaw-gateway.service"
GATEWAY_SRC="$SCRIPT_DIR/scripts/openclaw-gateway.service"
if [ -f "$GATEWAY_SRC" ]; then
    # 仅当不存在时复制，避免覆盖用户定制
    if [ ! -f "$GATEWAY_SERVICE" ]; then
        cp "$GATEWAY_SRC" "$GATEWAY_SERVICE"
        info "已创建 openclaw-gateway.service"
    else
        info "openclaw-gateway.service 已存在"
    fi
fi

# 6b. openclaw-token-aggregator.service
AGGR_SERVICE="$HOME/.config/systemd/user/openclaw-token-aggregator.service"
AGGR_SRC="$SCRIPT_DIR/scripts/openclaw-token-aggregator.service"
if [ -f "$AGGR_SRC" ]; then
    if [ ! -f "$AGGR_SERVICE" ]; then
        cp "$AGGR_SRC" "$AGGR_SERVICE"
        info "已创建 openclaw-token-aggregator.service"
    else
        info "openclaw-token-aggregator.service 已存在"
    fi
fi

# 重载 systemd 并启动服务
systemctl --user daemon-reload

# 启动 token-aggregator daemon
if systemctl --user enable --now openclaw-token-aggregator 2>/dev/null; then
    info "Token 聚合器守护已启动"
else
    warn "Token 聚合器启动失败，请手动检查: journalctl --user -u openclaw-token-aggregator"
fi

# ─── 7. 清除 JITI 缓存 ───────────────────────────────────────────────────
header "🧹 清除 JITI 编译缓存"

JITI_CACHE="$HOME/.openclaw/.jit-cache"
if [ -d "$JITI_CACHE" ]; then
    rm -rf "$JITI_CACHE"
    info "已清除 JITI 缓存"
else
    info "JITI 缓存不存在，跳过"
fi

# ─── 8. 重启网关 ──────────────────────────────────────────────────────────
header "🚀 重启 OpenClaw 网关"

if systemctl --user is-active openclaw-gateway &>/dev/null; then
    systemctl --user restart openclaw-gateway
    info "OpenClaw 网关已重启"
elif systemctl is-active openclaw &>/dev/null; then
    sudo systemctl restart openclaw
    info "OpenClaw 网关已重启 (系统服务)"
else
    warn "网关未作为 systemd 服务运行，请手动启动:"
    warn "  openclaw gateway run"
    warn "  或: systemctl --user start openclaw-gateway"
fi

sleep 2

# ─── 9. 验证 ──────────────────────────────────────────────────────────────
header "✅ 验证部署"

echo -e "  ${BOLD}OpenClaw:${NC}     v$OC_VER"
echo -e "  ${BOLD}插件路径:${NC}     $PLUGIN_DIR"
echo -e "  ${BOLD}备份位置:${NC}     $BACKUP_DIR"
echo ""

# 验证 Footer 补丁是否生效（先检查 card 文件）
if grep -q "CUSTOM 6-LINE FOOTER\\|fl.push\\|🪙" "$PLUGIN_DIR/src/card/builder.js" 2>/dev/null; then
    info "✅ Footer 6-LINE 补丁已生效"
else
    warn "⚠️  Footer 补丁可能未生效"
fi

# 验证 reply-dispatcher 补丁
if grep -q "proactive card creation\\|ensureCardCreated" "$PLUGIN_DIR/src/card/reply-dispatcher.js" 2>/dev/null; then
    info "✅ Proactive card creation 补丁已生效"
else
    warn "⚠️  Proactive card creation 补丁可能未生效"
fi

# 验证 first-token latency 补丁
if grep -q "firstContentTime\\|_firstContentTime" "$PLUGIN_DIR/src/card/streaming-card-controller.js" 2>/dev/null; then
    info "✅ First-token latency 补丁已生效"
else
    warn "⚠️  First-token latency 补丁可能未生效"
fi

# 验证 event-bus.js 是否存在（v5.7 需手动补充）
if [ -f "$PLUGIN_DIR/src/channel/event-bus.js" ]; then
    info "✅ event-bus.js 已存在"
else
    warn "⚠️  event-bus.js 缺失（v5.7 需手动补充 src/channel/event-bus.js）"
fi

# 验证 gate.js 是否有群聊放行逻辑
if grep -q "requireMention\\|groupPolicy" "$PLUGIN_DIR/src/messaging/inbound/gate.js" 2>/dev/null; then
    info "✅ gate.js 群聊放行逻辑已生效"
else
    warn "⚠️  gate.js 可能缺失群聊放行逻辑"
fi

# 验证 allTimeTokens 补丁
if grep -q "allTimeTokens" "$PLUGIN_DIR/src/channel/token-aggregator.js" 2>/dev/null; then
    info "✅ allTimeTokens 补丁已生效"
else
    warn "⚠️  allTimeTokens 补丁可能未生效"
fi

# 验证 token-stats.json
if [ -f "$STATS_FILE" ]; then
    if grep -q "allTimeTokens" "$STATS_FILE" 2>/dev/null; then
        info "✅ token-stats.json 包含 allTimeTokens"
    else
        warn "⚠️  token-stats.json 缺少 allTimeTokens"
    fi
fi

# 验证网关状态
echo ""
if systemctl --user is-active openclaw-gateway &>/dev/null; then
    info "✅ OpenClaw 网关运行中"
elif systemctl is-active openclaw &>/dev/null; then
    info "✅ OpenClaw 运行中 (系统服务)"
else
    warn "⚠️  OpenClaw 网关未运行"
fi

echo ""
info "${BOLD}部署完成！${NC}在飞书群聊发消息测试卡片 footer。"
echo ""
echo -e "  ${YELLOW}注意事项:${NC}"
echo "  - 如 footer 不显示，确认 channels.feishu 下有 footer 配置（或检查 builder.js 是否覆盖成功）"
echo "  - 如群聊无回复，确认 channels.feishu 下有 groupPolicy/requireMention 配置"
echo "  - npx install 会覆盖 openclaw.json！安装后需恢复自定义配置（groupPolicy/footer/streaming 等）"
echo "  - 检查飞书 WebSocket: grep -E 'feishu.*WebSocket.*started' /tmp/openclaw-1000/openclaw-*.log"
echo ""
