#!/usr/bin/env python3
"""Known pricing database for AI model providers"""

# ── DeepSeek Official Pricing ──
DEEPSEEK_PRICING = {
    # model_name_pattern: {input, output, cacheRead rate per 1M tokens}
    "v4-flash":  {"input": 1.0,  "output": 2.0,  "cacheRead": 0.02,  "context": 1000000, "max_output": 384000},
    "v4-pro":    {"input": 3.0,  "output": 6.0,  "cacheRead": 0.025, "context": 1000000, "max_output": 384000},
}

# ── SiliconFlow Known Pricing (¥/1M tokens, as of 2026) ──
# Source: siliconflow.cn pricing page
SILICONFLOW_PRICING = {
    # DeepSeek series
    "deepseek-v4-flash":        {"input": 1.6,  "output": 3.2,  "cacheRead": 0.16,  "context": 65536},
    "deepseek-v4-pro":          {"input": 4.8,  "output": 9.6,  "cacheRead": 0.48,  "context": 65536},
    "deepseek-r1":              {"input": 4.0,  "output": 16.0, "cacheRead": 0.4,   "context": 65536},
    "deepseek-v3":              {"input": 2.0,  "output": 8.0,  "cacheRead": 0.2,   "context": 65536},
    
    # Qwen series
    "qwen-max":                 {"input": 20.0, "output": 60.0, "cacheRead": 2.0,   "context": 32768},
    "qwen-plus":                {"input": 8.0,  "output": 24.0, "cacheRead": 0.8,   "context": 131072},
    "qwen-turbo":               {"input": 3.0,  "output": 6.0,  "cacheRead": 0.3,   "context": 1000000},
    "qwen2.5-72b":              {"input": 12.0, "output": 36.0, "cacheRead": 1.2,   "context": 131072},
    "qwen2.5-32b":              {"input": 5.0,  "output": 15.0, "cacheRead": 0.5,   "context": 131072},
    "qwen2.5-14b":              {"input": 2.0,  "output": 6.0,  "cacheRead": 0.2,   "context": 131072},
    "qwen2.5-7b":               {"input": 1.0,  "output": 3.0,  "cacheRead": 0.1,   "context": 131072},
    "qwen2.5-coder-32b":        {"input": 5.0,  "output": 15.0, "cacheRead": 0.5,   "context": 131072},
    "qwen2.5-coder-14b":        {"input": 2.0,  "output": 6.0,  "cacheRead": 0.2,   "context": 32768},
    "qwen2-vl-72b":             {"input": 12.0, "output": 36.0, "cacheRead": 1.2,   "context": 32768},
    "qwen2-vl-7b":              {"input": 1.0,  "output": 3.0,  "cacheRead": 0.1,   "context": 32768},
    
    # Kimi series
    "kimi-k2.6":                {"input": 8.0,  "output": 24.0, "cacheRead": 0.8,   "context": 131072},
    "kimi-k2.5":                {"input": 6.0,  "output": 18.0, "cacheRead": 0.6,   "context": 131072},
    "kimi-k2-thinking":         {"input": 4.0,  "output": 16.0, "cacheRead": 0.4,   "context": 131072},
    "kimi-k2":                  {"input": 2.0,  "output": 8.0,  "cacheRead": 0.2,   "context": 131072},
    
    # GLM series
    "glm-5":                    {"input": 5.0,  "output": 15.0, "cacheRead": 0.5,   "context": 131072},
    "glm-4":                    {"input": 1.0,  "output": 2.0,  "cacheRead": 0.1,   "context": 131072},
    "glm-4v":                   {"input": 1.0,  "output": 2.0,  "cacheRead": 0.1,   "context": 4096},
    "glm-4-air":                {"input": 0.5,  "output": 1.0,  "cacheRead": 0.05,  "context": 131072},
    
    # Yi series
    "yi-lightning":             {"input": 0.5,  "output": 1.0,  "cacheRead": 0.05,  "context": 32768},
    "yi-large":                 {"input": 3.0,  "output": 6.0,  "cacheRead": 0.3,   "context": 32768},
    
    # MiniMax
    "minimax-m2.5":             {"input": 8.0,  "output": 24.0, "cacheRead": 0.8,   "context": 131072},
    "minimax-m1":               {"input": 2.0,  "output": 6.0,  "cacheRead": 0.2,   "context": 131072},
    
    # InternLM
    "internlm3-8b":             {"input": 0.5,  "output": 1.5,  "cacheRead": 0.05,  "context": 32768},
    "internlm2-20b":            {"input": 1.0,  "output": 3.0,  "cacheRead": 0.1,   "context": 32768},
    
    # Default (fallback)
    "_default":                 {"input": 0,    "output": 0,    "cacheRead": 0,     "context": 32768},
}

# ── Volcengine Doubao Pricing (¥/1M tokens, known from official docs) ──
VOLCENGINE_PRICING = {
    "doubao-1-5-pro":           {"input": 5.0,  "output": 15.0, "cacheRead": 0.5,   "context": 131072},
    "doubao-1-5-lite":          {"input": 1.0,  "output": 2.0,  "cacheRead": 0.1,   "context": 32768},
    "doubao-1-5-vision-pro":    {"input": 5.0,  "output": 15.0, "cacheRead": 0.5,   "context": 32768},
    "doubao-seed-2-0-pro":      {"input": 10.0, "output": 30.0, "cacheRead": 1.0,   "context": 262144},
    "doubao-seed-2-0-lite":     {"input": 2.0,  "output": 6.0,  "cacheRead": 0.2,   "context": 262144},
    "doubao-seed-2-0-mini":     {"input": 1.0,  "output": 2.0,  "cacheRead": 0.1,   "context": 262144},
    "doubao-seed-2-0-code":     {"input": 5.0,  "output": 15.0, "cacheRead": 0.5,   "context": 262144},
    "doubao-seed-1-6":          {"input": 8.0,  "output": 24.0, "cacheRead": 0.8,   "context": 262144},
    "doubao-seed-1-6-flash":    {"input": 3.0,  "output": 6.0,  "cacheRead": 0.3,   "context": 262144},
    "_default":                 {"input": 0,    "output": 0,    "cacheRead": 0,     "context": 32768},
}


def match_pricing(model_id, pricing_db):
    """Match a model ID to its pricing entry using prefix matching"""
    model_lower = model_id.lower()
    for key in sorted(pricing_db.keys(), key=len, reverse=True):
        if key == "_default":
            continue
        if key in model_lower:
            return pricing_db[key]
    return pricing_db.get("_default", {})


if __name__ == "__main__":
    # Test matching
    tests = [
        ("deepseek-ai/DeepSeek-V4-Flash", SILICONFLOW_PRICING),
        ("Pro/moonshotai/Kimi-K2.6", SILICONFLOW_PRICING),
        ("Qwen/Qwen2.5-72B-Instruct", SILICONFLOW_PRICING),
        ("doubao-1-5-pro-32k-250115", VOLCENGINE_PRICING),
        ("doubao-seed-2-0-pro-250408", VOLCENGINE_PRICING),
        ("deepseek-v4-flash", DEEPSEEK_PRICING),
    ]
    for model_id, db in tests:
        result = match_pricing(model_id, db)
        print(f"  {model_id:50s} → {result}")
