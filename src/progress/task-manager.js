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
        tm.start();
    } catch (_) {}
}
