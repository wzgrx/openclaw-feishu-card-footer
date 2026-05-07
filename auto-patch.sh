#!/usr/bin/env bash
# ============================================================================
# OpenClaw Feishu Card Footer — 全自动部署脚本
# 支持 OpenClaw v2026.5.2 / v2026.5.3 / v2026.5.6 自动检测 + 补丁 + 重启
# 用法: curl -sL https://github.com/wzgrx/openclaw-feishu-card-footer | bash
#       或手动: bash auto-patch.sh
# ============================================================================
set -euo pipefail

# ─── 颜色 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
NC='\033[0m'; BOLD='\033[1m'
info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
header(){ echo -e "\n${CYAN}${BOLD}══════════════════════════════════════════${NC}"; echo -e "${BOLD}  $1${NC}"; echo -e "${CYAN}${BOLD}══════════════════════════════════════════${NC}\n"; }

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
    *)
        warn "未识别的版本 v$OC_VER，将尝试 v5.6 方式部署"
        OC_MAJOR="5.6"
        ;;
esac
info "目标版本: OpenClaw v${OC_MAJOR}"

# 1d. 确定插件路径
if [[ "$OC_MAJOR" == "5.2" ]]; then
    PLUGIN_DIR="/usr/lib/node_modules/@larksuite/openclaw-lark"
    info "插件路径: $PLUGIN_DIR (全局 npm)"
else
    # v5.3/v5.6: 先检查是否已安装，未安装则自动安装
    LOCAL_PLUGIN="$HOME/.openclaw/npm/node_modules/@larksuite/openclaw-lark"
    if [ ! -d "$LOCAL_PLUGIN" ]; then
        info "插件未安装，执行: openclaw plugins install @larksuite/openclaw-lark@2026.4.10"
        echo "Y" | openclaw plugins install "@larksuite/openclaw-lark@2026.4.10" 2>/dev/null || {
            warn "openclaw plugins install 失败，尝试 npm 全局安装..."
            npm install -g "@larksuite/openclaw-lark@2026.4.10"
        }
    fi
    PLUGIN_DIR="$LOCAL_PLUGIN"
    info "插件路径: $PLUGIN_DIR (OpenClaw 本地缓存)"
fi

if [ ! -d "$PLUGIN_DIR" ]; then
    error "插件目录不存在: $PLUGIN_DIR"
    exit 1
fi

# 获取当前脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/patches/v$OC_MAJOR"

# ─── 2. 备份 ──────────────────────────────────────────────────────────────
header "📦 文件备份"
BACKUP_DIR="/tmp/openclaw-lark-backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"
cp -r "$PLUGIN_DIR/src" "$BACKUP_DIR/src"
info "已备份到 $BACKUP_DIR"

