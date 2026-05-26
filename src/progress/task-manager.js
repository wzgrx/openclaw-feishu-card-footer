"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Task Manager v2 — monitors background task progress files, sends
 * independent Feishu progress cards, detects stalled tasks.
 *
 * Protocol (compatible with openclaw-task-watchdog):
 *   Tasks write progress to /tmp/openclaw-tasks/{taskId}.json
 *   TaskManager polls files every 3s, publishes events, sends Feishu cards.
 *
 * Task file format:
 *   {
 *     taskId: string,        // unique id
 *     name: string,          // human-readable name
 *     type: string,          // download|compile|git_clone|transcribe|generic
 *     status: string,        // running|success|error|stalled
 *     progress: number,      // 0-100
 *     chatId: string,        // Feishu chat to send progress card to
 *     __progressCardId: string, // (internal) Feishu message_id for card updates
 *     startTime: number,     // Date.now() at creation
 *     lastUpdated: number,   // Date.now() at last write
 *     elapsedMs: number,     // auto-calculated
 *     error: string,         // error message if status=error
 *     logFile: string,       // optional log file path
 *   }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = void 0;

const fs = require("fs");
const path = require("path");
const eventBus = require("../channel/event-bus.js");
let cardBuilder = null;
try { cardBuilder = require("./standalone-card-builder.js"); } catch (_) {}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const TASK_DIR = "/tmp/openclaw-tasks";
const BRIDGE_DIR = "/tmp/task-progress";
const POLL_MS = 3000;                // 轮询间隔
const STALE_THRESHOLD_MS = 300000;   // 5 分钟无更新 → stalled
const MAX_AGE_MS = 86400000;         // 24h 后清理已完成任务
const NOTIFIED_TTL_MS = 600000;      // 幂等通知 10 分钟 TTL

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------
class TaskManager {
    constructor(taskDir, pollMs) {
        this._taskDir = taskDir || TASK_DIR;
        this._pollMs = pollMs || POLL_MS;
        this._tasks = new Map();        // taskId → cached task
        this._notifiedKeys = new Map(); // idempotency key → timestamp
        this._sentCards = new Map();    // taskId → { messageId, firstSentAt }
        this._timer = null;
        this._listTimer = null;
        this._stallTimer = null;
        this._feishuAppId = null;
        this._feishuAppSecret = null;
        this._feishuDomain = 'feishu';
        this._tenantToken = null;
        this._tokenExpiresAt = 0;
        this._setupTaskDir();
        this._setupBridgeDir();
    }

    /** Ensure the task directory exists. */
    _setupTaskDir() {
        try {
            if (!fs.existsSync(this._taskDir)) {
                fs.mkdirSync(this._taskDir, { recursive: true });
            }
        } catch (_) { /* best effort */ }
    }

    /** Ensure bridge directory exists. */
    _setupBridgeDir() {
        try { fs.mkdirSync(BRIDGE_DIR, { recursive: true }); } catch (_) {}
    }

    /** Start polling and stall detection. */
    start() {
        if (this._timer) return;
        // Immediate scan
        this._scan();
        this._timer = setInterval(() => this._scan(), this._pollMs);
        // Publish full list every 15s
        this._listTimer = setInterval(() => this._publishList(), this._pollMs * 5);
        // Stall detection every 30s
        this._stallTimer = setInterval(() => this._checkStale(), 30000);
        console.log("[TaskManager] started (poll=" + this._pollMs + "ms)");
    }

