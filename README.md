# OpenClaw Feishu Card Footer — 飞书卡片页脚增强

[![OpenClaw](https://img.shields.io/badge/OpenClaw-v2026.5.12--beta.6-blue)](https://openclaw.nousresearch.com)
[![@larksuite/openclaw-lark](https://img.shields.io/badge/%40larksuite%2Fopenclaw--lark-%3E%3D2026.5.13-green)](https://www.npmjs.com/package/@larksuite/openclaw-lark)
[![Node.js](https://img.shields.io/badge/Node.js-LTS-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**OpenClaw** × **飞书 (Feishu/Lark)** 卡片消息页脚增强组件。
**适配 OpenClaw 核心 v2026.5.12-beta.6 + @larksuite/openclaw-lark@2026.5.13。**
在群聊机器人卡片底部显示完整 AI 对话指标：6 行详细数据覆盖状态、耗时、费用分解、Token 统计、余额。

---

## 📌 版本说明（必读）

为避免混淆，本文档使用以下命名规则：

| 简称 | 全称 | 安装方式 | 说明 |
|------|------|----------|------|
| **OpenClaw `v5.2` ~ `v5.12`** | **OpenClaw 核心** `v2026.5.2` ~ `v2026.5.12` | `openclaw --version` 查看 | 本文档中"v5.x"均指 OpenClaw 核心版本 |
| **插件 `v2026.5.13`（推荐）** | **`@larksuite/openclaw-lark@2026.5.13`** | `npx -y @larksuite/openclaw-lark@2026.5.13 install --version 2026.5.13 --tools-version 1.0.45` | 适配 OpenClaw v2026.5.12 的最新插件，安装到 `extensions/` 目录 |
| **插件 `v2026.4.10`（旧版）** | **`@larksuite/openclaw-lark@2026.4.10`** | `openclaw plugins install` | 仅适配 OpenClaw v5.3/v5.6 |
| **补丁 `patches/`** | 各版本适配文件 | 见对应目录说明 | 仅 v5.3/v5.7 历史版本有效 |
| **Hermes Agent** | **Hermes** 版本标签 | — | ⚠️ 与本项目**无关**！Hermes 和 OpenClaw 是两个独立项目 |

## 🖥️ 基础环境说明

### 运行环境要求

| 组件 | 要求 | 说明 |
|------|------|------|
| **操作系统** | Linux / WSL2 Ubuntu | 支持 systemd user 服务 |
| **OpenClaw** | `v2026.5.12-beta.6`（推荐）/ `v2026.5.7` / `v2026.5.6` / `v2026.5.3` | 通过 `openclaw --version` 查看 |
| **Node.js** | **最新 LTS**（当前 v24.15.0） | 推荐通过 NVM 安装：`nvm install --lts` |
| **飞书插件** | `@larksuite/openclaw-lark@2026.5.13`（推荐）/ `>= 2026.4.10` | ⚠️ 必须官方插件，不可用 `@openclaw/feishu` |
| **systemd** | user 级别（`--user`） | Token 聚合器守护进程 + 网关服务 |

### Node.js 重要规范

- ⚠️ **Node v22+ 必须设置 `NODE_DISABLE_COMPILE_CACHE=1`** 避免 compile cache 冲突
- 通过 NVM 管理版本，升级后需重新安装 `@larksuite/openclaw-lark`：
  ```bash
  nvm install --lts
  npm install -g @larksuite/openclaw-lark
  ```

### 插件安装路径（版本差异）

| 版本 | 安装方式 | 插件目录 |
|------|----------|----------|
| v2026.5.2 | `npm install -g` | `/usr/lib/node_modules/@larksuite/openclaw-lark/` |
| v2026.5.3 / v2026.5.6 | `openclaw plugins install` | `~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/` |
| **v2026.5.7 / v2026.5.12+** | **`npx install`** | **`~/.openclaw/extensions/openclaw-lark/`** |

### 目录结构约定

```
~/.openclaw/
├── openclaw.json                    # 主配置文件
├── token-stats.json                 # Token 日/月/累计统计
├── .jit-cache/                      # JITI 编译缓存（更新补丁后必须清除！）
├── npm/
│   └── node_modules/
│       └── @larksuite/
│           └── openclaw-lark/       # 飞书插件（补丁目标）
│               ├── src/
│               │   ├── card/        # 卡片构建逻辑
│               │   └── core/        # 核心配置
│               └── ...
└── channels/
    └── feishu/                      # 飞书通道扩展
        ├── token-aggregator.js      # Token 聚合器（事件监听）
        ├── token-aggregator-daemon.js
        ├── event-bus.js
        └── monitor.js
```

---

## 📋 功能特性

| 功能 | Emoji | 说明 |
|------|-------|------|
| **完成状态** | ✅ / ❌ / ⏹️ | 调用成功、失败或停止 |
| **耗时** | ⏳️ | 端到端请求耗时 |
| **首Token延迟** | 🚀 | TTFT（Time To First Token） |
| **费用分解** | 💸 | 输入费用 + 输出费用 + 缓存费用 |
| **Token 计数** | ↑ ↓ | 输入（上行）与输出（下行）Token 数量 |
| **缓存命中** | 缓存 X/Y | 缓存读取/写入 Token 及命中率 |
| **上下文窗口** | 📑 | 已用 Token / 最大窗口 + 百分比 |
| **日/月/累计** | 🪙 | 今日 / 本月 / 全部 Token + 时间戳 |
| **余额显示** | 💰 | 自动匹配模型对应平台的账户余额 |

### 🖼️ Footer 6-Line 布局

```
Line 1: 🪙Token 今/月/总: 5.2k丨128.3k丨1.2M · 5/10-20:09
Line 2: ──────────────────
Line 3: ✅ 已完成 · ⏳️ 5.2s · 🚀首token 1.20s · deepseek-v4-flash
Line 4: 💸 ¥0.002 = 入¥0.001 + 出¥0.001 + 缓存¥0.001
Line 5: 📑 1.7k/32k (5%)·↑ 1.2k ↓ 500 · 缓存 300/100 (75%)
Line 6: 💰 DeepSeek ¥205.11
```

**格式规范：**

| 行 | 内容 | 条件 |
|----|------|------|
| Line 1 | 🪙Token 今/月/总: `today`丨`month`丨`allTime` · `M/d-HH:mm` | 始终显示 |
| Line 2 | ────────────────── | 分隔线 |
| Line 3 | `status` · ⏳️ `elapsed` · 🚀首token `ttft` · `model` | status/elapsed/model 始终显示 |
| Line 4 | 💸 ¥`total` = 入¥`input` + 出¥`output` + 缓存¥`cache` | 有费用数据时显示 |
| Line 5 | 📑 `used`/`max` (`%`)·↑ `in` ↓ `out` · 缓存 `read`/`write` (`%`) | 有 token 数据时显示 |
| Line 6 | 💰 `platform` ¥`amount` | 有余额数据时显示；否则显示 `💰 阿里百炼 ¥0` |

---

## 🚀 快速开始

### 前置条件

**适配 OpenClaw 核心 v2026.5.12-beta.6 + @larksuite/openclaw-lark@2026.5.13。**

```bash
# 前置条件
# OpenClaw v2026.5.12-beta.6（推荐）/ v2026.5.7 / v2026.5.6 / v2026.5.3
# @larksuite/openclaw-lark@2026.5.13
  - ⚠️ Node v22+ 需设置 `NODE_DISABLE_COMPILE_CACHE=1` 避免 compile cache 冲突
  - 安装命令：`nvm install --lts`

### 自动部署（推荐）

```bash
git clone https://github.com/wzgrx/openclaw-feishu-card-footer.git
cd openclaw-feishu-card-footer
bash auto-patch.sh
```

脚本会自动完成：
1. 检测 OpenClaw 版本（v5.2 / v5.3 / v5.6 / v5.7）
2. 若插件未安装则自动安装
3. 备份原始文件
4. 加载对应版本的补丁
5. 安装 Token 聚合器 + 守护进程
6. 初始化 `token-stats.json`
7. 配置 systemd 服务并启动（v5.7+）
8. 清除 JITI 编译缓存
9. 重启网关
10. 验证所有补丁是否生效

### 手动部署（OpenClaw v2026.5.7 / v2026.5.12）

⚠️ **v5.7+ 的插件路径**：OpenClaw v2026.5.7 ~ v2026.5.12 使用 `npx install` 安装到 `extensions/` 目录（不是旧版的 `npm/node_modules/`）。

⚠️ **`patches/v5.7/*.patch` 可能不适用于新版插件源码**（streaming-card-controller.js 和 builder.js 的结构有变化）。推荐使用 `src/` 目录中的完整文件覆盖。

```bash
# 1. 停止服务
systemctl --user stop openclaw-gateway

# 2. 安装飞书插件（npx 方式，安装到 extensions/）
cd ~/.openclaw
npx -y @larksuite/openclaw-lark@2026.5.13 install --version 2026.5.13 --tools-version 1.0.45

# ⚠️ npx install 会重写 openclaw.json！备份后恢复自定义配置
cp openclaw.json openclaw.json.bak.npx

# 3. 动态定位插件目录
PLUGIN_DIR=~/.openclaw/extensions/openclaw-lark

# 4. 覆盖补丁后的源文件（从 src/ 目录，而非 patch 方式）
cp src/card/builder.js "$PLUGIN_DIR/src/card/builder.js"
cp src/card/reply-dispatcher.js "$PLUGIN_DIR/src/card/reply-dispatcher.js"
cp src/card/streaming-card-controller.js "$PLUGIN_DIR/src/card/streaming-card-controller.js"

# 5. 补充 event-bus.js（v5.7+ 版本部分插件可能缺少该文件，streaming-card-controller 依赖它发布 session_tokens_accrued 事件）
mkdir -p "$PLUGIN_DIR/src/channel/"
cp src/channel/event-bus.js "$PLUGIN_DIR/src/channel/event-bus.js"

# 6. 替换 gate.js（群聊免 @ 放行 + 群聊配置继承）
cp src/messaging/inbound/gate.js "$PLUGIN_DIR/src/messaging/inbound/gate.js"

# 7. 安装通道组件（Token 聚合器 + 守护进程 + 监控）
mkdir -p ~/.openclaw/channels/feishu
cp src/channel/* ~/.openclaw/channels/feishu/

# 8. 恢复配置中的通道自定义字段（groupPolicy、requireMention、streaming、footer 等）
# 见下方 ⚙️ 配置参考

# 9. 验证 JS 语法（覆盖后必做！）
for f in builder.js reply-dispatcher.js streaming-card-controller.js event-bus.js; do
  node --check "$PLUGIN_DIR/src/card/$f" 2>/dev/null && \
    echo "✅ $f" || node --check "$PLUGIN_DIR/src/card/$f"
done
node --check "$PLUGIN_DIR/src/channel/event-bus.js" && echo "✅ event-bus.js"
node --check "$PLUGIN_DIR/src/messaging/inbound/gate.js" && echo "✅ gate.js"

# 10. 清除 JITI 缓存（重要！不清除则旧代码仍被使用）
rm -rf ~/.openclaw/.jit-cache/

# 11. 重启网关
systemctl --user restart openclaw-gateway

# 12. 验证
sleep 3
systemctl --user status openclaw-gateway | grep "active (running)"
openclaw plugins list | grep openclaw-lark
grep -E "feishu.*WebSocket.*started|feishu.*open_id" /tmp/openclaw-1000/openclaw-*.log | tail -3
```

<details>
<summary>OpenClaw v2026.5.6</summary>

```bash
# 1. 安装飞书插件
echo "Y" | openclaw plugins install @larksuite/openclaw-lark

# 2. 停止 systemd 服务
systemctl --user stop openclaw-gateway.service 2>/dev/null || true

# 3. 应用补丁（完整覆盖）
cp src/core/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/src/core/
cp src/card/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/src/card/

# 4. 安装 Token 聚合器
mkdir -p ~/.openclaw/channels/feishu
cp src/channel/* ~/.openclaw/channels/feishu/

# 5. 配置 replyMode（v5.6 必须！否则群聊不回消息）
# 在 openclaw.json 的 channels.feishu 中显式设置:
#   "replyMode": { "group": "streaming" }

# 6. 清除 JITI 缓存
rm -rf ~/.openclaw/.jit-cache/

# 7. 重启网关
systemctl --user restart openclaw-gateway
```

</details>

<details>
<summary>OpenClaw v2026.5.3</summary>

```bash
# 1. 安装飞书插件
openclaw plugins install @larksuite/openclaw-lark

# 2. 停止 systemd 服务
systemctl --user stop openclaw-gateway.service 2>/dev/null || true

# 3. 应用补丁
cp -r patches/v5.3/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/

# 4. 清除 JITI 缓存
rm -rf ~/.openclaw/.jit-cache/

# 5. 安装 Token 聚合器
mkdir -p ~/.openclaw/channels/feishu
cp src/channel/* ~/.openclaw/channels/feishu/

# 6. 重启网关
systemctl --user restart openclaw-gateway
```

</details>

<details>
<summary>OpenClaw v2026.5.2（已停止维护）</summary>

v5.2 版本的补丁仍在 `patches/v5.3/` 目录中可用，但不再推荐使用。

</details>

---

## ⚙️ 配置参考

### OpenClaw v2026.5.12 配置说明（重要变更）

OpenClaw **核心**在 v2026.5.7 中升级了 Zod Schema 校验。但当 `openclaw-lark` 插件**已安装并加载**时，以下属于通道插件的字段由插件自己消费，核心不会拒绝：

| 字段 | 状态 | 说明 |
|------|------|------|
| `channels.feishu.groupPolicy` | ✅ **可用** | 群聊放行策略（需配合 gate.js 补丁） |
| `channels.feishu.requireMention` | ✅ **可用** | 是否需要 @ 机器人 |
| `channels.feishu.footer` | ✅ **可用** | Footer 功能开关（需配合 builder.js 补丁） |
| `channels.feishu.streaming` | ✅ **可用** | 流式输出开关（需配合 reply-dispatcher 补丁） |
| `channels.feishu.renderMode` | ✅ **可用** | 卡片渲染模式 |
| `channels.feishu.replyMode` | ✅ **可用** | 回复模式配置 |
| `plugins.entries.feishu` | ❌ **被拒绝** | 旧版插件引用，openclaw-lark 不需要 |

> ⚠️ 如果插件未正确加载，核心才会拒绝这些字段。确保 `openclaw plugins list` 显示 `@larksuite/openclaw-lark` 为 `enabled`。

**✅ 正确配置（OpenClaw v2026.5.7 / v2026.5.12 必需的最小合法配置）：**

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "connectionMode": "websocket",
      "enabled": true,
      "domain": "feishu",
      "webhookPath": "/feishu/events"
    }
  },
  "gateway": { "mode": "local" },
  "plugins": { "bundledDiscovery": "compat" }
}
```

> ⚠️ 所有群聊策略（groupPolicy/requireMention）、流式模式（streaming）、Footer 配置已由项目 `src/` 覆盖文件在源码层面处理。
> ⚠️ 如果遇到 `openclaw doctor` 反复恢复配置，先删除稳定性记录：`rm -f ~/.openclaw/logs/stability/*.json`

### 模型定价配置

定价数据在 `models.providers` 的 `cost` 字段配置。参考 `openclaw.json.example`。

### systemd 服务

OpenClaw 提供两个 systemd user 服务：

| 服务 | 文件 | 说明 |
|------|------|------|
| `openclaw-gateway` | `scripts/openclaw-gateway.service` | OpenClaw 网关（端口 18789） |
| `openclaw-token-aggregator` | `scripts/openclaw-token-aggregator.service` | Token 聚合器守护进程 |

---

## 🏗️ 架构

### 文件结构

```
├── auto-patch.sh                 # 全自动部署脚本（v5.2/v5.3/v5.6/v5.7/v5.12 自动检测）
├── patches/
│   ├── v5.3/                     # OpenClaw v2026.5.3 补丁
│   └── v5.7/                     # OpenClaw v2026.5.7 补丁
│       ├── 001-builder.patch              # 6-line footer
│       ├── 002-reply-dispatcher.patch     # Proactive card creation
│       ├── 003-streaming-card-controller.patch  # First-token latency fix
│       └── 004-token-aggregator.patch     # allTimeTokens fix
├── src/                          # 补丁后的完整源文件（参考/覆盖用）
│   ├── card/
│   │   ├── builder.js            # 卡片构建 + 6-Line Footer 渲染
│   │   ├── streaming-card-controller.js
│   │   └── reply-dispatcher.js
│   ├── channel/                  # 非官方扩展组件（必须注入）
│   │   ├── token-aggregator.js   # Token 事件监听
│   │   ├── token-aggregator-daemon.js
│   │   ├── event-bus.js          # Pub/Sub 事件总线
│   │   └── monitor.js            # 状态监控
│   └── core/
│       ├── footer-config.js      # Footer 字段配置
│       └── accounts.js           # 多平台余额查询
├── token-aggregator/             # Token 统计聚合器（简化版）
│   ├── token-aggregator.js
│   └── token-aggregator-daemon.js
├── scripts/
│   ├── openclaw-gateway.service      # systemd 服务单元
│   ├── openclaw-token-aggregator.service
│   ├── sync-patches.sh               # 补丁同步工具
│   ├── token-stats.json.seed         # Token 统计种子文件
│   ├── balance-check.py              # 余额查询（4平台 + 火山引擎）
│   ├── balance-check.js              # 余额查询（Node版）
│   ├── model-fetcher.py              # 模型注册表更新
│   ├── pricing_db.py                 # 模型定价库
│   └── deepseek-pricing-watch.py     # DeepSeek 价格监控
├── openclaw.json.example         # 配置模板
└── README.md                     # 本文件
```

### Token 统计流

```
用户发消息 → OpenClaw 网关 → 飞书插件 → builder.js 构建卡片（6-line footer）
                                    ↓
                          token-aggregator.js（事件监听 → token-stats.json）
                                    ↓
                          🪙 行展示 今日/本月/累计 Token + 时间戳
```

### 余额数据流

```
balance-check.py（cron 每2h）→ balance-cache.json
                                    ↓
                          builder.js getBalanceForModel() 匹配当前模型
                                    ↓
                          💰 行展示平台 + 余额
```

---

## 💰 各平台余额查询技术细节

### DeepSeek

| 项目 | 值 |
|------|-----|
| **端点** | `https://api.deepseek.com/user/balance` |
| **方法** | GET |
| **鉴权** | `Authorization: Bearer <API_KEY>` |
| **响应格式** | `{ "balance_infos": [{ "total_balance": "175.57", ... }], "is_available": true }` |

### 硅基流动

| 项目 | 值 |
|------|-----|
| **端点** | `https://api.siliconflow.cn/v1/user/info` |
| **方法** | GET |
| **鉴权** | `Authorization: Bearer <API_KEY>` |
| **响应格式** | `{ "data": { "totalBalance": 168.81, ... } }` |

### 阿里百炼（DashScope API）

| 项目 | 值 |
|------|-----|
| **端点** | `https://dashscope.aliyuncs.com/api/v1/finance/balance` |
| **方法** | GET |
| **鉴权** | `Authorization: Bearer <DASHSCOPE_API_KEY>` |
| **响应格式** | `{ "data": { "availableAmount": "67.57" } }` |

### 火山引擎

| 项目 | 值 |
|------|-----|
| **Action** | `QueryBalanceAcct`（⚠️ 不是 `QueryBalance`） |
| **Region** | `cn-beijing`（⚠️ 不是 `cn-north-1`） |
| **签名 SDK** | `volcenginesdkcore.SignerV4` |
| **关键陷阱** | AK/SK 顺序易反；`AKLT` 开头的是 Access Key ID |

---

## ⚠️ 已知问题与解决方案

### Q1: 发消息无响应 / 0 replies

**症状：** 群聊发消息后机器人不回复，日志显示 `replies=0`。

**原因：** plugins 配置冲突。`plugins.entries.feishu.enabled` 可能为 `true`，导致消息被 feishu 通道而非 openclaw-lark 插件处理。

**解决：**
```json
{
  "plugins": {
    "entries": {
      "openclaw-lark": { "enabled": true },
      "feishu": { "enabled": false }
    },
    "allow": ["openclaw-lark"]
  }
}
```

### Q2: 🚀首token 不显示

**症状：** Footer 中 `🚀首token 0s` 始终显示为 0。

**原因：** `onDeliver()` 和 `onTokenEvent()` 中缺少 `firstContentTime` 的捕获逻辑。

**解决：** 确保 `003-streaming-card-controller.patch` 已应用。补丁在以下位置添加了 `_firstContentTime` 捕获：
- `onDeliver()`: 首个 deliver payload 到达时
- `onTokenEvent()`: 首次检测到 token 时

### Q3: cacheWrite 始终是 0

**症状：** Footer 中 `缓存 X/0` 的 cacheWrite 一直是 0。

**原因：** session store 不跟踪 cacheWrite 指标。builder.js 自动将 cacheWrite 计算为 `inputTokens + outputTokens` 的估算值。

**解决：** 不需要操作。builder 在 `formatFooterRuntimeSegments()` 中已实现了安全回退逻辑：
```javascript
const cw = typeof metrics?.cacheWrite === 'number'
  ? fmt(metrics.cacheWrite)
  : fmt((metrics?.inputTokens || 0) + (metrics?.outputTokens || 0));
```

### Q4: allTimeTokens 比 month 小

**症状：** Footer 显示 `🪙Token 今/月/总: 5k丨128k丨50k`（allTime < month）。

**原因：** 数据源不一致或 allTimeTokens 被重置。builder 使用 `Math.max(month, allTime, today)` 作为安全保护。

**解决：** `001-builder.patch` 中的 builder.js 使用：
```javascript
const safeTotal = Math.max(
  footerMetrics?.totalTokensGlobal || 0,
  footerMetrics?.monthTokens || 0,
  footerMetrics?.todayTokens || 0
);
```
确保直通显示时 allTime 不会低于 month。

### Q5: 余额不显示

**症状：** Footer 中缺少 `💰` 行。

**原因：**
1. `balance-cache.json` 不存在或格式不正确
2. 模型名称与余额查询平台不匹配

**解决：**
```bash
# 检查缓存文件
cat ~/.openclaw/balance-cache.json

# 运行余额查询
python3 scripts/balance-check.py

# 检查 builder.js 中的平台匹配逻辑
# deepseek/xxx → DeepSeek, bailian/xxx → 阿里百炼, 等
```

### Q6: 费用与实际不符

**症状：** Footer 显示的 cacheRead 费用与实际账单不符。

**原因：** `cacheRead` 是 session store 中的累计值（自会话开始以来的总计），但 footer 显示的是单次请求的 cache 费用。Builder 自动对 cacheRead 进行上限处理，确保不超过本次请求的 token 消耗。

**解决：** 不需要操作。builder 使用 `Math.min(cacheRead, inputTokens + outputTokens)` 确保费用分解合理。

### Q7: 群聊不回消息（v5.6 专属）

**症状：** v5.6 群聊不回消息，日志显示 replyMode 被锁定为 `'static'`。

**原因：** v5.6 的 `expandAutoMode()` 函数将群聊 replyMode 强制转为 `'static'`。

**解决：** 在 `channels.feishu` 中显式设置：
```json
"replyMode": {
  "default": "auto",
  "direct": "streaming",
  "group": "streaming"
}
```

### Q9: npx install 覆盖 openclaw.json

**症状：** 运行 `npx -y @larksuite/openclaw-lark@2026.5.13 install` 后，`openclaw.json` 被重写为 minimal 配置，groupPolicy、footer、streaming 等自定义字段全部丢失。

**原因：** `npx install` 的文件生成逻辑包含配置写入步骤，它会用最小合法配置覆盖现有 `openclaw.json`。

**解决：**
```bash
# 安装前备份
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.pre-npx

# 安装后恢复（如果 npx 自己做了备份）
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
```

### Q10: event-bus.js 找不到导致卡片不工作

**症状：** 日志显示 `Error: Cannot find module '../channel/event-bus.js'`，或 Footer 不显示。

**原因：** `streaming-card-controller.js`（补丁版）依赖 `src/channel/event-bus.js` 来 publish `session_tokens_accrued` 事件，但 v2026.5.7 的飞书插件**移除了这个文件**。

**解决：** 从 `src/channel/event-bus.js` 手动复制到插件目录：
```bash
cp src/channel/event-bus.js ~/.openclaw/extensions/openclaw-lark/src/channel/event-bus.js
```

### Q11: 龙虾报告的插件版本是 2026.4.10（但实际安装的是 2026.5.7）

**症状：** LLM agent（如龙虾）报告插件版本为 2026.4.10，但 `package.json` 和 `openclaw plugins list` 都显示 2026.5.7。

**原因：** `.npm/_npx/` 缓存中可能残留旧版 v2026.4.10 的副本，agent 的 shell 命令读取到了这些缓存。

**解决：** 清理 npx 旧缓存：
```bash
# 删除所有 v4.10 缓存（保留 v5.7）
rm -rf ~/.npm/_npx/*4.10*/
```

### Q12: 凭证管理

所有 API 凭证应存储在隐私目录 `~/.hermes/data/` 下，权限 600：
```bash
chmod 600 ~/.hermes/data/volcengine-credentials.json
chmod 600 ~/.hermes/data/aliyun-credentials.json
```

---

## 💡 审计与维护知识

以下知识记录在审计追踪中，供 AI 助手维护时参考。

### allTimeTokens 修复方案

**问题：** `token-stats.json` 中的 allTimeTokens 在跨天后被 builder 重置为 0。

**修复文件：**
- `src/channel/token-aggregator.js`（插件通道版）— 添加 `allTimeTokens` 字段的持久化读/写/累加
- `token-aggregator/token-aggregator.js`（独立版）— 添加 `allTimeTokens` 种子值和累计逻辑

**修复要点：**
- allTimeTokens 只增不减，永不重置
- 使用 `Math.max(current, new)` 确保不会丢失历史数据
- 跨天时 allTimeTokens 保持原有值

### First Token Latency 捕获时机

**问题：** `🚀首token` 始终为 0，因为 `_firstContentTime` 只在 `onTokenEvent` 中设置，但部分场景 token 通过 `onDeliver` 到达。

**修复文件：** `src/card/streaming-card-controller.js`

**捕获时机：**
1. `onDeliver()`: 首个 deliver payload 到达时
2. `onTokenEvent()`: 首次检测到输入/输出 token 时
3. `onPartialReply()`/`onReasoningStream()`: 首次收到内容时

### Proactive Card Creation

**问题：** 卡片创建在 agent 首次 deliver 时才触发，导致用户看到空白或延迟。

**修复文件：** `src/card/reply-dispatcher.js`

**机制：** 在 dispatcher 创建后立即通过 `setImmediate()` 调用 `controller.ensureCardCreated()`，提前创建卡片。

---

## 📅 定时任务参考

### 余额查询（每2小时）

```bash
python3 /home/wzgrx/.hermes/scripts/balance-check.py

# Hermes Agent cron 配置
cronjob action=create schedule="every 2h" name="余额更新" \
  prompt="执行 ~/.hermes/scripts/balance-check.py，输出 JSON 格式结果"
```

### 模型注册表（每天 3:00）

```bash
python3 /home/wzgrx/.hermes/scripts/model-fetcher.py
```

### DeepSeek 价格监控（每天 9:01）

```bash
python3 /home/wzgrx/.hermes/scripts/deepseek-pricing-watch.py
```

---

## 🤖 AI 自动适配指南（供 AI 助手使用）

> 以下内容专为 AI 代码助手设计。收到本仓库 URL 或部署请求时，按此流程执行。

### AI 部署指令

```markdown
<!-- AI DEPLOY: openclaw-feishu-card-footer -->

步骤 1: 检测环境
  - openclaw --version → 获取版本号
    - v2026.5.2 → 未维护
    - v2026.5.3 → 使用 v5.3 补丁
    - v2026.5.6 → 使用 v5.6 补丁（src/ 完整覆盖）
    - v2026.5.7 ~ v2026.5.12 → 使用 src/ 完整覆盖（见下方 步骤4）
  - node --version → 若 v22+ 需注意 compile cache

步骤 2: 停止 systemd 服务（如存在）
  systemctl --user stop openclaw-gateway.service

步骤 3: 安装/确认插件（v5.7 用 npx，其他用 openclaw plugins install）
  - v5.2: (已停止维护)
  - v5.3/v5.6: openclaw plugins install @larksuite/openclaw-lark
  - v5.7 ~ v2026.5.12: cd ~/.openclaw && npx -y @larksuite/openclaw-lark@2026.5.13 install --version 2026.5.13 --tools-version 1.0.45
    ⚠️ npx install 会重写 openclaw.json！安装后立即恢复配置备份

步骤 4: v5.7+ 适配流程（src/ 完整覆盖）
  PLUGIN_DIR=~/.openclaw/extensions/openclaw-lark

  a. 覆盖补丁后的源文件
     cp src/card/builder.js "$PLUGIN_DIR/src/card/builder.js"
     cp src/card/reply-dispatcher.js "$PLUGIN_DIR/src/card/reply-dispatcher.js"
     cp src/card/streaming-card-controller.js "$PLUGIN_DIR/src/card/streaming-card-controller.js"

  b. 补充 event-bus.js（新版插件可能移除了该文件，streaming-card-controller 依赖它发布 session_tokens_accrued 事件）
     mkdir -p "$PLUGIN_DIR/src/channel/"
     cp src/channel/event-bus.js "$PLUGIN_DIR/src/channel/event-bus.js"

  c. 替换 gate.js（群聊免 @ 回复 + 配置继承逻辑）
     cp src/messaging/inbound/gate.js "$PLUGIN_DIR/src/messaging/inbound/gate.js"

  d. 安装通道组件
     mkdir -p ~/.openclaw/channels/feishu
     cp src/channel/* ~/.openclaw/channels/feishu/

  e. 验证 JS 语法
     for f in builder.js reply-dispatcher.js streaming-card-controller.js; do
       node --check "$PLUGIN_DIR/src/card/$f" || exit 1
     done
     node --check "$PLUGIN_DIR/src/channel/event-bus.js" || exit 1
     node --check "$PLUGIN_DIR/src/messaging/inbound/gate.js" || exit 1

步骤 5: 写 openclaw.json（v5.7 配置说明）
  - channels.feishu 下可以配置 groupPolicy/requireMention/footer/streaming/renderMode/replyMode
    （插件加载后由插件自己消费，核心不会拒绝）
  - 必须删除 plugins.entries.feishu（旧版插件引用，核心会报 warning）
  - 参考配置模板（见 ⚙️ 配置参考）

步骤 6: 清除缓存 + 重启
  - rm -rf ~/.openclaw/.jit-cache/
  - systemctl --user restart openclaw-gateway

步骤 7: 验证
  - 检查日志: journalctl --user -u openclaw-gateway --no-pager -n 30
  - greplog: grep -E "feishu.*WebSocket.*started|feishu.*open_id" /tmp/openclaw-1000/openclaw-*.log
  - 确认插件版本: openclaw plugins list | grep openclaw-lark
  - 清理 npm 旧缓存: rm -rf ~/.npm/_npx/*2026.4.10*/（避免读取旧版信息）
  - 发送群聊消息，确认 6-line footer 显示
  - 验证 allTimeTokens 不为 0，🚀首token 不为 0s
```

---

## 📝 版本历史

| 版本 | OpenClaw 版本 | 发布日期 | 主要变更 |
|------|---------------|----------|----------|
| v5.12 | v2026.5.12-beta.6 | 2026-05-14 | 🎉 适配 plugin@2026.5.13 · 内置 session key workaround · threadId 支持 · gate 策略增强 |
| v5.7 | v2026.5.7 | 2026-05-10 | 6-Line Footer · First-token latency fix · allTimeTokens · Proactive card creation · 完整 systemd 支持 |
| v5.6 | v2026.5.6 | — | Footer/streaming 配置迁移至全局 messages · replyMode 显式配置需求 |
| v5.3 | v2026.5.3 | — | 补充缺失函数 · 补丁版部署 |
| v5.2 | v2026.5.2 | — | 初始版本（已停止维护） |

---

## 📄 许可证

MIT
