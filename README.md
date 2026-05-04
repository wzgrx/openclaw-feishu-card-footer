# OpenClaw Feishu Card Footer — 飞书卡片页脚增强

[![OpenClaw](https://img.shields.io/badge/OpenClaw-v5.2%20|%20v5.3-blue)](https://openclaw.nousresearch.com)
[![@larksuite/openclaw-lark](https://img.shields.io/badge/%40larksuite%2Fopenclaw--lark-%3E%3D2026.4.10-green)](https://www.npmjs.com/package/@larksuite/openclaw-lark)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**OpenClaw** × **飞书 (Feishu/Lark)** 卡片消息页脚增强组件。
在群聊机器人卡片底部显示完整 AI 对话指标：状态、耗时、费用分解、Token 统计、余额。

---

## 📋 功能特性

| 功能 | Emoji | 说明 |
|------|-------|------|
| **完成状态** | ✅ / ❌ / ⏳ | 调用成功、失败或进行中 |
| **耗时** | ⏳️ | 端到端请求耗时 |
| **费用分解** | 💸 | 输入费用 + 输出费用 + 缓存费用（基于实时/配置定价） |
| **首Token延迟** | 🚀 | TTFT（Time To First Token） |
| **Token 计数** | ↑ ↓ | 输入（上行）与输出（下行）Token 数量 |
| **缓存命中** | 缓存 X/Y | 缓存命中/总 Token 及命中率 |
| **上下文窗口** | 📑 | 已用 Token / 最大窗口 + 百分比 |
| **日/月累计** | 🪙 | 今日 Token / 本月 Token + 时间戳 |
| **余额显示** | 💰 | 自动匹配模型对应平台的账户余额 |

### 🖼️ Footer 布局

```
Line 1:  ✅ 已完成 · ⏳️ 5.2s · DeepSeek Flash
Line 2:  💸 ¥0.002 = 入¥0.001 + 出¥0.001 + 缓存¥0.001 · 🚀首token 1.20s
Line 3:  ↑ 1.2K ↓ 500 · 缓存 300/100 (75%) · 📑 1.7K/32K (5%) · 🪙 5.2K丨128.3K · 20:09
Line 4:  💰 DeepSeek ¥205.11
```

---

## 🚀 快速开始

### 前置条件

- OpenClaw `v2026.5.2` 或 `v2026.5.3`
- `@larksuite/openclaw-lark` `v2026.4.10+`
- Node.js `>= 18.0`

### 自动部署（推荐）

```bash
git clone https://github.com/wzgrx/openclaw-feishu-card-footer.git
cd openclaw-feishu-card-footer
bash auto-patch.sh
```

脚本会自动完成：
1. 检测 OpenClaw 版本（v5.2 / v5.3）
2. 若插件未安装则自动安装
3. 备份原始文件
4. 加载对应版本的补丁
5. 部署 Token 聚合器守护进程
6. 重启网关

### 手动部署

#### OpenClaw v5.2

```bash
# 1. 安装飞书插件
npm install -g @larksuite/openclaw-lark@^2026.4.10

# 2. 应用补丁
cp -r patches/v5.2/* /usr/lib/node_modules/@larksuite/openclaw-lark/

# 3. 安装 Token 聚合器
mkdir -p ~/.openclaw/channels/feishu
cp token-aggregator/*.js ~/.openclaw/channels/feishu/

# 4. 安装守护进程
cp scripts/openclaw-token-aggregator.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now openclaw-token-aggregator

# 5. 重启网关
systemctl --user restart openclaw-gateway
```

#### OpenClaw v5.3

```bash
# 1. 安装飞书插件（通过 OpenClaw 插件管理）
echo "Y" | openclaw plugins install @larksuite/openclaw-lark@2026.4.10

# 2. 应用补丁
cp -r patches/v5.3/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/

# 3. 补齐 v5.3 缺失的函数（重要！）
#    v5.3 版本的源码缺少 buildStreamingThinkingCard 和
#    buildStreamingPreAnswerCard，需从 patches/v5.3/missing-functions.js 补回
cp patches/v5.3/missing-functions.js \
   ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/src/card/

# 4. 安装 Token 聚合器 & 守护进程
#    同 v5.2

# 5. 重启网关
systemctl --user restart openclaw-gateway
```

---

## 🤖 AI 自动适配指南

> 以下内容专为 AI 代码助手设计，当收到本仓库 URL 时可自动执行适配部署。

### AI 部署指令

```markdown
<!-- AI DEPLOY: openclaw-feishu-card-footer -->
<!-- 目标: 为 OpenClaw 飞书机器人卡片添加增强 Footer -->

步骤 1: 检测环境
  - 执行 `openclaw --version` 获取版本号
  - 若为 v2026.5.x → 提取主版本 5.2 或 5.3
  - 检查 `@larksuite/openclaw-lark` 是否已安装

步骤 2: 定位插件目录
  - v5.2: `/usr/lib/node_modules/@larksuite/openclaw-lark/`
  - v5.3: `~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/`
  - 若不存在: 先安装 `openclaw plugins install @larksuite/openclaw-lark@2026.4.10`

步骤 3: 补丁文件列表
  | 文件 | 修改内容 |
  |------|----------|
  | `src/core/footer-config.js` | 默认开启所有 footer 字段 |
  | `src/card/builder.js` | 4行格式 formatFooterRuntimeSegments + 余额查询 |
  | `src/card/streaming-card-controller.js` | 定价参数独立传递 |
  | `src/card/reply-dispatcher.js` | 强制卡片模式 + 可见回复 |

步骤 4: v5.3 专属修复
  - builder.js 缺少 `buildStreamingThinkingCard` → 需在
    `buildStreamingToolUsePendingPanel` 上方插入定义
  - streaming-card-controller.js 需将 `inputPrice/outputPrice/cacheReadPrice`
    作为独立参数传递给 buildCardContent（不合并进 footerMetrics）

步骤 5: 验证
  - 重启网关
  - 发送测试消息，检查卡片底部 4 行 Footer 是否完整显示
  - 检查日志是否有 `ReferenceError` 或 `final card update failed`

步骤 6: 安装 Token 聚合器（可选，用于 🪙 日/月统计）
  - 复制 token-aggregator.js 至 `~/.openclaw/channels/feishu/`
  - 创建 systemd user 服务并启动
```

### AI 补丁逻辑（伪代码）

```python
def deploy_footer_patch():
    version = detect_openclaw_version()
    plugin_dir = get_plugin_dir(version)
    
    if version == "5.3":
        # Missing functions in v5.3 source
        inject_missing_functions(plugin_dir + "/src/card/builder.js")
    
    patches = load_patches(version)
    for patch in patches:
        apply_patch(plugin_dir, patch)
    
    install_token_aggregator()
    
    restart_gateway()
    verify_footer()
```

---

## 🏗️ 架构

### 文件结构

```
├── auto-patch.sh                 # 全自动部署脚本（版本检测 + 补丁 + 重启）
├── patches/
│   ├── v5.2/                     # OpenClaw v2026.5.2 补丁
│   │   ├── 001-footer-config.patch
│   │   ├── 002-builder.patch
│   │   ├── 003-streaming-card-controller.patch
│   │   ├── 004-reply-dispatcher.patch
│   │   ├── 005-monitor.patch
│   │   └── 006-token-aggregator.patch
│   └── v5.3/                     # OpenClaw v2026.5.3 补丁
│       ├── 001-footer-config.patch
│       ├── 002-builder.patch
│       ├── 003-streaming-card-controller.patch
│       ├── 004-reply-dispatcher.patch
│       ├── 005-token-aggregator.patch
│       ├── 006-token-aggregator-daemon.patch
│       └── missing-functions.js
├── src/                          # 补丁后的完整源文件（参考）
│   ├── card/
│   │   ├── builder.js
│   │   ├── streaming-card-controller.js
│   │   └── reply-dispatcher.js
│   └── core/
│       └── footer-config.js
├── token-aggregator/             # Token 统计聚合器
│   ├── token-aggregator.js       # 事件式监听（插件热插拔）
│   └── token-aggregator-daemon.js # 守护扫描进程
├── scripts/
│   └── openclaw-token-aggregator.service  # systemd unit
├── openclaw.json.example         # 配置模板
└── README.md                     # 本文件
```

### 版本差异详解

| 维度 | v5.2 | v5.3 | 影响 |
|------|------|------|------|
| OpenClaw 版本 | v2026.5.2 | v2026.5.3 | 安装路径不同 |
| 插件安装方式 | `npm install -g` | `openclaw plugins install` | 路径从 `/usr/lib/` 变为 `~/.openclaw/npm/` |
| 插件形态 | 带 `dist/` 编译产物 | 纯源码（无 `dist/`） | v5.3 需补回缺失函数 |
| 流式卡片控制 | 全局构建函数 | 需单独传递定价参数 | streaming-card-controller.js 调用方式不同 |
| footer 配置位置 | `channels.feishu.footer` | 同上 | 不变 |

---

### Token 统计流

```
用户发消息 → OpenClaw 网关 → 飞书插件 → builder.js 构建卡片
                                    ↓
                          token-aggregator.js（事件监听）
                                    ↓
                          token-stats.json（日/月累计）
                                    ↓
                          formatFooterRuntimeSegments 读取并展示 🪙
```

### 余额数据流

```
balance-check.js（定时脚本）→ balance-cache.json
                                    ↓
                          getBalanceForModel() 读取
                                    ↓
                          formatFooterRuntimeSegments 展示 💰
```

---

## ⚙️ 配置参考

见 `openclaw.json.example`。

关键 Footer 配置（放在 `channels.feishu.footer` 下）：

```json
{
  "channels": {
    "feishu": {
      "footer": {
        "status": true,
        "elapsed": true,
        "tokens": true,
        "cache": true,
        "context": true,
        "model": true
      }
    }
  }
}
```

---

## 🔧 常见问题

### Q: 应用补丁后网关启动失败

检查日志:
```bash
journalctl --user -u openclaw-gateway --no-pager -n 50 | grep -i error
```

常见原因：
1. **v5.3 缺少函数**: `ReferenceError: buildStreamingThinkingCard is not defined` → 运行 `auto-patch.sh` 或手动补齐缺失函数
2. **定价参数传递错误**: `ReferenceError: providerName is not defined` → 确认 `streaming-card-controller.js` 中 `modelPrices` 作为独立参数传递
3. **插件路径错误**: 确认使用正确的插件目录

### Q: Footer 不显示

- 确认 `channels.feishu.streaming: true` 已启用
- 确认 `channels.feishu.footer` 配置正确
- 确认日志无错误
- 检查 `reply-mode.js` 中回复模式是否为 `streaming`

---

## 📄 License

MIT