    /** Stop polling. */
    stop() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._listTimer) { clearInterval(this._listTimer); this._listTimer = null; }
        if (this._stallTimer) { clearInterval(this._stallTimer); this._stallTimer = null; }
        // Cleanup caches
        this._tasks.clear();
        this._notifiedKeys.clear();
        this._sentCards.clear();
        console.log("[TaskManager] stopped");
    }

    // ── Scan task directory ───────────────────────────────────────────────

    _scan() {
        let files;
        try { files = fs.readdirSync(this._taskDir); } catch (_) { return; }

        const now = Date.now();
        for (const f of files) {
            if (!f.endsWith(".json")) continue;
            const fp = path.join(this._taskDir, f);
            let raw;
            try { raw = fs.readFileSync(fp, "utf-8"); } catch (_) { continue; }
            let task;
            try { task = JSON.parse(raw); } catch (_) { continue; }
            if (!task.taskId) continue;

            const prev = this._tasks.get(task.taskId);
            task.lastUpdated = task.lastUpdated || now;
            this._tasks.set(task.taskId, task);

            // Auto-calculate elapsedMs
            if (task.startTime) {
                task.elapsedMs = now - task.startTime;
            }

            const etaMs = this._calcEta(task);
            const prevStatus = prev ? prev.status : undefined;

            // Publish progress event
            eventBus.publish("task_progress", {
                taskId: task.taskId,
                name: task.name,
                type: task.type,
                progress: task.progress ?? 0,
                status: task.status,
                elapsedMs: task.elapsedMs ?? 0,
                etaMs,
                logFile: task.logFile,
                chatId: task.chatId,
            });

            // Write bridge file for builder.js to read
            this._writeBridgeFile(task);

            // Send/update independent Feishu progress card
            this._updateProgressCard(task).catch(function() {});

            // Publish completion / error (only once)
            if (task.status === "success" && prevStatus !== "success") {
                eventBus.publish("task_completed", {
                    taskId: task.taskId,
                    name: task.name,
                    status: "success",
                    elapsedMs: task.elapsedMs ?? 0,
                });
                this._notifyStale = false;
            } else if (task.status === "error" && prevStatus !== "error") {
                eventBus.publish("task_error", {
                    taskId: task.taskId,
                    name: task.name,
                    error: task.error || "Unknown error",
                    elapsedMs: task.elapsedMs ?? 0,
                });
            } else if (task.status === "stalled" && prevStatus !== "stalled") {
                eventBus.publish("task_error", {
                    taskId: task.taskId,
                    name: task.name,
                    error: "Task stalled — no progress update for " + Math.round(STALE_THRESHOLD_MS / 60000) + " minutes",
                    elapsedMs: task.elapsedMs ?? 0,
                });
            }

            // Clean up old completed tasks
            if (task.status === "success" || task.status === "error" || task.status === "stalled") {
                const age = now - task.startTime;
                if (age > MAX_AGE_MS) {
                    try { fs.unlinkSync(fp); } catch (_) {}
                    this._tasks.delete(task.taskId);
                }
            }
        }
    }

    // ── Stall detection ────────────────────────────────────────────────────

    _checkStale() {
        const now = Date.now();
        for (const [taskId, task] of this._tasks) {
            if (task.status !== "running") continue;
            const lastUp = task.lastUpdated || task.startTime || now;
            const age = now - lastUp;
            if (age > STALE_THRESHOLD_MS) {
                // Mark as stalled in the task file
                task.status = "stalled";
                task.error = "No progress update for " + Math.round(age / 60000) + " minutes";
                const fp = path.join(this._taskDir, taskId + ".json");
                try {
                    fs.writeFileSync(fp, JSON.stringify(task, null, 2));
                } catch (_) {}
                console.log("[TaskManager] STALLED:", taskId, task.name, "age=" + Math.round(age/1000) + "s");
            }
        }
    }

    // ── ETA calculation ────────────────────────────────────────────────────

    _calcEta(task) {
        const p = task.progress;
        const e = task.elapsedMs;
        if (!p || p <= 0 || !e || e <= 0) return -1;
        if (p >= 100) return 0;
        return Math.round((e / p) * (100 - p));
    }

    // ── Publish task list ──────────────────────────────────────────────────

    _publishList() {
        const list = Array.from(this._tasks.values())
            .map(t => ({
                taskId: t.taskId,
                name: t.name,
                type: t.type,
                progress: t.progress ?? 0,
                status: t.status,
                elapsedMs: t.elapsedMs ?? 0,
                etaMs: this._calcEta(t),
                chatId: t.chatId,
            }))
            .sort((a, b) => {
                if (a.status === "running" && b.status !== "running") return -1;
                if (a.status !== "running" && b.status === "running") return 1;
                return (b.elapsedMs || 0) - (a.elapsedMs || 0);
            });
        eventBus.publish("task_list", list);
    }

    // ── Getters ────────────────────────────────────────────────────────────

    getTasks() {
        return Array.from(this._tasks.values());
    }

    getTask(taskId) {
        return this._tasks.get(taskId) || null;
    }

    // ── Static helpers: create/update/complete tasks ──────────────────────

    static createProgressFile(taskId, name, type, chatId) {
        const dir = TASK_DIR;
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        const now = Date.now();
        const data = {
            taskId: taskId || "task_" + now,
            name: name || "Task",
            type: type || "generic",
            status: "running",
            progress: 0,
            elapsedMs: 0,
            startTime: now,
            lastUpdated: now,
            createdAt: new Date().toISOString(),
            chatId: chatId || "",
        };
        const fp = path.join(dir, (taskId || "task_" + now) + ".json");
        fs.writeFileSync(fp, JSON.stringify(data, null, 2));
        return fp;
    }

    static updateProgress(taskId, updates) {
        const dir = TASK_DIR;
        const fp = path.join(dir, taskId + ".json");
        try {
            const raw = fs.readFileSync(fp, "utf-8");
            const data = JSON.parse(raw);
            Object.assign(data, updates);
            data.lastUpdated = Date.now();
            if (data.startTime) data.elapsedMs = Date.now() - data.startTime;
            fs.writeFileSync(fp, JSON.stringify(data, null, 2));
        } catch (_) {}
    }

    static completeTask(taskId, status, extra) {
        TaskManager.updateProgress(taskId, Object.assign({ status: status || "success", progress: 100 }, extra || {}));
    }
}

