# OpenClaw Feishu Card Footer — 飞书卡片页脚增强

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-v2026.5.2%2B-blue)](https://openclaw.nousresearch.com)
[![@larksuite/openclaw-lark](https://img.shields.io/badge/%40larksuite%2Fopenclaw--lark-%3E%3D2026.4.10-green)](https://www.npmjs.com/package/@larksuite/openclaw-lark)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

为 **[OpenClaw](https://openclaw.nousresearch.com)** 的飞书（Feishu / Lark）插件 `@larksuite/openclaw-lark` **v2026.4.10+** 提供信息丰富的卡片页脚增强组件。

![Card Footer 预览示意图](https://via.placeholder.com/600x120?text=Card+Footer+Preview)

---

## 📋 功能特性一览

| 功能 | Emoji | 描述 |
|------|-------|------|
| **完成状态** | ✅ / ❌ / ⏳ | 模型调用是否成功完成、失败或进行中 |
| **耗时** | ⏳️ | 端到端请求耗时（从发送到收到完整响应） |
| **Token 计数** | ↑ ↓ | 上行（输入）Token 与下行（输出）Token 数量 |
| **费用估算** | 💸 | 基于 Token 用量与模型单价自动估算费用 |
| **首Token延迟** | 🚀 | 从请求发出到收到第一个 Token 的等待时间（TTFT） |
| **上下文窗口比例** | 📑 | 已用 Token 占模型最大上下文窗口的百分比（进度条） |
| **Token 今/月累计 + 时间戳** | 🪙 | 今日累计 Token、本月累计 Token、最后更新时间戳 |

> 所有指标均以 **飞书卡片（CardKit）** 原生组件渲染，视觉风格与飞书客户端完全统一。

---

## 前置条件 (Prerequisites)

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| [OpenClaw](https://openclaw.nousresearch.com) | `v2026.5.2` | 主框架，提供插件化运行时与 EventBus 机制 |
| [@larksuite/openclaw-lark](https://www.npmjs.com/package/@larksuite/openclaw-lark) | `2026.4.10` | 飞书 / Lark 消息适配器，提供 CardKit 渲染接口 |
| Node.js | `>= 18.0` | 运行环境 |
| npm / yarn | 任意 | 包管理器 |

---

## 📦 安装步骤

以下为在现有 OpenClaw + 飞书项目中集成本插件的完整步骤。

### 1️⃣ 进入项目目录

```bash
cd /path/to/your/openclaw-project
```

### 2️⃣ 安装依赖

```bash
npm install @larksuite/openclaw-lark@^2026.4.10
```

> 如果尚未安装 OpenClaw 本体，请先参考 [OpenClaw 官方文档](https://openclaw.nousresearch.com/docs) 完成初始化。

### 3️⃣ 复制补丁文件

将本仓库 `patches/` 目录下的所有文件复制到 OpenClaw 项目的 `node_modules/` 对应路径中，或通过 `overrides` / `resolutions` 字段管理。

```bash
cp -r patches/* node_modules/
```

具体需要覆写的文件列表请参见下文 [文件清单](#-文件清单) 章节。

### 4️⃣ 注册插件

在 OpenClaw 配置中注册该卡片页脚插件：

```json
{
  "plugins": [
    {
      "name": "feishu-card-footer",
      "priority": 100,
      "enabled": true
    }
  ]
}
```

### 5️⃣ 启动验证

```bash
npx openclaw start
```

向飞书机器人发送一条任意消息，观察返回的卡片底部是否已显示带有 Token 统计、耗时、费用等信息的增强页脚。

---

## ⚙️ 配置示例

以下为 `openclaw.json` 或 `openclaw.local.json` 中与本插件相关的配置片段（**敏感信息已脱敏**）：

```jsonc
{
  "lark": {
    "appId": "cli_xxxxxxxxxxxxxxxx",
    "appSecret": "***REDACTED***",
    "cardKit": {
      "version": "latest",
      "enableMarkdown": true,
      "maxCardSize": 2048
    }
  },
  "plugins": {
    "feishu-card-footer": {
      "enabled": true,
      "options": {
        // 是否显示 Token 累计统计
        "showCumulativeTokens": true,
        // 费用估算使用的模型单价（每 1K Token）
        "pricing": {
          "gpt-4o":       { "input": 0.005,  "output": 0.015 },
          "gpt-4o-mini":  { "input": 0.00015, "output": 0.0006 },
          "claude-3-opus": { "input": 0.015,  "output": 0.075 }
        },
        // 上下文窗口大小（用于计算占比）
        "contextWindow": {
          "gpt-4o":        128000,
          "gpt-4o-mini":   128000,
          "claude-3-opus": 200000
        }
      }
    }
  },
  // Token 累计存储后端
  "storage": {
    "provider": "sqlite",
    "path": "./data/token_stats.db"
  }
}
```

> ⚠️ 实际部署时请勿提交含明文 `appSecret` 的配置文件至版本控制。

---

## 🏗️ 架构概览

本插件采用 **事件驱动 + 拦截器模式** 实现，整体流程如下：

```
                    ┌──────────────────────┐
                    │     OpenClaw Core     │
                    │    (Runtime + HTTP)   │
                    └──────┬───────────────┘
                           │ 模型请求/响应事件
                           ▼
              ┌────────────────────────────┐
              │    EventBus (事件总线)      │
              │  - model.request.start     │
              │  - model.response.chunk    │
              │  - model.response.done     │
              │  - model.request.error     │
              └──────────┬─────────────────┘
                         │ 监听 & 聚合
                         ▼
              ┌────────────────────────────┐
              │   TokenAggregator          │
              │   (Token 聚合器)             │
              │                            │
              │   收集:                     │
              │   · 时间戳                  │
              │   · ↑↓ Token 计数          │
              │   · 耗时 / TTFT            │
              │   · 模型名称               │
              │   · 状态 (成功/失败)        │
              └──────────┬─────────────────┘
                         │ 聚合完成
                         ▼
              ┌────────────────────────────┐
              │   Footer Injector          │
              │   (页脚注入器)               │
              │                            │
              │   计算:                     │
              │   · 💸 费用估算            │
              │   · 📑 上下文窗口比例      │
              │   · 🪙 累计 Token          │
              └──────────┬─────────────────┘
                         │ 生成 CardKit JSON
                         ▼
              ┌────────────────────────────┐
              │   CardKit Renderer         │
              │   (飞书卡片渲染器)           │
              │                            │
              │   输出: 飞书卡片页脚         │
              │   ┌─────────────────────┐  │
              │   │ ✅ ⏳️ 2.3s          │  │
              │   │ ↑ 1,245 ↓ 892      │  │
              │   │ 💸 $0.0123         │  │
              │   │ 🚀 0.8s  📑 1.7%   │  │
              │   │ 🪙 今 8.4K / 月 92K│  │
              │   └─────────────────────┘  │
              └────────────────────────────┘
```

### 核心组件说明

| 组件 | 职责 |
|------|------|
| **EventBus** | OpenClaw 内置事件总线；插件监听 `model.*` 系列事件以捕获请求生命周期中的原始数据 |
| **TokenAggregator** | 状态ful的累加器，在每个请求的生命周期内收集并规整 Token、耗时、状态等数据 |
| **Footer Injector** | 聚合完成后，计算衍生指标（费用、占比、累计），并将结果注入到飞书卡片的 `footer` 字段 |
| **CardKit Renderer** | 将结构化数据渲染为飞书 CardKit JSON（`Columns` + `Text` 组件），最终由 `@larksuite/openclaw-lark` 发送 |

---

## 📁 文件清单

| 路径 | 类型 | 描述 |
|------|------|------|
| `patches/lark/src/handler.js` | 补丁 | 拦截 CardKit 消息构建过程，在 `footer` 字段插入增强页脚 JSON |
| `patches/lark/src/renderer.js` | 补丁 | 扩展飞书卡片渲染器，注册自定义页脚组件渲染逻辑 |
| `src/EventBus.js` | 源文件 | 封装 OpenClaw EventBus 监听逻辑，订阅 `model.*` 事件 |
| `src/TokenAggregator.js` | 源文件 | Token 数据聚合器，维护请求范围内的计数、耗时与状态 |
| `src/FooterInjector.js` | 源文件 | 页脚注入器，计算费用、窗口占比与累计统计，生成 CardKit JSON |
| `src/CardKitFooter.js` | 源文件 | 飞书 CardKit 页脚模板定义，使用 `ColumnSet`、`Markdown` 等组件 |
| `src/TokenStore.js` | 源文件 | 持久化存储层（SQLite），管理今日/本月 Token 累计与时间戳 |
| `src/constants.js` | 源文件 | 模型定价表、上下文窗口大小配置常量 |
| `src/index.js` | 入口 | 插件入口，注册 EventBus 监听器并初始化各模块 |
| `config/openclaw.json` | 配置 | 插件配置模板，包含定价、上下文窗口等可调参数 |
| `config/schema.json` | 配置 | JSON Schema 定义，供编辑器自动补全与校验 |
| `test/unit/` | 测试 | 单元测试，覆盖 TokenAggregator 与 FooterInjector 核心逻辑 |
| `test/integration/` | 测试 | 集成测试，模拟完整请求-页脚渲染流程 |

---

## 🔧 故障排查 (Troubleshooting)

### 卡片页脚未显示

1. **确认版本** — 确保 OpenClaw ≥ `v2026.5.2` 且 `@larksuite/openclaw-lark` ≥ `2026.4.10`。
2. **检查日志** — 查看 OpenClaw 控制台输出，搜索 `[feishu-card-footer]` 前缀的日志。
3. **验证插件注册** — 确认 `openclaw.json` 中 `plugins` 数组包含本插件且 `enabled: true`。
4. **检查文件覆写** — 确认 `patches/` 中的文件已正确复制到 `node_modules/` 对应路径。

### Token 统计数据不准确

- **模型未配置定价** — 在 `openclaw.json` 的 `plugins.feishu-card-footer.options.pricing` 中添加缺失的模型条目。
- **上下文窗口未配置** — 同上，在 `contextWindow` 中添加对应模型的窗口大小。
- **存储路径问题** — 确认 `storage.path` 可写，SQLite 数据库文件正常创建。

### 卡片渲染异常（错位/截断）

- **CardKit 版本** — 确保 `cardKit.version` 设置为 `"latest"` 或与飞书客户端兼容的版本。
- **MaxCardSize** — 页脚内容较多时，适当增大 `maxCardSize`（建议 ≥ 2048）。
- **Markdown 语法** — 检查飞书 Markdown 渲染规则，本插件使用 `[Text](url)` 格式插入链接。

### 性能问题

- 若首 Token 延迟指标异常偏高，检查网络环境与模型 API 响应时间。
- 累计 Token 统计默认使用 SQLite 存储，高并发场景可切换至 Redis 后端（需自行实现 `TokenStore` 接口）。

---

## 📄 License

MIT License

版权所有 (c) 2026 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🙌 贡献

欢迎提交 Issue 与 PR！请确保：

- 新增功能附带单元测试
- 遵循项目现有的代码风格
- 提交前运行 `npm test` 确保无回归

---

*Built for [OpenClaw](https://openclaw.nousresearch.com) × [Feishu](https://www.feishu.cn/) — 让飞书机器人卡片信息一目了然。*
