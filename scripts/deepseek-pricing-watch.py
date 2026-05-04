#!/usr/bin/env python3
"""
DeepSeek 官方价格自动监测 & 更新脚本
每周日 09:01 运行，抓取官方价格页，对比本地配置，自动更新
"""
import re, json, urllib.request, sys, os

CONFIG_PATH = os.path.expanduser("~/.openclaw/openclaw.json")
PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"

def fetch_official_prices():
    """从 DeepSeek 官方文档抓取当前价格"""
    html = urllib.request.urlopen(PRICING_URL, timeout=15).read().decode('utf-8')
    price_section = re.search(r'价格</td>.*?</table>', html, re.DOTALL)
    if not price_section:
        raise ValueError("无法从官方页面定位价格表")
    
    section = price_section.group()
    cells = re.findall(r'<td[^>]*>(.*?)</td>', section, re.DOTALL)
    
    prices = {}
    for i in range(0, len(cells), 3):
        if i + 2 >= len(cells):
            break
        label = re.sub(r'<[^>]+>', '', cells[i]).strip()
        flash_raw = re.sub(r'<del>.*?</del>', '', cells[i + 1]).strip()
        pro_raw = re.sub(r'<del>.*?</del>', '', cells[i + 2]).strip()
        flash_m = re.search(r'([\d.]+)', flash_raw)
        pro_m = re.search(r'([\d.]+)', pro_raw)
        if not flash_m or not pro_m:
            continue
        flash_val = float(flash_m.group(1))
        pro_val = float(pro_m.group(1))
        
        if '缓存命中' in label:
            prices['flash_cacheRead'] = flash_val
            prices['pro_cacheRead'] = pro_val
        elif '缓存未命中' in label:
            prices['flash_input'] = flash_val
            prices['pro_input'] = pro_val
        elif '输出' in label:
            prices['flash_output'] = flash_val
            prices['pro_output'] = pro_val
    
    return prices

def read_current_config():
    with open(CONFIG_PATH, 'r') as f:
        return json.load(f)

def write_config(config):
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write('\n')

def update_model_prices(config, model_id, input_p, output_p, cache_p):
    """更新 config 中所有匹配 model_id 的 cost"""
    updates = 0
    models = config.get('models', {}).get('providers', {})
    for provider_name, provider in models.items():
        for model in provider.get('models', []):
            if model.get('id') == model_id:
                old = model.get('cost', {})
                new_cost = {"input": input_p, "output": output_p, "cacheRead": cache_p}
                if old != new_cost:
                    model['cost'] = new_cost
                    updates += 1
                    print(f"  [{provider_name}/{model_id}] 更新: "
                          f"input={old.get('input')}→{input_p}, "
                          f"output={old.get('output')}→{output_p}, "
                          f"cacheRead={old.get('cacheRead')}→{cache_p}")
    return updates

def main():
    print(f"🔍 抓取 DeepSeek 官方价格...")
    try:
        prices = fetch_official_prices()
    except Exception as e:
        print(f"❌ 获取价格失败: {e}")
        return 1
    
    print(f"   官方价格:")
    print(f"   deepseek-v4-flash:  输入={prices['flash_input']}元  输出={prices['flash_output']}元  缓存={prices['flash_cacheRead']}元")
    print(f"   deepseek-v4-pro:    输入={prices['pro_input']}元  输出={prices['pro_output']}元  缓存={prices['pro_cacheRead']}元")
    
    print(f"\n📝 读取当前配置...")
    config = read_current_config()
    
    print(f"\n🔄 检查并更新价格...")
    total = 0
    total += update_model_prices(config, "deepseek-v4-flash",
                                 prices['flash_input'], prices['flash_output'], prices['flash_cacheRead'])
    total += update_model_prices(config, "deepseek-v4-pro",
                                 prices['pro_input'], prices['pro_output'], prices['pro_cacheRead'])
    
    if total == 0:
        print(f"\n✅ 价格已是最新，无需更新")
    else:
        write_config(config)
        print(f"\n✅ 已更新 {total} 个模型价格配置")
        print(f"\n⚠️ 配置已变更，请重启网关！")
        print(f"   systemctl --user restart openclaw-gateway.service")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