// ── Feishu credentials ─────────────────────────────────────────────────────

TaskManager.prototype.setCredentials = function(appId, appSecret, domain) {
    console.log("[TaskManager] setCredentials: appId=" + (appId ? "yes" : "NO") + " domain=" + (domain || "feishu"));
    this._feishuAppId = appId;
    this._feishuAppSecret = appSecret;
    this._feishuDomain = domain || 'feishu';
};

// ── Feishu API helpers ─────────────────────────────────────────────────────

TaskManager.prototype.setLarkClient = function(lark) {
    this._lark = lark;
    console.log("[TaskManager] LarkClient set");
};

TaskManager.prototype.setFeishuChatId = function(chatId) {
    this._defaultChatId = chatId;
};


TaskManager.prototype.setConfig = function(cfg) {
    this._cfg = cfg;
    console.log('[TM] config set');
};

TaskManager.prototype._resolveApiBase = function() {
    const d = this._feishuDomain || 'feishu';
    if (d === 'feishu') return 'https://open.feishu.cn/open-apis';
    if (d === 'lark') return 'https://open.larksuite.com/open-apis';
    if (d.startsWith('http')) return d.replace(/\/+$/, '') + '/open-apis';
    return 'https://open.feishu.cn/open-apis';
};

TaskManager.prototype._getToken = async function() {
    const now = Date.now();
    if (this._tenantToken && now < this._tokenExpiresAt - 60000) {
        return this._tenantToken; // reuse cached token
    }
    if (!this._feishuAppId || !this._feishuAppSecret) return null;
    try {
        const apiBase = this._resolveApiBase();
        const resp = await fetch(apiBase + '/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ app_id: this._feishuAppId, app_secret: this._feishuAppSecret })
        });
        const data = await resp.json();
        if (data.code === 0 && data.tenant_access_token) {
            this._tenantToken = data.tenant_access_token;
            this._tokenExpiresAt = now + (data.expire || 7200) * 1000;
            return this._tenantToken;
        }
        console.log("[TaskManager] token error:", data.code, data.msg);
    } catch (e) {}
    return null;
};

// ── Format duration ────────────────────────────────────────────────────────

function formatDuration(ms) {
    if (!ms || ms < 0) return "0s";
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return totalSec + "s";
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return min + "m " + sec + "s";
    const hr = Math.floor(min / 60);
    const m = min % 60;
    return hr + "h " + m + "m";
}

