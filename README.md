# OpenClaw Feishu Card Footer — 飞书卡片页脚增强

[![OpenClaw](https://img.shields.io/badge/OpenClaw-v2026.5.2%2B-blue)](https://openclaw.nousresearch.com)
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
| **上下文窗口** | 📑 | 已用 Token / 最大窗口 + 百分比进度条 |
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

- OpenClaw `v2026.5.2+`
- `@larksuite/openclaw-lark` `v2026.4.10+`
- Node.js `>= 18.0`

### 安装

```bash
# 1. 安装飞书插件
npm install -g @larksuite/openclaw-lark@^2026.4.10

# 2. 进入项目目录
cd /path/to/openclaw

# 3. 应用补丁
cp -r patches/* /usr/lib/node_modules/\@larksuite/openclaw-lark/

# 4. 配置 openclaw.json（参考 openclaw.json.example）
# 替换 YOUR_*_API_KEY 等占位符为实际值

# 5. 清除缓存
rm -rf node_modules/.cache/jiti/

# 6. 启动
openclaw gateway run
```

### 配置

复制 `openclaw.json.example` 为你的配置文件，替换以下内容：
- `YOUR_FEISHU_APP_ID` / `YOUR_FEISHU_APP_SECRET` — 飞书应用凭证
- `YOUR_*_API_KEY` — 各平台 API Key
- `YOUR_GATEWAY_TOKEN` — 网关安全 Token

---

## 🏗️ 架构

### 文件结构

```
├── src/                        # 插件源代码（补丁后的完整文件）
│   ├── card/
│   │   ├── builder.js          # Footer 渲染 + 定价/余额逻辑
│   │   ├── streaming-card-controller.js  # 流式卡片控制器
│   │   └── reply-dispatcher.js # 回复调度器（强制卡片模式）
│   ├── channel/
│   │   ├── monitor.js          # 通道监视器
│   │   ├── token-aggregator.js # Token 聚合器（事件驱动）
│   │   ├── token-aggregator-daemon.js # 守护扫描
│   │   └── event-bus.js        # 进程内事件总线
│   └── core/
│       ├── footer-config.js    # Footer 配置定义
│       └── accounts.js         # 多账号管理
├── patches/                    # Git 友好补丁
├── scripts/                    # 运维脚本
└── openclaw.json.example       # 配置模板
```

### Token 统计流

```
StreamingCardController → publish → EventBus → TokenAggregator
                                                    ↓
                                          token-stats.json (30s 刷盘)
                                                    ↓
                                          builder.js → CardKit Footer
```

### 余额显示流

```
Python 脚本 (每2h cron)
  ├─ DeepSeek   → HTTP Bearer → /user/balance
  ├─ 硅基流动    → HTTP Bearer → /user/info
  ├─ 阿里百炼   → Alibaba BSS SDK
  └─ 火山引擎   → Volcengine V4 签名
       ↓
  缓存文件 → builder.js → Footer Line 4: 💰 平台 ¥XXX
```

### 模型自动拉取

```
每日 3AM cron → model-fetcher.py → 拉取4平台624个模型
                    ↓
               pricing_db.py 补全定价
                    ↓
               更新 model-registry.json + openclaw.json 定价
                    ↓
               发群聊摘要：📊 模型注册表每日更新
```

---

## 🔧 配置详解

### Footer 配置 (openclaw.json)

```json
{
  "messages": {
    "footer": {
      "enabled": true,
      "showModel": true,
      "showUsage": true,
      "showLatency": true
    }
  },
  "channels": {
    "feishu": {
      "renderMode": "card",
      "footer": {
        "status": true, "elapsed": true, "tokens": true,
        "cache": true, "context": true, "model": true,
        "cost": true, "todayTokens": true, "monthTokens": true
      }
    }
  }
}
```

### 支持的 Provider

| Provider | API 地址 | 说明 |
|----------|---------|------|
| `bailian` | `coding.dashscope.aliyuncs.com` | 阿里百炼 Coding Plan (qwen3.6-plus 专线) |
| `dashscope` | `dashscope.aliyuncs.com` | 阿里百炼通用 API (所有 Qwen 模型) |
| `deepseek` | `api.deepseek.com` | DeepSeek 官方 API |
| `siliconflow` | `api.siliconflow.cn` | 硅基流动 API (DeepSeek/Kimi/Qwen/GLM) |
| `volcengine` | `ark.cn-beijing.volces.com` | 火山引擎方舟 (豆包系列) |

---

## 📊 模型注册表

`scripts/model-fetcher.py` 每日自动拉取各平台模型信息：

| 平台 | 模型数 | 定价 | 上下文 | 获取方式 |
|------|--------|:----:|:------:|---------|
| 阿里百炼 | **481** | ✅ | ✅ 1M | 专有 API |
| 硅基流动 | **102** | ⚠️ 38个 | ✅ 推测 | 价格库匹配 |
| 火山引擎 | **39** | ⚠️ 13个 | ✅ 262K | API + 价格库 |
| DeepSeek | **2** | ✅ | ✅ 1M | 价格库 |

全量数据缓存至 `model-registry.json`（106KB），可通过 `/model provider/model-id` 切换使用。

---

## 📁 脚本清单

| 脚本 | 功能 | 调度 |
|------|------|------|
| `scripts/balance-check.py` | 四平台余额查询 | 每2小时 |
| `scripts/model-fetcher.py` | 模型注册表全量更新 | 每日 3:00 |
| `scripts/pricing_db.py` | 定价数据库（硅基38+火山13+DeepSeek 2） | 被 model-fetcher 调用 |
| `scripts/deepseek-pricing-watch.py` | DeepSeek 官方价格监控 | 每日 9:01 |

---

## ⚠️ Pitfalls

1. **JITI 缓存**: 修改 `src/` 后必须清除 `node_modules/.cache/jiti/`，否则补丁不生效
2. **Systemd 冲突**: 如果 systemd 管理了网关，手动启动前 `systemctl --user stop openclaw-gateway.service`
3. **renderMode 强制**: 需 patch `reply-dispatcher.js` 将 `shouldUseCard(text)` 改为 `feishuCfg?.renderMode === 'card' || shouldUseCard(text)`
4. **API Key 安全**: 配置文件中的 Key 是敏感信息，加入 `.gitignore`，不要提交到版本控制
5. **SiliconFlow API Key 需要有效**: 如果 Key 过期，模型列表 API 会返回 `Invalid token`

---

## 📄 License

MIT License — 版权所有 (c) 2026

---

*Built for [OpenClaw](https://openclaw.nousresearch.com) × [Feishu](https://www.feishu.cn/)*
