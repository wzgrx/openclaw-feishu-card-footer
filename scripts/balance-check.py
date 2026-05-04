#!/usr/bin/env python3
"""AI API 余额查询 - DeepSeek + 硅基流动 + 阿里百炼"""

import json
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

CACHE_FILE = os.path.expanduser("~/.hermes/data/balance-cache.json")
CACHE_TTL = 3600  # 1 小时缓存

SILICONFLOW_KEY = "YOUR_SILICONFLOW_API_KEY"
DEEPSEEK_KEY = "YOUR_DEEPSEEK_API_KEY"

# 阿里百炼 BSS AccessKey (需要 BssOpenApi 权限)
ALIBABA_AK = "YOUR_ALIBABA_ACCESS_KEY_ID"
ALIBABA_SK = "YOUR_ALIBABA_ACCESS_KEY_SECRET"

# 火山引擎账单 AccessKey
VOLC_AK = "YOUR_VOLC_ACCESS_KEY_ID"
VOLC_SK = "YOUR_VOLC_ACCESS_KEY_SECRET"


def fetch_json(url, headers, timeout=10):
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def fetch_siliconflow():
    try:
        data = fetch_json(
            "https://api.siliconflow.cn/v1/user/info",
            {"Authorization": f"Bearer {SILICONFLOW_KEY}"}
        )
        if data.get("status") and data.get("data"):
            info = data["data"]
            return {
                "platform": "硅基流动",
                "total": float(info.get("totalBalance", 0)),
                "charge": float(info.get("chargeBalance", 0)),
                "grant": float(info.get("balance", 0)),
                "currency": "CNY",
                "available": True,
            }
        return {"platform": "硅基流动", "error": data.get("message", "Unknown"), "available": False}
    except Exception as e:
        return {"platform": "硅基流动", "error": str(e), "available": False}


def fetch_deepseek():
    try:
        data = fetch_json(
            "https://api.deepseek.com/user/balance",
            {"Authorization": f"Bearer {DEEPSEEK_KEY}"}
        )
        if data.get("is_available") and data.get("balance_infos"):
            info = data["balance_infos"][0]
            return {
                "platform": "DeepSeek",
                "total": float(info.get("total_balance", 0)),
                "topped_up": float(info.get("topped_up_balance", 0)),
                "granted": float(info.get("granted_balance", 0)),
                "currency": info.get("currency", "CNY"),
                "available": True,
            }
        return {"platform": "DeepSeek", "error": "Balance unavailable", "available": False}
    except Exception as e:
        return {"platform": "DeepSeek", "error": str(e), "available": False}


def fetch_alibaba():
    """查询阿里百炼余额（通过阿里云 BSS OpenAPI）"""
    try:
        from alibabacloud_bssopenapi20171214.client import Client as BssOpenApiClient
        from alibabacloud_tea_openapi import models as open_api_models

        config = open_api_models.Config(
            access_key_id=ALIBABA_AK,
            access_key_secret=ALIBABA_SK
        )
        config.endpoint = "business.aliyuncs.com"
        client = BssOpenApiClient(config)
        resp = client.query_account_balance()
        body = resp.body
        if body.success:
            data = body.data
            available = float(data.available_amount)
            return {
                "platform": "阿里百炼",
                "total": available,
                "currency": data.currency,
                "available": True,
            }
        return {"platform": "阿里百炼", "error": body.message, "available": False}
    except ImportError:
        return {"platform": "阿里百炼", "error": "SDK not installed", "available": False}
    except Exception as e:
        return {"platform": "阿里百炼", "error": str(e), "available": False}


def fetch_volcengine():
    """查询火山引擎余额（通过 Volcengine Billing API）"""
    try:
        from volcenginesdkcore.signv4 import SignerV4
        from six.moves.urllib.parse import urlencode
        import requests, json

        headers = {
            "Content-Type": "application/json",
            "Host": "billing.volcengineapi.com",
        }
        body = json.dumps({})
        query = [("Action", "QueryBalanceAcct"), ("Version", "2022-01-01")]

        SignerV4.sign("/", "POST", headers, body, {}, query, VOLC_AK, VOLC_SK, "cn-beijing", "billing")

        url = "https://billing.volcengineapi.com/?" + urlencode(query)
        resp = requests.post(url, headers=headers, data=body, timeout=10)
        resp_json = resp.json()
        result = resp_json.get("Result", {})
        available = float(result.get("AvailableBalance", 0))
        return {
            "platform": "火山引擎",
            "total": available,
            "currency": "CNY",
            "available": True,
        }
    except ImportError:
        return {"platform": "火山引擎", "error": "SDK not installed", "available": False}
    except Exception as e:
        return {"platform": "火山引擎", "error": str(e), "available": False}


def main():
    results = []
    for fetcher in [fetch_deepseek, fetch_siliconflow, fetch_alibaba, fetch_volcengine]:
        result = fetcher()
        results.append(result)
        status = "✅" if result.get("available") else "❌"
        if result.get("available"):
            print(f"{status} {result['platform']}: ¥{result['total']:.2f}")
        else:
            print(f"{status} {result['platform']}: {result.get('error', 'Failed')}")

    # 更新缓存
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    cache = {
        "timestamp": int(time.time()),
        "results": results,
    }
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

    # JSON 输出
    if "--json" in sys.argv:
        print("\n---JSON---")
        print(json.dumps(results, ensure_ascii=False))

    return 0 if all(r.get("available") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