function getStatusEmoji(status) {
    switch (status) {
        case "running": return "🟢";
        case "success": return "✅";
        case "error": return "❌";
        case "stalled": return "⚠️";
        default: return "⚪";
    }
}

/** Build a visual progress bar string. */
function createProgressBar(pct) {
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return "\u2588".repeat(Math.max(0, filled)) + "\u2591".repeat(Math.max(0, empty));
}

/** Get icon for task type. */
function getTypeIcon(type) {
    var icons = {
        download: "\ud83d\udce5",
        compile: "\ud83d\udd27",
        git_clone: "\ud83d\udce6",
        transcribe: "\ud83c\udfa4",
        install: "\ud83d\udce6",
        search: "\ud83d\udd0d",
        generic: "\ud83d\udd04"
    };
    return icons[type] || "\ud83d\udd04";
}

// ── Send/update independent Feishu progress card ──────────────────────────

TaskManager.prototype._updateProgressCard = async function(task) {
    if (!task.chatId) return;
    try {
        var token = await this._getToken();
        if (!token) return;
        var apiBase = this._resolveApiBase();
        var taskName = task.name || 'Task';
        var pct = Math.min(100, Math.max(0, task.progress || 0));
        var elapsed = formatDuration(task.elapsedMs);
        var icon = getTypeIcon(task.type);
        var cardText = '';
        if (task.status === 'running') {
            cardText = '**' + icon + ' ' + taskName + '**\n' + '\u2588'.repeat(Math.round(pct/10)) + '\u2591'.repeat(Math.round((100-pct)/10)) + ' **' + pct + '%**\n\u23f1\ufe0f ' + elapsed;
        } else if (task.status === 'success') {
            cardText = '\u2705 **' + taskName + '**\n' + '\u2588'.repeat(10) + ' **100%**\n\u23f1\ufe0f ' + elapsed;
        } else {
            cardText = '\u26a0\ufe0f **' + taskName + '** - ' + (task.error || 'error') + '\n\u23f1\ufe0f ' + elapsed;
        }
        var template = task.status === 'error' || task.status === 'stalled' ? 'red' : task.status === 'success' ? 'green' : 'blue';
        var emoji = task.status === 'running' ? '\ud83d\udfe2' : task.status === 'success' ? '\u2705' : '\u26a0\ufe0f';
        var title = emoji + ' ' + taskName;
        var sentEntry = this._sentCards.get(task.taskId);
        var cardKitCardId = task._cardKitCardId || null;
        
        // === STRONG DEDUP: if card already exists, never create another ===
        if (sentEntry || task.__progressCardId) {
            var msgId = (sentEntry ? sentEntry.messageId : null) || task.__progressCardId;
            if (cardKitCardId) {
                // Try to update existing card via CardKit
                try {
                    var fullCard = { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: title }, template: template }, elements: [{ tag: 'div', text: { tag: 'lark_md', content: cardText } }] };
                    await fetch(apiBase + '/cardkit/v1/cards/' + cardKitCardId + '/batch_update', {
                        method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
                        body: JSON.stringify({ card: { type: 'card_json', data: JSON.stringify(fullCard) }, sequence: Date.now() })
                    });
                } catch (_) {}
            }
            // Always return — only ONE card per task, no matter what
            return;
        }
        
        // === CREATE path (only runs once per task) ===
        try {
            // First try: CardKit API (supports real-time updates)
            var fullCard = { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: title }, template: template }, elements: [{ tag: 'div', text: { tag: 'lark_md', content: cardText } }] };
            var body = JSON.stringify({ type: 'card_json', data: JSON.stringify(fullCard) });
            var resp = await fetch(apiBase + '/cardkit/v1/cards', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' }, body: body
            });
            var j = await resp.json();
            if (j.code === 0 && j.data?.card_id) {
                cardKitCardId = j.data.card_id;
                var msgResp = await fetch(apiBase + '/im/v1/messages?receive_id_type=chat_id', {
                    method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ receive_id: task.chatId, msg_type: 'interactive', content: JSON.stringify({ type: 'card', data: { card_id: cardKitCardId } }) })
                });
                var mj = await msgResp.json();
                if (mj.code === 0 && mj.data?.message_id) {
                    this._sentCards.set(task.taskId, { messageId: mj.data.message_id });
                    try { var fp = path.join(this._taskDir, task.taskId + '.json'); var d = JSON.parse(fs.readFileSync(fp, 'utf8')); d.__progressCardId = mj.data.message_id; d._cardKitCardId = cardKitCardId; fs.writeFileSync(fp, JSON.stringify(d, null, 2)); } catch (_) {}
                    return;
                }
            }
            // Fallback: inline card via IM API (static, no updates)
            var fbResp = await fetch(apiBase + '/im/v1/messages?receive_id_type=chat_id', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ receive_id: task.chatId, msg_type: 'interactive', content: JSON.stringify(fullCard) })
            });
            var fj = await fbResp.json();
            if (fj.code === 0 && fj.data?.message_id) {
                this._sentCards.set(task.taskId, { messageId: fj.data.message_id });
                try { var fp = path.join(this._taskDir, task.taskId + '.json'); var d = JSON.parse(fs.readFileSync(fp, 'utf8')); d.__progressCardId = fj.data.message_id; fs.writeFileSync(fp, JSON.stringify(d, null, 2)); } catch (_) {}
            }
        } catch (e) { console.log('[TM] create err:', String(e)); }
    } catch (e) { console.log('[TM] err:', String(e)); }
};







