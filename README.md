# OpenClaw Feishu Card Footer — 飞书卡片页脚增强

[![OpenClaw](https://img.shields.io/badge/OpenClaw-v2026.5.2%20|%20v2026.5.3%20|%20v2026.5.6-blue)](https://openclaw.nousresearch.com)
[![@larksuite/openclaw-lark](https://img.shields.io/badge/%40larksuite%2Fopenclaw--lark-%3E%3D2026.4.10-green)](https://www.npmjs.com/package/@larksuite/openclaw-lark)
[![Node.js](https://img.shields.io/badge/Node.js-LTS-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**OpenClaw** × **飞书 (Feishu/Lark)** 卡片消息页脚增强组件。
在群聊机器人卡片底部显示完整 AI 对话指标：状态、耗时、费用分解、Token 统计、余额。

---

## 🖥️ 基础环境说明

### 运行环境要求

| 组件 | 要求 | 说明 |
|------|------|------|
| **操作系统** | Linux / WSL2 Ubuntu | 支持 systemd user 服务 |
| **OpenClaw** | `v2026.5.2` / `v2026.5.3` / `v2026.5.6` | 通过 `openclaw --version` 查看 |
| **Node.js** | **最新 LTS**（当前 v24.15.0） | 推荐通过 NVM 安装：`nvm install --lts` |
| **飞书插件** | `@larksuite/openclaw-lark` `>= 2026.4.10` | ⚠️ 必须官方插件，不可用 `@openclaw/feishu` |
| **systemd** | user 级别（`--user`） | Token 聚合器守护进程 + 网关服务 |

### Node.js 重要规范

- ⚠️ **Node v22+ 必须设置 `NODE_DISABLE_COMPILE_CACHE=1`** 避免 compile cache 冲突
- 通过 NVM 管理版本，升级后需重新安装 `@larksuite/openclaw-lark`：
  ```bash
  nvm install --lts
  npm install -g @larksuite/openclaw-lark@2026.4.10
  ```

### 插件安装路径（版本差异）

| 版本 | 安装方式 | 插件目录 |
|------|----------|----------|
| v2026.5.2 | `npm install -g` | `/usr/lib/node_modules/@larksuite/openclaw-lark/` |
| v2026.5.3 | `openclaw plugins install` | `~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/` |
| v2026.5.6 | `openclaw plugins install` | `~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/` |

### 目录结构约定

```
~/.openclaw/
├── openclaw.json                    # 主配置文件
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
        ├── token-aggregator.js      # Token 聚合器（非官方，需注入）
        ├── token-aggregator-daemon.js
        ├── event-bus.js
        └── monitor.js
```

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
Line 1:  ✅ 已完成 · ⏳️ 5.2s · deepseek-v4-flash
Line 2:  💸 ¥0.002 = 入¥0.001 + 出¥0.001 + 缓存¥0.001 · 🚀首token 1.20s
Line 3:  ↑ 1.2K ↓ 500 · 缓存 300/100 (75%) · 📑 1.7K/32K (5%) · 🪙 5.2K丨128.3K · 20:09
Line 4:  💰 DeepSeek ¥205.11
```

---

## 🚀 快速开始

### 前置条件

- OpenClaw `v2026.5.2` / `v2026.5.3` / `v2026.5.6`
- `@larksuite/openclaw-lark` `v2026.4.10+`
- Node.js **最新 LTS**（当前 v24.15.0，通过 nvm 安装）
  - ⚠️ Node v22+ 需设置 `NODE_DISABLE_COMPILE_CACHE=1` 避免 compile cache 冲突
  - 安装命令：`nvm install --lts`

### 自动部署（推荐）

```bash
git clone https://github.com/wzgrx/openclaw-feishu-card-footer.git
cd openclaw-feishu-card-footer
bash auto-patch.sh
```

脚本会自动完成：
1. 检测 OpenClaw 版本（v5.2 / v5.3 / v5.6）
2. 若插件未安装则自动安装
3. 备份原始文件
4. 加载对应版本的补丁
5. 部署 Token 聚合器守护进程
6. 重启网关

### 手动部署

<details>
<summary>OpenClaw v2026.5.6（最新版）</summary>

```bash
# 1. 安装飞书插件
echo "Y" | openclaw plugins install @larksuite/openclaw-lark@2026.4.10

# 2. 停止 systemd 服务（如存在，避免端口冲突）
systemctl --user stop openclaw-gateway.service 2>/dev/null || true

# 3. 应用补丁（覆盖核心文件）
cp src/core/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/src/core/
cp src/card/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/src/card/

# 4. 注入非官方扩展组件（必须！官方插件不包含这些文件）
mkdir -p ~/.openclaw/channels/feishu
cp src/channel/* ~/.openclaw/channels/feishu/

# 5. 清除 JITI 缓存（重要！否则旧代码仍生效）
rm -rf ~/.openclaw/.jit-cache/

# 6. 配置 replyMode（v5.6 必须！否则群聊不回消息）
# 在 openclaw.json 的 channels.feishu 中显式设置:
#   "replyMode": { "group": "streaming" }

# 7. 重启网关
systemctl --user restart openclaw-gateway
```

</details>

<details>
<summary>OpenClaw v2026.5.3</summary>

```bash
# 1. 安装飞书插件
openclaw plugins install @larksuite/openclaw-lark@2026.4.10

# 2. 停止 systemd 服务（如存在）
systemctl --user stop openclaw-gateway.service 2>/dev/null || true

# 3. 应用补丁
cp -r patches/v5.3/* ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/

# 4. 清除 JITI 缓存
rm -rf ~/.openclaw/.jit-cache/

# 5. 注入 Token 聚合器组件
mkdir -p ~/.openclaw/channels/feishu
cp src/channel/* ~/.openclaw/channels/feishu/

# 6. 重启网关
systemctl --user restart openclaw-gateway
```

</details>

<details>
<summary>OpenClaw v2026.5.2（已停止维护）</summary>

v5.2 版本的补丁仍在 `patches/v5.2/` 目录中，但不再推荐使用。

</details>

---

## ⚙️ 配置参考

### 🚨 v5.3/v5.6 配置位置变动（重要！）

自 v5.3 起，**footer/streaming 配置已从 `channels.feishu` 移至全局 `messages` 段**。在 `channels.feishu` 下不再支持配置流式/Footer 开关。

**✅ 正确配置（v5.3/v5.6 必需）：**

```json
{
  "messages": {
    "visibleReplies": "automatic",
    "stream": true,
    "streamChunkSize": 20,
    "streamInterval": 100,
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
    }
  },
  "channels": {
    "feishu": {
      "app_id": "...",
      "app_secret": "..."
    }
  }
}
```

> ⚠️ `visibleReplies: "automatic"` 是**强制要求**，否则 Agent 会降级到 `send` 工具路径导致非流式回复，Footer 不显示。
> ⚠️ 不要在 `channels.feishu` 下再配 `streaming` / `footer`。

### 🔥 v5.6 replyMode 配置（关键！）

v5.6 引入了 `expandAutoMode()` 函数，会将群聊的 replyMode 默认强制转为 `'static'`，导致**群聊不回消息**。

**解决方案**：在 `channels.feishu` 中显式覆盖：

```json
{
  "channels": {
    "feishu": {
      "replyMode": {
        "default": "auto",
        "direct": "streaming",
        "group": "streaming"
      }
    }
  }
}
```

### 模型定价配置

定价数据在 `models.providers` 的 `cost` 字段配置。参考 `openclaw.json.example`。

---

## 🏗️ 架构

### 文件结构

```
├── auto-patch.sh                 # 全自动部署脚本（v5.2/v5.3/v5.6 自动检测）
├── patches/
│   ├── v5.2/                     # OpenClaw v2026.5.2 补丁
│   └── v5.3/                     # OpenClaw v2026.5.3 补丁
│       ├── 001-footer-config.patch
│       ├── 002-builder.patch
│       ├── 003-streaming-card-controller.patch
│       ├── 004-reply-dispatcher.patch
│       └── missing-functions.js   # v5.3 源码缺失的构建函数
├── src/                          # 补丁后的完整源文件（参考/覆盖用）
│   ├── card/
│   │   ├── builder.js            # 卡片构建 + Footer 渲染
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
│   ├── balance-check.py          # 余额查询（4平台 + 火山引擎）
│   ├── balance-check.js          # 余额查询（Node版）
│   ├── model-fetcher.py          # 模型注册表更新
│   ├── pricing_db.py             # 模型定价库
│   ├── deepseek-pricing-watch.py # DeepSeek 价格监控
│   ├── sync-patches.sh           # 补丁同步工具
│   └── openclaw-token-aggregator.service
├── openclaw.json.example         # 配置模板
└── README.md                     # 本文件
```

### 版本差异详解

| 维度 | v5.2 | v5.3 | v5.6 |
|------|------|------|------|
| OpenClaw 版本 | v2026.5.2 | v2026.5.3 | v2026.5.6 |
| 插件安装方式 | `npm install -g` | `openclaw plugins install` | `openclaw plugins install` |
| 插件路径 | `/usr/lib/node_modules/` | `~/.openclaw/npm/` | `~/.openclaw/npm/` |
| 插件形态 | 带 `dist/` 编译产物 | 纯源码（无 `dist/`） | 纯源码（无 `dist/`） |
| 缺失函数 | 无 | `buildStreamingThinkingCard` | 无 |
| Footer 配置位置 | `channels.feishu.footer` | **`messages.footer`**（全局） | **`messages.footer`**（全局） |
| 流式配置位置 | `channels.feishu.streaming` | **`messages.stream`**（全局） | **`messages.stream`**（全局） |
| replyMode 默认 | 自动 | 自动 | **群聊默认 static** ⚠️ |
| systemd 服务 | 可选手动 | **自带 systemd user 服务** | **自带 systemd user 服务** |
| 自动重启 | — | 脚本自动管理 | 脚本自动管理 |

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
balance-check.py（cron 每2h）→ balance-cache.json
                                    ↓
                          builder.js 读取（HTTP 回退）
                                    ↓
                          getBalanceForModel() 匹配当前模型
                                    ↓
                          formatFooterRuntimeSegments 展示 💰
```

---

## 💰 各平台余额查询技术细节

### DeepSeek

| 项目 | 值 |
|------|-----|
| **端点** | `https://api.deepseek.com/user/balance` |
| **方法** | GET |
| **鉴权** | `Authorization: Bearer <API_KEY>` |
| **响应格式** | `{ "balance_infos": [{ "total_balance": "175.57", "topped_up_balance": "150.00", "granted_balance": "25.57", "currency": "CNY" }], "is_available": true }` |
| **Python 代码** | `fetch_json("https://api.deepseek.com/user/balance", {"Authorization": f"Bearer {DEEPSEEK_KEY}"})` |
| **Node.js (builder.js fallback)** | `fetchJSON('https://api.deepseek.com/user/balance', apiKey)` → `r.balance_infos[0].total_balance` |

### 硅基流动

| 项目 | 值 |
|------|-----|
| **端点** | `https://api.siliconflow.cn/v1/user/info` |
| **方法** | GET |
| **鉴权** | `Authorization: Bearer <API_KEY>` |
| **响应格式** | `{ "status": true, "data": { "totalBalance": 168.81, "chargeBalance": 100.00, "balance": 68.81, "currency": "CNY" } }` |
| **Python 代码** | `fetch_json("https://api.siliconflow.cn/v1/user/info", {"Authorization": f"Bearer {SILICONFLOW_KEY}"})` |

### 阿里百炼（两种方式）

**方式 A：DashScope API（推荐，无需额外 SDK）**

| 项目 | 值 |
|------|-----|
| **端点** | `https://dashscope.aliyuncs.com/api/v1/finance/balance` |
| **方法** | GET |
| **鉴权** | `Authorization: Bearer <DASHSCOPE_API_KEY>` |
| **额外头** | `X-DashScope-OpenAPISource: CloudSDK` |
| **响应格式** | `{ "data": { "availableAmount": "67.57" } }` |
| **代码** | `https.get('https://dashscope.aliyuncs.com/api/v1/finance/balance', { headers: { 'Authorization': 'Bearer <key>', 'X-DashScope-OpenAPISource': 'CloudSDK' } })` |

**方式 B：阿里云 BSS SDK（需要 RAM AK/SK + BssOpenApi 权限）**

| 项目 | 值 |
|------|-----|
| **端点** | `business.aliyuncs.com` |
| **SDK** | `alibabacloud_bssopenapi20171214` |
| **方法** | `QueryAccountBalance` |
| **代码** | `BssOpenApiClient(config).query_account_balance().body.data.available_amount` |

### 🔥 火山引擎（关键发现：易踩坑）

| 项目 | 值 |
|------|-----|
| **端点** | `https://billing.volcengineapi.com/` |
| **Action** | **`QueryBalanceAcct`**（⚠️ 不是 `QueryBalance`，这个不存在！） |
| **Version** | `2022-01-01` |
| **方法** | POST |
| **Region** | **`cn-beijing`**（⚠️ 不是 `cn-north-1`！） |
| **Content-Type** | **`application/json`**（⚠️ 不是 `application/x-www-form-urlencoded`！） |
| **Body** | `{}`（空 JSON 对象） |
| **签名 SDK** | **`volcenginesdkcore.SignerV4`**（⚠️ 不是 `volcengine.auth.SignerV4`，两者签名逻辑不同！） |

**凭证格式陷阱：**
- **Access Key ID**: `AKLT` 开头（如 `AKLTZTM1MDM1Nj...`）
- **Secret Access Key**: base64 编码字符串
- ⚠️ 用户经常把 AK 和 SK **写反** — `AKLT` 开头的是 Access Key ID，不是 Secret Access Key！

**Python 代码：**
```python
from volcenginesdkcore.signv4 import SignerV4
from six.moves.urllib.parse import urlencode
import requests, json

headers = {"Content-Type": "application/json", "Host": "billing.volcengineapi.com"}
body = json.dumps({})
query = [("Action", "QueryBalanceAcct"), ("Version", "2022-01-01")]
SignerV4.sign("/", "POST", headers, body, {}, query, AK, SK, "cn-beijing", "billing")
url = "https://billing.volcengineapi.com/?" + urlencode(query)
resp = requests.post(url, headers=headers, data=body, timeout=10)
balance = float(resp.json()["Result"]["AvailableBalance"])
```

**响应格式：**
```json
{
  "Result": {
    "AvailableBalance": "247.11",
    "CashBalance": "247.11",
    "FreezeAmount": "0",
    "CreditLimit": "0",
    "ArrearsBalance": "0"
  }
}
```

### getBalanceForModel() 匹配逻辑（builder.js）

```javascript
function getBalanceForModel(modelName) {
    // 1. 优先按 provider 前缀检测
    //    "deepseek/xxx" → DeepSeek
    //    "siliconflow/xxx" → 硅基流动
    //    "bailian/xxx" 或 "dashscope/xxx" → 阿里百炼
    //    "volcengine/xxx" 或 "ark/xxx" → 火山引擎
    
    // 2. 回退按模型 ID 前缀检测
    //    "deepseek*" → DeepSeek
    //    "qwen*"/"glm*"/"kimi*" → 阿里百炼
    //    "doubao*"/"seed*" → 火山引擎
}
```

---

## 📅 定时任务参考

### 余额查询（每2小时）

```bash
# 使用 balance-check.py（需要填入凭证）
python3 /home/wzgrx/.hermes/scripts/balance-check.py

# Hermes Agent cron 配置
cronjob action=create schedule="every 2h" name="余额更新" \
  prompt="执行 ~/.hermes/scripts/balance-check.py，输出 JSON 格式结果"
```

### 模型注册表（每天 3:00）

```bash
# 拉取 4 平台最新模型列表 + 定价同步
python3 /home/wzgrx/.hermes/scripts/model-fetcher.py

# 自动更新 openclaw.json 中的模型定价
# 输出摘要推送至飞书群聊
```

### DeepSeek 价格监控（每天 9:01）

```bash
python3 /home/wzgrx/.hermes/scripts/deepseek-pricing-watch.py
# 爬取 DeepSeek 官方定价页，涨价时自动更新 openclaw.json
```

---

## ⚠️ 已知问题与解决方案

### Q1: 应用补丁后网关启动失败

**检查日志：**
```bash
journalctl --user -u openclaw-gateway --no-pager -n 50 | grep -i error
```

**常见原因：**
1. **v5.3 缺少函数** — `ReferenceError: buildStreamingThinkingCard is not defined`
   → 运行 `auto-patch.sh` 或手动复制 `patches/v5.3/missing-functions.js`

2. **JITI 缓存未清除** — 旧缓存保留未打补丁的编译代码
   → 删除 `~/.openclaw/.jit-cache/`

3. **systemd 服务冲突** — v5.3+ 自带 systemd user service，手动启动前需停止：
   ```bash
   systemctl --user stop openclaw-gateway.service
   systemctl --user disable openclaw-gateway.service  # 可选：永久禁用
   ```

### Q2: Footer 不显示

- ✅ 确认 `messages.visibleReplies: "automatic"` 已配置（最关键！）
- ✅ 确认 `messages.footer` 配置正确（不是 `channels.feishu.footer`）
- ✅ 确认 `messages.stream: true`
- ✅ 清除 JITI 缓存后重启

### Q3: 只有 Line 1 显示（Agent 降级）

症状：日志显示 `dispatch complete (queuedFinal=false, replies=0)`

原因：Agent fallback 至 `send` 工具路径，未进入流式管线。

解决：
1. 确认 `messages.visibleReplies: "automatic"`（强制走流式）
2. 检查 `tools.alsoAllow` 是否错误覆盖了可见性限制
3. 日志应显示 `queuedFinal=true, replies=1`

### Q4: Node.js v24 性能问题

Node.js v22+ 引入了编译缓存（compile cache），在某些环境下与 OpenClaw 冲突。

**解决方案：** 使用 `NODE_DISABLE_COMPILE_CACHE=1` 环境变量启动：
```bash
NODE_DISABLE_COMPILE_CACHE=1 openclaw gateway run
```

### Q5: 火山引擎余额查询失败

| 错误 | 原因 | 解决 |
|------|------|------|
| `SignatureDoesNotMatch` | 签名算法或 SDK 不对 | 使用 `volcenginesdkcore.SignerV4` |
| `InvalidAccessKey` | AK/SK 顺序反了 | `AKLT` 开头的是 Access Key ID |
| `InvalidActionOrVersion` | Action 名/版本错 | 用 `QueryBalanceAcct` 不是 `QueryBalance` |
| `MissingParameter` | Content-Type 或 Body 格式错 | 用 `application/json` + body `{}` |

### Q6: 凭证管理

所有 API 凭证应存储在隐私目录 `~/.hermes/data/` 下，权限 600：
```bash
chmod 600 ~/.hermes/data/volcengine-credentials.json
chmod 600 ~/.hermes/data/aliyun-credentials.json  # 如有
```

### Q7: 群聊不回消息（v5.6 专属）

这是 v5.6 的已知行为变更。`expandAutoMode()` 函数会将群聊的 replyMode 强制锁定为 `'static'`，导致卡片无法更新。

**解决方案**：在 `openclaw.json` 的 `channels.feishu` 中显式设置：
```json
"replyMode": {
  "default": "auto",
  "direct": "streaming",
  "group": "streaming"
}
```

### Q8: 凭证管理

所有 API 凭证应存储在隐私目录 `~/.hermes/data/` 下，权限 600。

---

## 🤖 AI 自动适配指南（供 AI 助手使用）

> 以下内容专为 AI 代码助手设计。收到本仓库 URL 或部署请求时，按此流程执行。

### AI 部署指令

```markdown
<!-- AI DEPLOY: openclaw-feishu-card-footer -->

步骤 1: 检测环境
  - openclaw --version → 获取版本号
    - v2026.5.2 → 使用 v5.2 补丁
    - v2026.5.3 → 使用 v5.3 补丁
    - v2026.5.6 → 使用 src/ 完整覆盖
  - node --version → 若 v22+ 需注意 compile cache

步骤 2: 停止 systemd 服务（如存在）
  systemctl --user stop openclaw-gateway.service

步骤 3: 定位插件目录
  - v5.3/v5.6: ~/.openclaw/npm/node_modules/@larksuite/openclaw-lark/
  - v5.2: /usr/lib/node_modules/@larksuite/openclaw-lark/
  - 如不存在：先安装插件

步骤 4: 应用补丁
  - v5.3: cp patches/v5.3/missing-functions.js + patches/v5.3/*.patch
  - v5.6: cp src/core/* + src/card/* + src/channel/*
  - 或直接 cp src/* <plugin_dir>/

步骤 5: 写 openclaw.json
  - messages.visibleReplies: "automatic"（必需！）
  - messages.footer: { status/enabled/elapsed/tokens/cache/model: true }
  - v5.6 额外: channels.feishu.replyMode.group: "streaming"
  - 不要在 channels.feishu 下配 footer/streaming

步骤 6: 清除缓存 + 重启
  - rm -rf ~/.openclaw/.jit-cache/
  - NODE_DISABLE_COMPILE_CACHE=1 systemctl --user restart openclaw-gateway

步骤 7: 验证
  - 发测试消息，检查 4 行 Footer
  - 日志应有 queuedFinal=true, replies=1
  - v5.6 确认群聊正常回复
```

---

## 📄 License

MIT
