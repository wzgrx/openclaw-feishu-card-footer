"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Task Manager — monitors background task progress files and publishes
 * events so the Feishu card footer can display real-time progress.
 *
 * Protocol:
 *   Background tasks write progress to /tmp/openclaw-tasks/{taskId}.json
 *   TaskManager polls these files every 3s and publishes events.
 *
 * Events published on the event-bus:
 *   task_progress   { taskId, name, type, progress, status, elapsedMs, etaMs }
 *   task_completed  { taskId, name, status, elapsedMs }
 *   task_error      { taskId, name, error }
 *   task_list       [ { taskId, name, type, progress, status, ... } ]
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = void 0;

const fs = require("fs");
const path = require("path");
const eventBus = require("../channel/event-bus");

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const TASK_DIR = "/tmp/openclaw-tasks";
const BRIDGE_DIR = "/tmp/task-progress";
const POLL_MS = 3000;         // 轮询间隔
const MAX_AGE_MS = 86400000;  // 24h 后清理已完成任务

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------
class TaskManager {
    constructor(taskDir, pollMs) {
        this._taskDir = taskDir || TASK_DIR;
        this._pollMs = pollMs || POLL_MS;
        this._tasks = new Map();   // taskId → cached task
        this._timer = null;
        this._setupTaskDir();
    this._setupBridgeDir();
    }

    /** Ensure the task directory exists (create on demand). */
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

    /** Start polling. */
    start() {
        if (this._timer) return;
        // Immediate scan
        this._scan();
        this._timer = setInterval(() => this._scan(), this._pollMs);
        // Publish full list every 5 scans
        this._listTimer = setInterval(() => this._publishList(), this._pollMs * 5);
    }

    /** Stop polling. */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (this._listTimer) {
            clearInterval(this._listTimer);
            this._listTimer = null;
        }
    }

    /** Scan the task directory for progress files. */
    _scan() {
        let files;
        try {
            files = fs.readdirSync(this._taskDir);
        } catch (_) { return; }

        const now = Date.now();
        for (const f of files) {
            if (!f.endsWith(".json")) continue;
            const fp = path.join(this._taskDir, f);
            let raw;
            try {
                raw = fs.readFileSync(fp, "utf-8");
            } catch (_) { continue; }
            let task;
            try { task = JSON.parse(raw); } catch (_) { continue; }
            if (!task.taskId) continue;

            const prev = this._tasks.get(task.taskId);
            this._tasks.set(task.taskId, task);

            // Calculate ETA
            const etaMs = this._calcEta(task);

            // Detect status transitions
            const prevStatus = prev ? prev.status : undefined;

            // Publish progress (always)
            eventBus.publish("task_progress", {
                taskId: task.taskId,
                name: task.name,
                type: task.type,
                progress: task.progress ?? 0,
                status: task.status,
                elapsedMs: task.elapsedMs ?? 0,
                etaMs,
                logFile: task.logFile,
            });

            // Write bridge file for streaming card to read
            this._writeBridgeFile(task);
            this._updateStreamingCard(task).catch(function() {});

            // Publish completion / error
            if (task.status === "success" && prevStatus !== "success") {
                eventBus.publish("task_completed", {
                    taskId: task.taskId,
                    name: task.name,
                    status: "success",
                    elapsedMs: task.elapsedMs ?? 0,
                });
            } else if (task.status === "error" && prevStatus !== "error") {
                eventBus.publish("task_error", {
                    taskId: task.taskId,
                    name: task.name,
                    error: task.error || "Unknown error",
                    elapsedMs: task.elapsedMs ?? 0,
                });
            }

            // Clean up old completed tasks
            if (task.status === "success" || task.status === "error") {
                const age = now - (task.startTime || task.elapsedMs || 0);
                if (age > MAX_AGE_MS) {
                    try { fs.unlinkSync(fp); } catch (_) {}
                }
            }
        }
    }

    /** Rough ETA estimate based on progress and elapsed time. */
    _calcEta(task) {
        const p = task.progress;
        const e = task.elapsedMs;
        if (!p || p <= 0 || !e || e <= 0) return -1;
        if (p >= 100) return 0;
        return Math.round((e / p) * (100 - p));
    }

    /** Publish the full task list. */
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
            }))
            .sort((a, b) => {
                // Running tasks first, then by startTime
                if (a.status === "running" && b.status !== "running") return -1;
                if (a.status !== "running" && b.status === "running") return 1;
                return (b.elapsedMs || 0) - (a.elapsedMs || 0);
            });
        eventBus.publish("task_list", list);
    }

    /** Get all cached tasks. */
    getTasks() {
        return Array.from(this._tasks.values());
    }

    /** Get a single task by ID. */
    getTask(taskId) {
        return this._tasks.get(taskId) || null;
    }

    // ── Static helper: create progress file ──
    static createProgressFile(taskId, name, type) {
        const dir = TASK_DIR;
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        const data = {
            taskId,
            name,
            type,
            status: "running",
            progress: 0,
            elapsedMs: 0,
            startTime: Date.now(),
            createdAt: new Date().toISOString(),
        };
        const fp = path.join(dir, `${taskId}.json`);
        fs.writeFileSync(fp, JSON.stringify(data, null, 2));
        return fp;
    }

    /** Update a field in a progress file. */
    static updateProgress(taskId, updates) {
        const dir = TASK_DIR;
        const fp = path.join(dir, `${taskId}.json`);
        try {
            const raw = fs.readFileSync(fp, "utf-8");
            const data = JSON.parse(raw);
            Object.assign(data, updates);
            data.elapsedMs = Date.now() - (data.startTime || Date.now());
            fs.writeFileSync(fp, JSON.stringify(data, null, 2));
        } catch (_) {}
    }

    /** Mark task as complete. */
    static completeTask(taskId, status, extra) {
        TaskManager.updateProgress(taskId, { status, progress: 100, ...extra });
    }
}



