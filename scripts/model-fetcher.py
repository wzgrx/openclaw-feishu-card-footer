#!/usr/bin/env python3
"""AI 模型信息自动拉取器 - 全平台自动同步版
拉取各平台模型列表+详情，从 API 和定价数据库补全数据
自动同步全部模型到 openclaw.json，输出群聊友好摘要"""

import json
import os
import sys
import time
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError

CACHE_FILE = os.path.expanduser("~/.hermes/data/model-registry.json")
CONFIG_PATH = os.path.expanduser("~/.openclaw/openclaw.json")

# 导入定价数据库
sys.path.insert(0, os.path.expanduser("~/.hermes/scripts"))
from pricing_db import match_pricing, DEEPSEEK_PRICING, SILICONFLOW_PRICING, VOLCENGINE_PRICING

# ── API Keys ──
SILICONFLOW_KEY = os.environ.get("SILICONFLOW_KEY", "YOUR_KEY"")
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_KEY", "YOUR_KEY"")
BAILIAN_KEY = os.environ.get("BAILIAN_KEY", "YOUR_KEY"")
VOLC_ARK_KEY = os.environ.get("VOLC_ARK_KEY", "YOUR_KEY"")


def fetch_json(url, headers=None, timeout=15, retries=3):
    for attempt in range(retries):
        try:
            req = Request(url, headers=headers or {})
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            raise


def normalize_model_id(raw_id):
    return raw_id.replace("deepseek-ai/", "").replace("Pro/", "").replace("Tongyi-MAI/", "")


# ════════════════════════════════════════════════════════════════
# 阿里百炼
# ════════════════════════════════════════════════════════════════
def fetch_bailian_models():
    models = []
    try:
        page = 1
        total = 0
        while True:
            url = f"https://dashscope.aliyuncs.com/api/v1/models?page_no={page}&page_size=100"
            data = fetch_json(url, {"Authorization": f"Bearer {BAILIAN_KEY}"})
            output = data.get("output")
            if not output:
                break
            raw_list = output.get("models", [])
            total = output.get("total", 0)
            if not raw_list:
                break
            for m in raw_list:
                model_id = m.get("model", "")
                if not model_id:
                    continue
                prices = {}
                for price_group in m.get("prices", []):
                    for p in price_group.get("prices", []):
                        ptype = p.get("type", "")
                        price = p.get("price", "0")
                        if ptype == "input_token":
                            prices["input"] = float(price)
                        elif ptype == "output_token":
                            prices["output"] = float(price)
                        elif ptype == "input_token_cache_read":
                            prices["cacheRead"] = float(price)
                caps = m.get("capabilities") or []
                reasoning = "Reasoning" in caps
                meta = m.get("inference_metadata") or {}
                input_mod = [x.lower() for x in meta.get("request_modality", ["text"])]
                model_info = m.get("model_info") or {}
                ctx = model_info.get("context_window", 0)
                max_out = model_info.get("max_output_tokens", 0)
                entry = {
                    "id": model_id,
                    "name": m.get("name", model_id),
                    "platform": "bailian",
                    "reasoning": reasoning,
                    "input_modalities": input_mod,
                    "context_window": ctx,
                    "max_output_tokens": max_out,
                    "cost": prices,
                    "features": m.get("features", []),
                    "capabilities": caps,
                    "description": m.get("description", ""),
                }
                models.append(entry)
            print(f"  阿里百炼: 第{page}页 ({len(raw_list)}个) / 共{total}个", end="\r")
            if len(models) >= total:
                break
            page += 1
        print(f"\n  阿里百炼: ✅ 共 {len(models)} 个模型")
    except Exception as e:
        print(f"  阿里百炼: ❌ {e}")
    return models


# ════════════════════════════════════════════════════════════════
# 火山引擎
# ════════════════════════════════════════════════════════════════
def fetch_volcengine_models():
    models = []
    try:
        data = fetch_json("https://ark.cn-beijing.volces.com/api/v3/models",
                          {"Authorization": f"Bearer {VOLC_ARK_KEY}"})
        raw_list = data.get("data", [])
        active = [m for m in raw_list if not m.get("status") or m.get("status") == "active"]
        print(f"  火山引擎: {len(active)}/{len(raw_list)} 活跃")
        for m in active:
            model_id = m.get("id", "")
            if not model_id:
                continue
            limits = m.get("token_limits", {})
            ctx = limits.get("context_window", 0)
            max_out = limits.get("max_output_token_length", 0)
            pricing = match_pricing(model_id, VOLCENGINE_PRICING)
            mod = m.get("modalities", {})
            input_mod = [x.lower() for x in mod.get("input_modalities", ["text"])]
            features = list(m.get("features", {}).keys())
            task_types = m.get("task_type", [])
            reasoning = any("reason" in t.lower() for t in task_types) if task_types else False
            entry = {
                "id": model_id,
                "name": m.get("name", model_id),
                "platform": "volcengine",
                "reasoning": reasoning,
                "input_modalities": input_mod,
                "context_window": ctx,
                "max_output_tokens": max_out,
                "cost": pricing if pricing.get("input") else {},
                "features": features,
                "capabilities": ["VLM"] if "vision" in input_mod else [],
                "description": "",
                "domain": m.get("domain", ""),
                "task_type": task_types,
            }
            models.append(entry)
    except Exception as e:
        print(f"  火山引擎: ❌ {e}")
    return models


# ════════════════════════════════════════════════════════════════
# 硅基流动
# ════════════════════════════════════════════════════════════════
def fetch_siliconflow_models():
    models = []
    try:
        data = fetch_json("https://api.siliconflow.cn/v1/models",
                          {"Authorization": f"Bearer {SILICONFLOW_KEY}"})
        raw_list = data.get("data", [])
        print(f"  硅基流动: {len(raw_list)} 个模型")
        for m in raw_list:
            model_id = m.get("id", "")
            if not model_id:
                continue
            pricing = match_pricing(model_id, SILICONFLOW_PRICING)
            ctx = pricing.get("context", 32768)
            model_lower = model_id.lower()
            reasoning = any(kw in model_lower for kw in [
                "deepseek-r1", "deepseek-reasoner", "kimi-k2-thinking",
                "kimi-k2.5", "reasoning", "qwq", "think"
            ])
            entry = {
                "id": model_id,
                "name": normalize_model_id(model_id),
                "platform": "siliconflow",
                "reasoning": reasoning,
                "input_modalities": ["text"],
                "context_window": ctx,
                "max_output_tokens": pricing.get("context", 32768) // 8,
                "cost": pricing if pricing.get("input") else {},
                "features": [],
                "capabilities": [],
                "description": "",
            }
            models.append(entry)
    except Exception as e:
        print(f"  硅基流动: ❌ {e}")
    return models


# ════════════════════════════════════════════════════════════════
# DeepSeek
# ════════════════════════════════════════════════════════════════
def fetch_deepseek_models():
    models = []
    try:
        data = fetch_json("https://api.deepseek.com/v1/models",
                          {"Authorization": f"Bearer {DEEPSEEK_KEY}"})
        raw_list = data.get("data", [])
        print(f"  DeepSeek: {len(raw_list)} 个模型")
        for m in raw_list:
            model_id = m.get("id", "").lower()
            if not model_id:
                continue
            pricing = match_pricing(model_id, DEEPSEEK_PRICING)
            ctx = pricing.get("context", 1000000)
            entry = {
                "id": model_id,
                "name": m.get("id", model_id),
                "platform": "deepseek",
                "reasoning": "reasoner" in model_id or "pro" in model_id,
                "input_modalities": ["text"],
                "context_window": ctx,
                "max_output_tokens": pricing.get("max_output", 384000),
                "cost": pricing if pricing.get("input") else {},
                "features": [],
                "capabilities": [],
                "description": "",
            }
            models.append(entry)
    except Exception as e:
        print(f"  DeepSeek: ❌ {e}")
    return models


# ════════════════════════════════════════════════════════════════
# 同步全部模型到 openclaw.json
# ════════════════════════════════════════════════════════════════
def sync_pricing_to_config(by_platform):
    """只更新现有模型的定价/上下文，不新增/删除模型"""
    if not os.path.exists(CONFIG_PATH):
        print(f"  ⚠️ 配置不存在: {CONFIG_PATH}")
        return 0, 0

    with open(CONFIG_PATH) as f:
        config = json.load(f)

    providers = config.get("models", {}).get("providers", {})
    total_updated = 0

    platform_to_provider = {
        "bailian": "dashscope",
        "deepseek": "deepseek",
        "siliconflow": "siliconflow",
        "volcengine": "volcengine",
    }

    for platform, fetched_models in by_platform.items():
        pkey = platform_to_provider.get(platform)
        if not pkey or pkey not in providers:
            continue

        # 构建查找表: fetched model_id → model_data
        fetched_map = {m["id"]: m for m in fetched_models}
        provider_cfg = providers[pkey]
        existing = provider_cfg.get("models", [])
        updated = 0

        for model_cfg in existing:
            mid = model_cfg.get("id", "")
            fetched = fetched_map.get(mid)
            if not fetched:
                continue

            cost = fetched.get("cost", {})
            ctx = fetched.get("context_window", 0)
            reasoning = fetched.get("reasoning", False)
            input_mod = fetched.get("input_modalities", ["text"])

            dirty = False

            # 更新 cost：仅当现有为 0 时才覆盖
            cur_cost = model_cfg.get("cost", {})
            if cost:
                new_cost = dict(cur_cost)
                for k in ["input", "output", "cacheRead"]:
                    if k in cost and (cur_cost.get(k) is None or cur_cost.get(k) == 0):
                        new_cost[k] = cost[k]
                if new_cost != cur_cost:
                    model_cfg["cost"] = new_cost
                    dirty = True

            # 更新上下文
            if ctx and (model_cfg.get("contextWindow") is None or model_cfg.get("contextWindow") == 0):
                model_cfg["contextWindow"] = ctx
                dirty = True

            # 更新 maxTokens
            max_out = fetched.get("max_output_tokens", 0)
            if max_out and (model_cfg.get("maxTokens") is None or model_cfg.get("maxTokens") == 0):
                model_cfg["maxTokens"] = max_out
                dirty = True

            # 更新 reasoning
            if reasoning and not model_cfg.get("reasoning"):
                model_cfg["reasoning"] = True
                dirty = True

            # 更新 input modalities
            cur_input = model_cfg.get("input", ["text"])
            if len(input_mod) > 1 and cur_input == ["text"]:
                model_cfg["input"] = input_mod
                dirty = True

            if dirty:
                updated += 1

        total_updated += updated
        if updated > 0:
            print(f"  {pkey}: {updated} 个模型定价/信息已更新")

    if total_updated > 0:
        with open(CONFIG_PATH, "w") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"  ✅ openclaw.json: {total_updated} 个字段已更新")
    else:
        print(f"  - openclaw.json: 无需更新")

    return total_updated


# ════════════════════════════════════════════════════════════════
# 生成群聊摘要
# ════════════════════════════════════════════════════════════════
def generate_summary(by_platform, updated):
    lines = []
    lines.append("📊 **模型注册表每日更新**")
    lines.append("")
    for name, models in by_platform.items():
        with_pricing = sum(1 for m in models if m.get("cost", {}).get("input", 0) > 0)
        with_ctx = sum(1 for m in models if (m.get("context_window") or 0) > 0)
        icon = {"bailian": "🏦", "volcengine": "🌋", "siliconflow": "🌊", "deepseek": "🔵"}.get(name, "📦")
        lines.append(f"{icon} **{name}**: {len(models)} 个模型")
        lines.append(f"   └ 定价 {with_pricing} 个 · 上下文 {with_ctx} 个")
        lines.append("")

    lines.append(f"**🔄 openclaw.json 定价更新**: {updated} 个模型")
    lines.append("")

    # 各平台亮点
    lines.append("**🔥 重点推荐**")
    if by_platform.get("siliconflow"):
        sf = by_platform["siliconflow"]
        reasoning = [m["id"] for m in sf if m.get("reasoning") and m.get("cost", {}).get("input", 0) > 0]
        if reasoning:
            lines.append(f"  🤔 推理模型: {' · '.join(reasoning[:5])}")
    if by_platform.get("volcengine"):
        ve = by_platform["volcengine"]
        big_ctx = [m["name"] for m in ve if m.get("context_window", 0) >= 262144]
        if big_ctx:
            lines.append(f"  📖 超长上下文(262K+): {' · '.join(big_ctx[:3])}")
    lines.append("")
    lines.append(f"⏰ 更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("💡 群聊切换模型: `/model provider/model-id`")

    return "\n".join(lines)


# ════════════════════════════════════════════════════════════════
# 主函数
# ════════════════════════════════════════════════════════════════
def main():
    print("拉取各平台模型信息...\n")

    fetchers = [
        ("bailian", fetch_bailian_models),
        ("volcengine", fetch_volcengine_models),
        ("siliconflow", fetch_siliconflow_models),
        ("deepseek", fetch_deepseek_models),
    ]

    all_models = []
    by_platform = {}

    for name, fetcher in fetchers:
        print(f"[{name}]")
        models = fetcher()
        by_platform[name] = models
        all_models.extend(models)

    # 汇总写入注册表
    summary = []
    for name, models in by_platform.items():
        for m in models:
            entry = {"id": m["id"], "name": m["name"], "platform": m["platform"]}
            if m.get("cost") and m["cost"].get("input"):
                entry["cost"] = m["cost"]
            if m.get("context_window"):
                entry["context_window"] = m["context_window"]
            if m.get("max_output_tokens"):
                entry["max_tokens"] = m["max_output_tokens"]
            if m.get("input_modalities"):
                entry["input"] = m["input_modalities"]
            if m.get("reasoning"):
                entry["reasoning"] = True
            if m.get("features"):
                entry["features"] = m["features"]
            if m.get("capabilities"):
                entry["capabilities"] = m["capabilities"]
            if m.get("domain"):
                entry["domain"] = m["domain"]
            if m.get("task_type"):
                entry["task_type"] = m["task_type"]
            summary.append(entry)

    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    cache = {
        "timestamp": int(time.time()),
        "total": len(all_models),
        "by_platform": {k: len(v) for k, v in by_platform.items()},
        "models": summary,
    }
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

    print(f"\n缓存写入: {CACHE_FILE}")

    # 同步定价到 openclaw.json（只更新已有模型，不新增）
    print(f"\n🔄 更新 openclaw.json 定价...")
    updated = sync_pricing_to_config(by_platform)

    # 打印总数
    print(f"\n{'='*50}")
    print(f"总计: {len(all_models)} 个模型")
    for name, models in by_platform.items():
        has_pricing = sum(1 for m in models if m.get("cost", {}).get("input"))
        print(f"  {name}: {len(models)} 个 (定价: {has_pricing})")
    print(f"  → openclaw.json: {updated} 个模型更新")

    # 输出群聊摘要
    print(f"\n{'='*50}")
    print("=== 群聊摘要 ===")
    summary_text = generate_summary(by_platform, updated)
    print(summary_text)

    # 将摘要写入临时文件供 cron 读取
    summary_file = os.path.expanduser("~/.hermes/data/model-update-summary.txt")
    with open(summary_file, "w") as f:
        f.write(summary_text)
    print(f"\n摘要已保存: {summary_file}")


if __name__ == "__main__":
    main()