TaskManager.prototype._writeBridgeFile = function(task) {
    if (!task.chatId) return;
    try {
        var pct = Math.min(100, Math.max(0, task.progress || 0));
        var bar = createProgressBar(pct);
        var elapsed = formatDuration(task.elapsedMs);
        var icon = getTypeIcon(task.type);
        var content = "";

        if (task.status === "running") {
            content = getStatusEmoji(task.status) + " **" + icon + " " + task.name + "**\n";
            content += bar + " **" + pct + "%**\n";
            content += "\u23f1\ufe0f " + elapsed;
            if (pct > 0 && pct < 100) {
                var etaMs = this._calcEta(task);
                if (etaMs > 0) content += " \u00b7 ETA " + formatDuration(etaMs);
            }
        } else if (task.status === "success") {
            content = "✅ **" + task.name + "** \u5df2\u5b8c\u6210\n";
            content += bar + " 100%\n";
            content += "\u23f1\ufe0f " + elapsed;
        } else if (task.status === "error") {
            content = "❌ **" + task.name + "** \u6267\u884c\u5931\u8d25\n";
            content += "\u23f1\ufe0f " + elapsed + "\n";
            if (task.error) content += "\u26a0\ufe0f " + task.error;
        } else if (task.status === "stalled") {
            content = "\u26a0\ufe0f **" + task.name + "** \u4efb\u52a1\u505c\u6ede\n";
            content += "\u23f1\ufe0f " + elapsed + "\n";
            if (task.error) content += "\u26a0\ufe0f " + task.error;
        }

        fs.writeFileSync(path.join(BRIDGE_DIR, task.chatId + ".txt"), content);
    } catch (_) {}
};

// ── Idempotency helpers ────────────────────────────────────────────────────

TaskManager.prototype._isNotified = function(key) {
    return this._notifiedKeys.has(key);
};

TaskManager.prototype._markNotified = function(key) {
    this._notifiedKeys.set(key, Date.now());
    // Cleanup old entries
    var now = Date.now();
    if (this._notifiedKeys.size > 1000) {
        for (var k of this._notifiedKeys.keys()) {
            if (now - this._notifiedKeys.get(k) > NOTIFIED_TTL_MS) {
                this._notifiedKeys.delete(k);
            }
        }
    }
};

exports.TaskManager = TaskManager;

// ── Auto-start ─────────────────────────────────────────────────────────────
if (!global._feishuTaskManagerStarted) {
    global._feishuTaskManagerStarted = true;
    try {
        var tm = new TaskManager();
        global._feishuTaskManager = tm;
        tm.start();
    } catch (_) {}
}