# ─── 3. v5.3/v5.6 专属处理 ─────────────────────────────────────────────
if [[ "$OC_MAJOR" == "5.3" ]]; then
    header "🔧 v5.3 专属修复 — 补充缺失函数"
    
    # 检查 builder.js 是否缺少 buildStreamingThinkingCard
    if ! grep -q "function buildStreamingThinkingCard" "$PLUGIN_DIR/src/card/builder.js" 2>/dev/null; then
        info "补回 buildStreamingThinkingCard + buildStreamingPreAnswerCard"
        
        # 找到 buildStreamingToolUsePendingPanel 函数的位置，在其前插入
        # 这里用 awk/sed 做精确插入
        awk '
        /^function buildStreamingToolUsePendingPanel/ {
            print ""
            print "/**"
            print " * Build the initial CardKit 2.0 streaming card with a loading icon."
            print " * Optionally includes a tool-use pending panel above the streaming area."
            print " */"
            print "function buildStreamingThinkingCard(showToolUse = true) {"
            print "    return buildStreamingPreAnswerCard({ showToolUse });"
            print "}"
            print "/**"
            print " * Build a CardKit 2.0 card for the pre-answer streaming phase."
            print " * Used both for the initial card and for live updates during tool calls."
            print " */"
            print "function buildStreamingPreAnswerCard(params) {"
            print "    const { steps, elapsedMs, showToolUse = true } = params;"
            print "    const hasSteps = Boolean(steps?.length);"
            print "    const elements = [];"
            print "    if (showToolUse) {"
            print "        elements.push(hasSteps ? buildStreamingToolUseActivePanel({ steps: steps, elapsedMs }) : buildStreamingToolUsePendingPanel());"
            print "    }"
            print "    elements.push({"
            print "        tag: '\''markdown'\'',"
            print "        content: '\'''\''',"
            print "        text_align: '\''left'\'',"
            print "        text_size: '\''normal_v2'\'',"
            print "        margin: '\''0px 0px 0px 0px'\'',"
            print "        element_id: exports.STREAMING_ELEMENT_ID,"
            print "    });"
            print "    elements.push({"
            print "        tag: '\''markdown'\'',"
            print "        content: '\'' '\'',"
            print "        icon: {"
            print "            tag: '\''custom_icon'\'',"
            print "            img_key: '\''img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg'\'',"
            print "            size: '\''16px 16px'\'',"
            print "        },"
            print "        element_id: '\''loading_icon'\'',"
            print "    });"
            print "    return {"
            print "        schema: '\''2.0'\'',"
            print "        config: {"
            print "            streaming_mode: true,"
            print "            locales: ['\''zh_cn'\'', '\''en_us'\''],"
            print "            summary: {"
            print "                content: '\''Processing...'\'',"
            print "                i18n_content: { zh_cn: '\''处理中...'\'', en_us: '\''Processing...'\'' },"
            print "            },"
            print "        },"
            print "        body: { elements },"
            print "    };"
            print "}"
            print "/**"
            print " * Build the collapsible panel for the active pre-answer phase."
            print " */"
            print "function buildStreamingToolUseActivePanel(params) {"
            print "    const { steps, elapsedMs } = params;"
            print "    const enParts = ['\''Tool use'\''];"
            print "    const zhParts = ['\''工具执行'\''];"
            print "    if (steps.length > 0) {"
            print "        enParts.push(`${steps.length} step${steps.length === 1 ? '\'''\'' : '\''s'\''}`);"
            print "        zhParts.push(`${steps.length} 步`);"
            print "    }"
            print "    if (elapsedMs != null && elapsedMs > 0) {"
            print "        const d = formatElapsed(elapsedMs);"
            print "        enParts.push(`('\''${d}'\'')`);"
            print "        zhParts.push(`('\''${d}'\'')`);"
            print "    }"
            print "    return {"
            print "        tag: '\''collapsible_panel'\'',"
            print "        expanded: true,"
            print "        header: {"
            print "            title: {"
            print "                tag: '\''plain_text'\'',"
            print "                content: `🛠️ ${enParts.join('\'' · '\'')}`,"
            print "                i18n_content: {"
            print "                    zh_cn: `🛠️ ${zhParts.join('\'' · '\'')}`,"
            print "                    en_us: `🛠️ ${enParts.join('\'' · '\'')}`,"
            print "                },"
            print "                text_color: '\''grey'\'',"
            print "                text_size: '\''notation'\'',"
            print "            },"
            print "            vertical_align: '\''center'\'',"
            print "            icon: {"
            print "                tag: '\''standard_icon'\'',"
            print "                token: '\''down-small-ccm_outlined'\'',"
            print "                color: '\''grey'\'',"
            print "                size: '\''16px 16px'\'',"
            print "            },"
            print "            icon_position: '\''right'\'',"
            print "            icon_expanded_angle: -180,"
            print "        },"
            print "        border: { color: '\''grey'\'', corner_radius: '\''5px'\'' },"
            print "        vertical_spacing: '\''4px'\'',"
            print "        padding: '\''8px 8px 8px 8px'\'',"
            print "        elements: steps.flatMap((step) => buildToolUseStepElements(step)),"
            print "    };"
            print "}"
            print ""
            print $0
            next
        }
        { print }
        ' "$PLUGIN_DIR/src/card/builder.js" > "$PLUGIN_DIR/src/card/builder.js.tmp" && \
        mv "$PLUGIN_DIR/src/card/builder.js.tmp" "$PLUGIN_DIR/src/card/builder.js"
        
        info "✅ 缺失函数已补回"
    else
        info "buildStreamingThinkingCard 已存在，跳过"
    fi
fi

# ─── 4. 应用补丁 ──────────────────────────────────────────────────────────
header "🩹 应用补丁"

if [[ "$OC_MAJOR" == "5.6" ]]; then
    # v5.6: 使用 src/ 完整覆盖模式（无独立 patches/v5.6/ 目录）
    info "v5.6 使用完整覆盖模式..."
    SRC_DIR="$SCRIPT_DIR/src"
    if [ -d "$SRC_DIR/core" ]; then
        info "从 src/core/ 复制文件..."
        cp "$SRC_DIR/core/"* "$PLUGIN_DIR/src/core/"
    fi
    if [ -d "$SRC_DIR/card" ]; then
        info "从 src/card/ 复制文件..."
        cp "$SRC_DIR/card/"* "$PLUGIN_DIR/src/card/"
    fi
    info "✅ v5.6 核心补丁已应用"