/**
 * Set Feishu API credentials for sending independent progress cards.
 */
TaskManager.prototype.setCredentials = function(appId, appSecret, domain) {
    this._feishuAppId = appId;
    this._feishuAppSecret = appSecret;
    this._feishuDomain = domain || 'feishu';
};

/**
 * Resolve Feishu API base URL from domain.
 */
TaskManager.prototype._resolveApiBase = function() {
    const d = this._feishuDomain || 'feishu';
    if (d === 'feishu') return 'https://open.feishu.cn/open-apis';
    if (d === 'lark') return 'https://open.larksuite.com/open-apis';
    if (d.startsWith('http')) return d.replace(/\/+$/, '') + '/open-apis';
    return 'https://open.feishu.cn/open-apis';
};

/**
 * Send or update an independent progress card for a background task.
 * Called from _scan() for each task with chatId.
 */
TaskManager.prototype._updateStreamingCard = async function(task) {
    if (!this._feishuAppId) return;
    if (!task.chatId) return;
    try {
        // Read bridge content
        const bridgePath = path.join('/tmp/task-progress', task.chatId + '.txt');
        let bridgeContent;
        try { bridgeContent = fs.readFileSync(bridgePath, 'utf8').trim(); } catch (e) { return; }
        if (!bridgeContent) return;

        // Get Feishu token
        const apiBase = this._resolveApiBase();
        let token = null;
        try {
            const resp = await fetch(apiBase + '/auth/v3/tenant_access_token/internal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ app_id: this._feishuAppId, app_secret: this._feishuAppSecret })
            });
            const data = await resp.json();
            if (data.code === 0 && data.tenant_access_token) token = data.tenant_access_token;
        } catch (e) { return; }
        if (!token) return;

        // Build card JSON
        const cardPayload = {
            schema: '2.0',
            config: { wide_screen_mode: true, update_multi: true },
            body: {
                elements: [{
                    tag: 'collapsible_panel',
                    expanded: true,
                    header: {
                        title: { tag: 'plain_text', content: '📊 任务总进度', text_color: 'grey', text_size: 'notation' }
                    },
                    border: { color: 'grey', corner_radius: '5px' },
                    vertical_spacing: '4px',
                    padding: '8px 8px 8px 8px',
                    elements: [{ tag: 'markdown', content: bridgeContent, text_size: 'notation' }]
                }]
            }
        };

        const fullCardJson = JSON.stringify({ type: 'card', data: { card: cardPayload } });
        const existingCardId = task.__progressCardId;

        if (existingCardId) {
            // UPDATE existing card
            await fetch(apiBase + '/im/v1/messages/' + existingCardId, {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify({ content: fullCardJson, msg_type: 'interactive' })
            });
        } else {
            // CREATE new independent card
            const resp = await fetch(apiBase + '/im/v1/messages?receive_id_type=chat_id', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify({
                    receive_id: task.chatId,
                    msg_type: 'interactive',
                    content: fullCardJson
                })
            });
            const result = await resp.json();
            // Store new card's messageId for future updates
            if (result.code === 0 && result.data && result.data.message_id) {
                try {
                    const taskFp = path.join('/tmp/openclaw-tasks', task.taskId + '.json');
                    const raw = fs.readFileSync(taskFp, 'utf8');
                    const td = JSON.parse(raw);
                    td.__progressCardId = result.data.message_id;
                    fs.writeFileSync(taskFp, JSON.stringify(td, null, 2));
                } catch (e) {}
            }
        }

        // Clean up bridge file when done
        if (task.status === 'success' || task.status === 'error') {
            try { fs.unlinkSync(bridgePath); } catch (e) {}
        }
    } catch (e) {}
};
exports.TaskManager = TaskManager;

/**
 * Write progress bridge file for streaming card to read.
 * The card's buildProgressPanel reads this file and includes content.
 */
TaskManager.prototype._writeBridgeFile = function(task) {
    if (!task.chatId) return;
    try {
        const { buildProgressText, buildCompletionText } = require('./task-card.js');
        const text = (task.status === 'success' || task.status === 'error')
            ? buildCompletionText(task)
            : buildProgressText(task);
        fs.writeFileSync(path.join(BRIDGE_DIR, task.chatId + '.txt'), text);
    } catch (_) {}
};

// ── Auto-start TaskManager when module is loaded ──
if (!global._feishuTaskManagerStarted) {
    global._feishuTaskManagerStarted = true;
    try {
        const tm = new TaskManager();
        global._feishuTaskManager = tm;
        tm.start();
    } catch (_) {}
}
