# OpenClaw Feishu Card Footer — 飞书卡片页脚增强

[![OpenClaw](https://img.shields.io/badge/OpenClaw-v2026.5.19--beta.2-blue)](https://openclaw.nousresearch.com)
[![@larksuite/openclaw-lark](https://img.shields.io/badge/%40larksuite%2Fopenclaw--lark-v2026.5.20--beta.0-green)](https://www.npmjs.com/package/@larksuite/openclaw-lark)
[![Node.js](https://img.shields.io/badge/Node.js-LTS-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**OpenClaw** × **飞书 (Feishu/Lark)** 卡片消息页脚增强组件。
**适配 OpenClaw 核心 v2026.5.20 + @larksuite/openclaw-lark@2026.5.20-beta.0。**
在群聊机器人卡片底部显示完整 AI 对话指标：6 行详细数据覆盖状态、耗时、费用分解、Token 统计、余额。

---

## 📌 版本说明（必读）

| 简称 | 全称 | 安装方式 | 说明 |
|------|------|----------|------|
| **OpenClaw `v5.13` ~ `v5.19`** | **OpenClaw 核心** `v2026.5.13` ~ `v2026.5.19` | `openclaw --version` 查看 | 当前适配版本 |
| **插件 `v2026.5.20`（当前）** | **`@larksuite/openclaw-lark@2026.5.20-beta.0`** | `npx -y @larksuite/openclaw-lark@2026.5.20-beta.0 install --version 2026.5.20-beta.0 --tools-version 1.0.45` | 适配 OpenClaw v2026.5.20 |
| **插件 `v2026.5.13`（旧版存档）** | **`@larksuite/openclaw-lark@2026.5.13`** | `npx -y @larksuite/openclaw-lark@2026.5.13 install --version 2026.5.13 --tools-version 1.0.45` | 适配 OpenClaw v2026.5.12 |
| **Hermes Agent** | **Hermes** | — | ⚠️ 独立项目，仅用于读取 `balance-cache.json（累计费用）` |

## 🖥️ 基础环境要求

| 组件 | 要求 |
|------|------|
| **操作系统** | Linux / WSL2 Ubuntu |
| **OpenClaw** | `v2026.5.20`（推荐） |
| **Node.js** | **最新 LTS**（推荐 v24.15+） |
| **飞书插件** | `@larksuite/openclaw-lark@2026.5.20-beta.0` |
| **Hermes Agent（可选）** | 用于读取累计费用数据（`balance-cache.json`），非必装 |

### 插件安装

```bash
# 安装 2026.5.20-beta.0 版本
npx -y @larksuite/openclaw-lark@2026.5.20-beta.0 install --version 2026.5.20-beta.0 --tools-version 1.0.45

# 安装目录：~/.openclaw/extensions/openclaw-lark/
```

## 🎯 功能特性

卡片完成回复后，在底部显示 6 行详细数据：

```
🪙Token 今/月/总: 531.2k/90.6M/90.6M · 5/20-22:06
──────────────────
✅ 已完成 · ⏳️ 22.3s · 🚀首token 21.75s
💸 ¥0.01 = 入¥0.0036 + 出¥0.0035 + 缓存¥0.0054
📑 本次 265.7k/1.0M (27%)·本轮 ↑ 3.6k ↓ 1.8k·缓存 264.8k
💰 DeepSeek·¥143.09·deepseek-v4-flash
```

| 行 | 内容 | 数据来源 |
|----|------|----------|
| 1 🪙 | 今日/月/累计 Token 数 + 时间戳 | `~/.openclaw/token-stats.json` |
| 2 ─── | 分隔线 | — |
| 3 ✅ | 状态 + 耗时 + 首token延迟 | `StreamingCardController` |
| 4 💸 | 本次会话费用分解 | Session store + 模型定价 |
| 5 📑 | 上下文窗口 + Token 明细 + 缓存 | Session store |
| 6 💰 | 平台累计费用 + 模型名 | `~/.hermes/data/balance-cache.json` |

## 🔧 适配方式

本项目采用 **直接源码覆盖** 方式适配（代替旧版的 patch 方案）。

### 文件清单

**修改的文件（6个，基于官方 beta.0）：**

| 文件 | 修改内容 |
|------|----------|
| `src/core/footer-config.js` | 默认值全 `true`（opt-out 模式），新增 `cost`/`todayTokens`/`monthTokens` 字段 |
| `src/card/builder.js` | 完整 6-line 页脚渲染（global tokens + separator + status+first-token + cost + context + provider） |
| `src/card/streaming-card-controller.js` | 首token 延迟追踪；`_publishTokenEvent`；移除 `dispatchFullyComplete` 门控 |
| `src/card/reply-dispatcher.js` | `onIdle` 移除 `dispatchFullyComplete` 检查，确保 complete card 始终构建 |
| `src/card/reply-mode.js` | **龙虾补丁**：群聊启用流式卡片（移除 group→static 映射） |
| `src/channel/monitor.js` | TokenAggregator 启动 + 健康检查 |

**新增的文件（3个）：**

| 文件 | 用途 |
|------|------|
| `src/channel/event-bus.js` | Token 事件发布总线 |
| `src/channel/token-aggregator.js` | Token 聚合服务 |
| `src/channel/token-aggregator-daemon.js` | Token 聚合守护进程 |

### 部署步骤

```bash
# 1. 安装插件
npx -y @larksuite/openclaw-lark@2026.5.20-beta.0 install --version 2026.5.20-beta.0 --tools-version 1.0.45

# 2. 覆盖源码
# 将本仓库 src/ 目录下文件覆盖到 ~/.openclaw/extensions/openclaw-lark/src/

# 3. 清除 jiti 缓存
rm -rf ~/.openclaw/extensions/openclaw-lark/node_modules/.cache/jiti/

# 4. 重启 gateway
systemctl --user restart openclaw-gateway
```

### 快速部署脚本

```bash
# 从 GitHub 拉取并部署
git clone https://github.com/wzgrx/openclaw-feishu-card-footer.git
cd openclaw-feishu-card-footer
cp -r src/* ~/.openclaw/extensions/openclaw-lark/src/
rm -rf ~/.openclaw/extensions/openclaw-lark/node_modules/.cache/jiti/
systemctl --user restart openclaw-gateway
```

## 📊 数据流架构

```
Agent回复 → streaming-card-controller.onIdle()
  ├─ getFooterSessionMetrics() → 读取 session store
  ├─ _publishTokenEvent(footerMetrics)
  │    └─ event-bus.publish → TokenAggregator → token-stats.json
  └─ buildCardContent('complete', { footerMetrics, firstTokenLatencyMs })
       ├─ 读取 ~/.openclaw/token-stats.json（🪙 全局Token统计）
       ├─ 读取 ~/.hermes/data/balance-cache.json（💰 累计费用）
       └─ 渲染 6-line footer → updateCardKitCard()
```

### 配置文件参考

`~/.openclaw/openclaw.json` 中飞书通道配置：

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "enabled": true,
      "streaming": true,
      "footer": {
        "status": true,
        "elapsed": true,
        "tokens": true,
        "cache": true,
        "context": true,
        "model": true,
        "cost": true,
        "todayTokens": true,
        "monthTokens": true
      },
      "replyMode": "auto"
    }
  }
}
```

## 🧹 维护

### 更新后清缓存

```bash
rm -rf ~/.openclaw/extensions/openclaw-lark/node_modules/.cache/jiti/
systemctl --user restart openclaw-gateway
```

### 查看日志

```bash
journalctl --user -u openclaw-gateway -f | grep "card\|footer"
```

## 🔄 版本迁移历史

| 时间 | 旧版 | 新版 | 主要变更 |
|------|------|------|----------|
| 2026-05-20 | `2026.5.13` | `2026.5.20-beta.0` | 完整重写适配：新增 `formatFooterRuntimeSegments`、`_publishTokenEvent`、TokenAggregator、群聊流式修复、首token延迟追踪 |
| 2026-05-13 | `2026.4.10` | `2026.5.13` | 安装方式改为 `npx install`，插件路径改为 `extensions/` 目录 |
| 2026-05-07 | `2026.4.10` | `2026.5.7` | 5.7 完整重写，引入 event-bus + token-aggregator 事件链 |
| 2026-05-03 | `v5.6` | `2026.4.10` | 6-line 格式定型，分开 `本次上下文` vs `↑↓ token` |
| 2026-04-xx | `v5.3` | `v5.6` | 新增首token延迟、余额显示、模型注册表 |
| 2026-04-xx | — | `v5.3` | 首个版本：飞书卡片 Footer 增强 |

## 📄 License

MIT