elif [ -d "$PATCH_DIR" ]; then
    PATCH_COUNT=0
    for patch_file in "$PATCH_DIR"/*.patch; do
        [ -f "$patch_file" ] || continue
        info "应用: $(basename "$patch_file")"
        # -p4 剥离 /tmp/openclaw-lark-orig/package/ 前缀
        # --no-backup-if-mismatch 避免 .orig 文件
        patch -d "$PLUGIN_DIR" -p4 --no-backup-if-mismatch -r- < "$patch_file" 2>/dev/null || {
            warn "补丁 $(basename "$patch_file") 可能部分失败，继续..."
        }
        ((PATCH_COUNT++))
    done
    info "已应用 $PATCH_COUNT 个补丁"
else
    warn "补丁目录不存在: $PATCH_DIR，跳过补丁应用"
    warn "将使用内置替换逻辑（内联补丁）"
    
    # ── 内联后备：直接从 src/ 目录复制 ──
    SRC_DIR="$SCRIPT_DIR/src"
    if [ -d "$SRC_DIR/card" ]; then
        info "从 src/card/ 复制文件..."
        cp -r "$SRC_DIR/card/"* "$PLUGIN_DIR/src/card/"
    fi
    if [ -d "$SRC_DIR/core" ]; then
        info "从 src/core/ 复制文件..."
        cp -r "$SRC_DIR/core/"* "$PLUGIN_DIR/src/core/"
    fi
fi

# ─── 5. 安装 Token 聚合器（事件式监听） ──────────────────────────────────
header "📊 安装 Token 聚合器"

AGGR_DIR="$HOME/.openclaw/channels/feishu"
mkdir -p "$AGGR_DIR"

# v5.6 使用 src/channel/ 中的完整组件（含 event-bus.js + monitor.js）
if [[ "$OC_MAJOR" == "5.6" ]] && [ -d "$SCRIPT_DIR/src/channel" ]; then
    info "v5.6: 从 src/channel/ 安装完整组件..."
    cp "$SCRIPT_DIR/src/channel/"* "$AGGR_DIR/"
    info "  token-aggregator.js ✓"
    info "  token-aggregator-daemon.js ✓"
    info "  event-bus.js ✓"
    info "  monitor.js ✓"
elif [ -f "$SCRIPT_DIR/token-aggregator/token-aggregator.js" ]; then
    cp "$SCRIPT_DIR/token-aggregator/token-aggregator.js" "$AGGR_DIR/"
    info "token-aggregator.js"
fi
if [ -f "$SCRIPT_DIR/token-aggregator/token-aggregator-daemon.js" ]; then
    # v5.6 已从 src/channel/ 复制，跳过
    if [[ "$OC_MAJOR" != "5.6" ]]; then
        cp "$SCRIPT_DIR/token-aggregator/token-aggregator-daemon.js" "$AGGR_DIR/"
        info "token-aggregator-daemon.js"
    fi
fi

# ─── 6. 启动聚合器守护进程（systemd user） ───────────────────────────────
if [ -f "$AGGR_DIR/token-aggregator-daemon.js" ]; then
    UNIT_NAME="openclaw-token-aggregator"
    UNIT_PATH="$HOME/.config/systemd/user/${UNIT_NAME}.service"
    
    if [ ! -f "$UNIT_PATH" ]; then
        mkdir -p "$(dirname "$UNIT_PATH")"
        cat > "$UNIT_PATH" <<SYSTEMDEOF
[Unit]
Description=OpenClaw Token Aggregator Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node $AGGR_DIR/token-aggregator-daemon.js
Restart=on-failure
RestartSec=10
WorkingDirectory=$AGGR_DIR

[Install]
WantedBy=default.target
SYSTEMDEOF
        systemctl --user daemon-reload
        systemctl --user enable --now "$UNIT_NAME" 2>/dev/null && \
            info "Token 聚合器守护已启动" || \
            warn "请手动启动: systemctl --user start $UNIT_NAME"
    else
        systemctl --user restart "$UNIT_NAME" 2>/dev/null || true
        info "Token 聚合器守护已重启"
    fi
fi

# ─── 7. 重启网关 ──────────────────────────────────────────────────────────
header "🚀 重启 OpenClaw 网关"

if systemctl --user is-active openclaw-gateway &>/dev/null; then
    systemctl --user restart openclaw-gateway
elif systemctl is-active openclaw &>/dev/null; then
    sudo systemctl restart openclaw
fi

sleep 2
if systemctl --user is-active openclaw-gateway &>/dev/null; then
    info "OpenClaw 网关已重新启动"
elif systemctl is-active openclaw &>/dev/null; then
    info "OpenClaw 网关已重新启动"
else
    warn "请手动重启网关: openclaw gateway run 或 systemctl --user restart openclaw-gateway"
fi

# ─── 8. 验证 ──────────────────────────────────────────────────────────────
header "✅ 验证"

echo -e "  ${BOLD}OpenClaw:${NC}     v$OC_VER"
echo -e "  ${BOLD}插件路径:${NC}     $PLUGIN_DIR"
echo -e "  ${BOLD}备份位置:${NC}     $BACKUP_DIR"
echo -e "  ${BOLD}Footer 状态:${NC}  "
grep -q "line1Zh\|primaryZh" "$PLUGIN_DIR/src/card/builder.js" 2>/dev/null && \
    echo "    ✓ Footer 渲染函数已打补丁" || \
    echo "    ✗ Footer 补丁未生效"

echo ""
if [[ "$OC_MAJOR" == "5.6" ]]; then
    echo -e "  ${YELLOW}⚠️  v5.6 专属提醒${NC}"
    echo "  群聊不回消息？请在 openclaw.json 的 channels.feishu 中确认："
    echo '    "replyMode": {'
    echo '      "group": "streaming"'
    echo "    }"
    echo ""
fi

info "${BOLD}部署完成！${NC}在飞书群聊发消息测试卡片 footer。"
echo ""
