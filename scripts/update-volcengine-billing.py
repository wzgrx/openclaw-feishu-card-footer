#!/usr/bin/env python3
"""火山引擎账单+余额定时查询脚本 - 每2小时更新"""
import json
import sys
import os
import time
from urllib.parse import urlencode

# 第三方
import requests

sys.path.insert(0, os.path.expanduser('~/.hermes/hermes-agent/venv/lib/python3.12/site-packages'))
from volcenginesdkcore.signv4 import SignerV4

# 读取凭证
creds_path = os.path.expanduser('~/.hermes/data/volcengine-credentials.json')
with open(creds_path) as f:
    creds = json.load(f)

VOLC_AK = creds['access_key_id']
VOLC_SK = creds['secret_access_key']

# ========================
# 1. 查询余额 (QueryBalanceAcct)
# ========================
headers = {"Content-Type": "application/json", "Host": "billing.volcengineapi.com"}
body = json.dumps({})
query = [("Action", "QueryBalanceAcct"), ("Version", "2022-01-01")]

SignerV4.sign("/", "POST", headers, body, {}, query, VOLC_AK, VOLC_SK, "cn-beijing", "billing")
url = "https://billing.volcengineapi.com/?" + urlencode(query)
resp = requests.post(url, headers=headers, data=body, timeout=10)
balance_data = resp.json()

balance_result = balance_data.get("Result", {})
balance = float(balance_result.get("AvailableBalance", 0))

# ========================
# 2. 查询月度消费 (ListBillOverviewByProd)
# ========================
from volcengine.ApiInfo import ApiInfo
from volcengine.Credentials import Credentials
from volcengine.ServiceInfo import ServiceInfo
from volcengine.base.Service import Service

service_info = ServiceInfo(
    "billing.volcengineapi.com",
    {'Accept': 'application/json'},
    Credentials(VOLC_AK, VOLC_SK, 'billing', 'cn-north-1'),
    5, 5
)

ai = {"ListBillOverviewByProd": ApiInfo("POST", "/", {
    "Action": "ListBillOverviewByProd", "Version": "2022-01-01"
}, {}, {})}
svc = Service(service_info, ai)

from datetime import datetime
now = datetime.now()
periods = []
for i in range(6):
    m = now.month - i
    y = now.year
    if m <= 0:
        m += 12
        y -= 1
    periods.append(f"{y}-{m:02d}")

monthly_costs = {}
total = 0.0
for bp in periods:
    try:
        result = svc.post("ListBillOverviewByProd", {"BillPeriod": bp, "Limit": "50", "Offset": "0"}, {})
        data = json.loads(result)
        items = data.get('Result', {}).get('List', [])
        cost = sum(float(item.get('PayableAmount', 0)) for item in items)
        monthly_costs[bp] = round(cost, 4)
        total += cost
    except:
        monthly_costs[bp] = None

# ========================
# 3. 写入缓存
# ========================
output = {
    "ts": int(datetime.now().timestamp() * 1000),
    "balance": balance,
    "available": True,
    "available_balance": balance,
    "cash_balance": float(balance_result.get("CashBalance", 0)),
    "freeze": float(balance_result.get("FreezeAmount", 0)),
    "credit_limit": float(balance_result.get("CreditLimit", 0)),
    "monthly_costs": monthly_costs,
    "total_recent": round(total, 4),
}

# 合并原文件
cache_path = os.path.expanduser('~/.hermes/data/volcengine-billing.json')
if os.path.exists(cache_path):
    with open(cache_path) as f:
        existing = json.load(f)
    existing.update(output)
    output = existing

with open(cache_path, 'w') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

# 同时更新 balance-cache.json
balance_cache_path = os.path.expanduser('~/.hermes/data/balance-cache.json')
if os.path.exists(balance_cache_path):
    with open(balance_cache_path) as f:
        bc = json.load(f)
    found = False
    for entry in bc['results']:
        if entry['platform'] == '火山引擎':
            entry['available'] = True
            entry['total'] = balance
            entry['cash_balance'] = balance
            entry['freeze'] = 0.0
            entry['currency'] = 'CNY'
            # 移除不需要的字段
            for k in ['balance', 'balance_note', 'total_recent', 'monthly_costs']:
                entry.pop(k, None)
            found = True
            break
    if not found:
        bc['results'].append({
            'platform': '火山引擎',
            'available': True,
            'total': balance,
            'cash_balance': balance,
            'freeze': 0.0,
            'currency': 'CNY',
        })
    bc['ts'] = output['ts']
    with open(balance_cache_path, 'w') as f:
        json.dump(bc, f, indent=2, ensure_ascii=False)

print(json.dumps({"status": "ok", "balance": f"¥{balance:.2f}", "data": output}, ensure_ascii=False))
