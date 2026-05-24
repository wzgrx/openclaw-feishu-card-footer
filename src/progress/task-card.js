"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * TaskCard — builds the /tasks independent card showing all background tasks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTaskCard = buildTaskCard;

/**
 * Build a Feishu interactive card for the /tasks command.
 * Shows all running/pending/completed tasks with progress bars.
 */
function buildTaskCard(tasks) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("zh-CN", { hour12: false });

    const running = tasks.filter(t => t.status === "running");
    const completed = tasks.filter(t => t.status === "success" || t.status === "error");

    const header = {
        "tag": "div",
        "text": {
            "tag": "lark_md",
            "content": `**📋 后台任务面板**　⏰ ${timeStr}`
        }
    };

    const elements = [header];

    // Running tasks section
    if (running.length > 0) {
        elements.push({ "tag": "hr" });
        elements.push({
            "tag": "div",
            "text": { "tag": "lark_md", "content": `**🟢 运行中 (${running.length})**` }
        });
        for (const t of running) {
            const pct = Math.min(100, Math.max(0, t.progress || 0));
            const bar = createProgressBar(pct);
            const eta = t.etaMs > 0 ? formatDuration(t.etaMs) : "估算中...";
            const elapsed = formatDuration(t.elapsedMs || 0);
            const icon = getTypeIcon(t.type);
            elements.push({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": `**${icon} ${t.name}**\n${bar} **${pct}%**\n⏱️ ${elapsed} · ETA ${eta}`
                }
            });
        }
    }

    // Completed tasks section
    if (completed.length > 0) {
        elements.push({ "tag": "hr" });
        elements.push({
            "tag": "div",
            "text": { "tag": "lark_md", "content": `**✅ 已完成 (${completed.length})**` }
        });
        for (const t of completed.slice(0, 10)) {
            const elapsed = formatDuration(t.elapsedMs || 0);
            const icon = t.status === "success" ? "✅" : "❌";
            elements.push({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": `${icon} **${t.name}**　⏱️ ${elapsed}`
                }
            });
        }
    }

    if (running.length === 0 && completed.length === 0) {
        elements.push({
            "tag": "div",
            "text": { "tag": "lark_md", "content": "暂无后台任务" }
        });
    }

    // Refresh hint
    elements.push({ "tag": "hr" });
    elements.push({
        "tag": "div",
        "text": { "tag": "lark_md", "content": "💡 输入 /tasks 刷新" }
    });

    return {
        "config": { "wide_screen_mode": true },
        "header": {
            "title": { "tag": "plain_text", "content": "📋 后台任务" },
            "template": "blue"
        },
        "elements": elements
    };
}

/** Create a visual progress bar string. */
function createProgressBar(pct) {
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return "█".repeat(filled) + "░".repeat(empty);
}

/** Format milliseconds to human-readable duration. */
function formatDuration(ms) {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return `${min}m ${sec}s`;
    const hr = Math.floor(min / 60);
    const m = min % 60;
    return `${hr}h ${m}m`;
}

/** Get icon for task type. */
function getTypeIcon(type) {
    const icons = {
        download: "📥",
        compile: "🔧",
        git_clone: "📦",
        transcribe: "🎤",
        install: "📦",
        generic: "🔄"
    };
    return icons[type] || "🔄";
}
