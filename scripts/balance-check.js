#!/usr/bin/env node
/**
 * Balance Check Script — Queries API provider balances.
 *
 * Outputs ~/.hermes/data/balance-cache.json in the format expected by
 * builder.js's getBalanceForModel() function.
 *
 * Usage:
 *   node scripts/balance-check.js          # one-shot
 *   crontab -e → */30 * * * * node /path/to/balance-check.js
 *
 * Supported providers (add your API keys below):
 *   - DeepSeek:   api.deepseek.com/user/balance
 *   - 硅基流动:    api.siliconflow.cn/v1/user/info
 *   - 阿里百炼:    (DashScope) 用 DashScope SDK
 *   - 火山引擎:    用 Volcengine SDK
 */
"use strict";

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── CONFIG: REPLACE WITH YOUR API KEYS ───────────────────────────────────
const API_KEYS = {
    deepseek: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',     // DeepSeek API Key
    siliconflow: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',   // 硅基流动 API Key
};

const CACHE_DIR = path.join(process.env.HOME, '.hermes', 'data');
const CACHE_PATH = path.join(CACHE_DIR, 'balance-cache.json');

// ─── HTTP Helper ──────────────────────────────────────────────────────────
function fetchJSON(url, apiKey) {
    return new Promise((resolve, reject) => {
        const opts = { headers: {} };
        if (apiKey) opts.headers['Authorization'] = `Bearer ${apiKey}`;
        https.get(url, opts, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
            });
        }).on('error', reject);
    });
}

// ─── Balance Checkers ─────────────────────────────────────────────────────
async function checkDeepSeek(apiKey) {
    try {
        const data = await fetchJSON('https://api.deepseek.com/user/balance', apiKey);
        if (data?.is_available && data?.balance_infos?.[0]) {
            const total = parseFloat(data.balance_infos[0].total_balance);
            return { platform: 'DeepSeek', total, available: true };
        }
        return { platform: 'DeepSeek', total: 0, available: false };
    } catch (e) {
        return { platform: 'DeepSeek', total: 0, available: false, error: e.message };
    }
}

async function checkSiliconFlow(apiKey) {
    try {
        const data = await fetchJSON('https://api.siliconflow.cn/v1/user/info', apiKey);
        if (data?.status && data?.data) {
            const total = parseFloat(data.data.totalBalance);
            const status = data.data.status?.toLowerCase();
            return { platform: '硅基流动', total, available: status === 'normal' || status === 'active' };
        }
        return { platform: '硅基流动', total: 0, available: false };
    } catch (e) {
        return { platform: '硅基流动', total: 0, available: false, error: e.message };
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
    const results = await Promise.all([
        checkDeepSeek(API_KEYS.deepseek),
        checkSiliconFlow(API_KEYS.siliconflow),
    ]);

    const output = {
        timestamp: new Date().toISOString(),
        results: results.filter(r => r.total > 0 || r.error),
    };

    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_PATH, JSON.stringify(output, null, 2), 'utf8');
        console.log(`[balance-check] written to ${CACHE_PATH}`);
        console.log(JSON.stringify(output, null, 2));
    } catch (e) {
        console.error(`[balance-check] write error: ${e.message}`);
    }
}

main().catch(e => console.error('[balance-check] error:', e.message));
