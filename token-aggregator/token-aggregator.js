"use strict";
/**
 * Token Aggregator — Event-driven token usage tracker for OpenClaw Feishu.
 *
 * Monitors the session store file and maintains ~/.openclaw/token-stats.json
 * with daily and monthly token totals for the 🪙 footer display.
 *
 * Installation:
 *   mkdir -p ~/.openclaw/channels/feishu
 *   cp token-aggregator.js ~/.openclaw/channels/feishu/
 *
 * Register in openclaw.json:
 *   "plugins": {
 *     "entries": {
 *       "feishu-token-aggregator": {
 *         "enabled": true,
 *         "source": "~/.openclaw/channels/feishu/token-aggregator.js"
 *       }
 *     }
 *   }
 */
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────
const SESSIONS_PATH = path.join(process.env.HOME, '.openclaw', 'agents', 'main', 'sessions', 'sessions.json');
const STATS_PATH = path.join(process.env.HOME, '.openclaw', 'token-stats.json');
const POLL_INTERVAL = 5000; // 5 seconds

// ─── Helpers ──────────────────────────────────────────────────────────────
const SHANGHAI_OFFSET = 8 * 3600 * 1000;

function getShanghaiDateKey(ts) {
    const d = ts ? new Date(ts + SHANGHAI_OFFSET) : new Date(Date.now() + SHANGHAI_OFFSET);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getShanghaiMonthKey(ts) {
    return getShanghaiDateKey(ts).substring(0, 7);
}

// ─── Stats Manager ────────────────────────────────────────────────────────
class TokenStatsManager {
    constructor() {
        this.stats = this.load();
        this.lastSessionHash = null;
    }

    load() {
        try {
            if (fs.existsSync(STATS_PATH)) {
                return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
            }
        } catch (e) { /* ignore */ }
        return { dateKey: getShanghaiDateKey(), todayTokens: 0, monthTokens: 0, allTimeTokens: 0 };
    }

    save() {
        try {
            const dir = path.dirname(STATS_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATS_PATH, JSON.stringify(this.stats, null, 2), 'utf8');
        } catch (e) {
            console.error('[token-aggregator] save error:', e.message);
        }
    }

    // Check if stats are stale (new day / new month)
    refresh() {
        const today = getShanghaiDateKey();
        const thisMonth = today.substring(0, 7);

        if (this.stats.dateKey !== today) {
            // New day: keep month, reset day
            this.stats.dateKey = today;
            this.stats.todayTokens = 0;
            // If new month, reset month too
            if (!this.stats.dateKey || this.stats.dateKey.substring(0, 7) !== thisMonth) {
                this.stats.monthTokens = 0;
            }
        }
    }

    // Process all sessions and recompute totals
    recompute() {
        try {
            if (!fs.existsSync(SESSIONS_PATH)) return;

            const raw = fs.readFileSync(SESSIONS_PATH, 'utf8');
            const sessions = JSON.parse(raw);
            const currentHash = require('crypto').createHash('md5').update(raw).digest('hex');

            // Skip if no changes
            if (currentHash === this.lastSessionHash) return;
            this.lastSessionHash = currentHash;

            const today = getShanghaiDateKey();
            const thisMonth = today.substring(0, 7);
            let tDay = 0, tMonth = 0, tAll = 0;

            for (const [key, entry] of Object.entries(sessions)) {
                if (typeof entry !== 'object' || !entry) continue;
                const ts = entry.updatedAt || entry.lastInteractionAt || 0;
                if (!ts) continue;

                const entryDate = getShanghaiDateKey(ts);
                const inT = typeof entry.inputTokens === 'number' ? entry.inputTokens : 0;
                const outT = typeof entry.outputTokens === 'number' ? entry.outputTokens : 0;
                const total = inT + outT;

                if (entryDate === today) tDay += total;
                if (entryDate.substring(0, 7) === thisMonth) tMonth += total;
                tAll += total; // always accumulate for all-time
            }

            this.stats.dateKey = today;
            this.stats.todayTokens = tDay;
            this.stats.monthTokens = tMonth;
            // allTimeTokens only goes up — never reset
            if (tAll > (this.stats.allTimeTokens || 0)) {
                this.stats.allTimeTokens = tAll;
            }

            this.save();
        } catch (e) {
            console.error('[token-aggregator] recompute error:', e.message);
        }
    }

    start() {
        console.log('[token-aggregator] started (poll every 5s)');
        this.recompute();
        this.interval = setInterval(() => {
            this.refresh();
            this.recompute();
        }, POLL_INTERVAL);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

// ─── Module Exports ───────────────────────────────────────────────────────
const manager = new TokenStatsManager();

// Automatic start when loaded as plugin
if (require.main === module || process.env.OPENCLAW_PLUGIN) {
    manager.start();
}

module.exports = { TokenStatsManager, manager };
