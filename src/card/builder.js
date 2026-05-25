"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Interactive card building for Lark/Feishu.
 *
 * Provides utilities to construct Feishu Interactive Message Cards for
 * different agent response states (thinking, streaming, complete, confirm).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REASONING_ELEMENT_ID = exports.STREAMING_ELEMENT_ID = void 0;
exports.splitReasoningText = splitReasoningText;
exports.stripReasoningTags = stripReasoningTags;
// Ensure TaskManager is loaded (auto-starts when required)
require('../progress/task-manager.js');
exports.formatReasoningDuration = formatReasoningDuration;
exports.formatToolUseDuration = formatToolUseDuration;
exports.formatElapsed = formatElapsed;
exports.compactNumber = compactNumber;
exports.calcModelCost = calcModelCost;
exports.formatFooterRuntimeSegments = formatFooterRuntimeSegments;
exports.buildCardContent = buildCardContent;
exports.buildStreamingThinkingCard = buildStreamingThinkingCard;
exports.buildStreamingPreAnswerCard = buildStreamingPreAnswerCard;
exports.toCardKit2 = toCardKit2;
const markdown_style_1 = require("./markdown-style.js");
const tool_use_display_1 = require("./tool-use-display.js");
const fs = require('fs');
const path = require('path');
const os = require('os');
const TASK_DIR = '/tmp/openclaw-tasks';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Element ID used for the streaming text area in cards. The CardKit
 * `cardElement.content()` API targets this element for typewriter-effect
 * streaming updates.
 */
exports.STREAMING_ELEMENT_ID = 'streaming_content';
exports.REASONING_ELEMENT_ID = 'reasoning_content';
const TOOL_USE_STEP_CONTENT_INDENT = '0px 0px 0px 22px';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// ---- Reasoning text utilities ----
// Mirrors the logic in the framework's `splitTelegramReasoningText` and
// related helpers from `plugin-sdk/telegram/reasoning-lane-coordinator`.
// Those are not exported from the public plugin-sdk entry, so we replicate
// the same detection/splitting logic here.
const REASONING_PREFIX = 'Reasoning:\n';
/**
 * Split a payload text into optional `reasoningText` and `answerText`.
 *
 * Handles two formats produced by the framework:
 * 1. "Reasoning:\n_italic line_\n…" prefix (from `formatReasoningMessage`)
 * 2. `<think>…</think>` / `<thinking>…</thinking>` XML tags
 *
 * Equivalent to the framework's `splitTelegramReasoningText()`.
 */
function splitReasoningText(text) {
    if (typeof text !== 'string' || !text.trim())
        return {};
    const trimmed = text.trim();
    // Case 1: "Reasoning:\n..." prefix — the entire payload is reasoning
    if (trimmed.startsWith(REASONING_PREFIX) && trimmed.length > REASONING_PREFIX.length) {
        return { reasoningText: cleanReasoningPrefix(trimmed) };
    }
    // Case 2: XML thinking tags — extract content and strip from answer
    const taggedReasoning = extractThinkingContent(text);
    const strippedAnswer = stripReasoningTags(text);
    if (!taggedReasoning && strippedAnswer === text) {
        return { answerText: text };
    }
    return {
        reasoningText: taggedReasoning || undefined,
        answerText: strippedAnswer || undefined,
    };
}
/**
 * Extract content from `<think>`, `<thinking>`, `<thought>` blocks.
 * Handles both closed and unclosed (streaming) tags.
 */
function extractThinkingContent(text) {
    if (!text)
        return '';
    const scanRe = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
    let result = '';
    let lastIndex = 0;
    let inThinking = false;
    for (const match of text.matchAll(scanRe)) {
        const idx = match.index ?? 0;
        if (inThinking) {
            result += text.slice(lastIndex, idx);
        }
        inThinking = match[1] !== '/';
        lastIndex = idx + match[0].length;
    }
    // Handle unclosed tag (still streaming)
    if (inThinking) {
        result += text.slice(lastIndex);
    }
    return result.trim();
}
/**
 * Strip reasoning blocks — both XML tags with their content and any
 * "Reasoning:\n" prefixed content.
 */
function stripReasoningTags(text) {
    // Strip complete XML blocks
    let result = text.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*?<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
    // Strip unclosed tag at end (streaming)
    result = result.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*$/gi, '');
    // Strip orphaned closing tags
    result = result.replace(/<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
    return result.trim();
}
/**
 * Clean a "Reasoning:\n_italic_" formatted message back to plain text.
 * Strips the prefix and per-line italic markdown wrappers.
 */
function cleanReasoningPrefix(text) {
    let cleaned = text.replace(/^Reasoning:\s*/i, '');
    cleaned = cleaned
        .split('\n')
        .map((line) => line.replace(/^_(.+)_$/, '$1'))
        .join('\n');
    return cleaned.trim();
}
/**
 * Format reasoning duration into a human-readable i18n pair.
 * e.g. { zh: "思考了 3.2s", en: "Thought for 3.2s" }
 */
function formatReasoningDuration(ms) {
    const d = formatElapsed(ms);
    return { zh: `思考了 ${d}`, en: `Thought for ${d}` };
}
/**
 * Format tool-use duration into a human-readable i18n pair.
 */
function formatToolUseDuration(ms) {
    const d = formatElapsed(ms);
    return { zh: `执行耗时 ${d}`, en: `Tool use for ${d}` };
}
/**
 * Format milliseconds into a human-readable duration string.
 */
function formatElapsed(ms) {
    const seconds = ms / 1000;
    return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
/**
 * Build footer meta-info: notation-sized text with i18n support.
 * Error text is rendered in red; normal text uses default grey (notation).
 */
function buildFooter(zhText, enText, isError) {
    const zhContent = isError ? `<font color='red'>${zhText}</font>` : zhText;
    const enContent = isError ? `<font color='red'>${enText}</font>` : enText;
    return [
        {
            tag: 'markdown',
            content: enContent,
            i18n_content: { zh_cn: zhContent, en_us: enContent },
            text_size: 'notation',
        },
    ];
}
function compactNumber(value) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
        const m = value / 1_000_000;
        return Math.abs(m) >= 100 ? `${Math.round(m)}m` : `${m.toFixed(1)}m`;
    }
    if (abs >= 1_000) {
        const k = value / 1_000;
        return Math.abs(k) >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    return `${Math.round(value)}`;
}
function formatFooterRuntimeSegments(params) {
    const { footer, metrics, elapsedMs, isError, isAborted } = params;
    const primaryZh = [];
    const primaryEn = [];
    const detailZh = [];
    const detailEn = [];
    // --- Primary line: status, elapsed, model ---
    if (footer?.status) {
        if (isError) {
            primaryZh.push('出错');
            primaryEn.push('Error');
        }
        else if (isAborted) {
            primaryZh.push('已停止');
            primaryEn.push('Stopped');
        }
        else {
            primaryZh.push('已完成');
            primaryEn.push('Completed');
        }
    }
    if (footer?.elapsed && elapsedMs != null) {
        const d = formatElapsed(elapsedMs);
        primaryZh.push(`耗时 ${d}`);
        primaryEn.push(`Elapsed ${d}`);
    }
    if (footer?.model && metrics?.model) {
        const model = metrics.model.trim();
        if (model) {
            primaryZh.push(model);
            primaryEn.push(model);
        }
    }
    // --- Detail line: tokens, cache, context ---
    if (footer?.tokens && metrics) {
        const inTokens = typeof metrics.inputTokens === 'number' ? Math.max(0, metrics.inputTokens) : undefined;
        const outTokens = typeof metrics.outputTokens === 'number' ? Math.max(0, metrics.outputTokens) : undefined;
        if (inTokens != null && outTokens != null) {
            const inLabel = compactNumber(inTokens);
            const outLabel = compactNumber(outTokens);
            detailZh.push(`↑ ${inLabel} ↓ ${outLabel}`);
            detailEn.push(`↑ ${inLabel} ↓ ${outLabel}`);
        }
    }
    if (footer?.cache && metrics) {
        const read = typeof metrics.cacheRead === 'number' ? Math.max(0, metrics.cacheRead) : undefined;
        const write = typeof metrics.cacheWrite === 'number' ? Math.max(0, metrics.cacheWrite) : undefined;
        const inputVal = typeof metrics.inputTokens === 'number' ? Math.max(0, metrics.inputTokens) : undefined;
        if (read != null && write != null && inputVal != null) {
            const total = read + write + inputVal;
            const hit = total > 0 ? Math.round((read / total) * 100) : 0;
            const left = compactNumber(read);
            const right = compactNumber(write);
            detailZh.push(`缓存 ${left}/${right} (${hit}%)`);
            detailEn.push(`Cache ${left}/${right} (${hit}%)`);
        }
    }
    if (footer?.context && metrics) {
        const freshTotal = metrics.totalTokensFresh === false ? undefined : metrics.totalTokens;
        const total = typeof freshTotal === 'number' ? Math.max(0, freshTotal) : undefined;
        const ctx = typeof metrics.contextTokens === 'number' ? Math.max(0, metrics.contextTokens) : undefined;
        if (total != null && ctx != null) {
            const totalLabel = compactNumber(total);
            const ctxLabel = compactNumber(ctx);
            const pct = ctx > 0 ? Math.round((total / ctx) * 100) : 0;
            const pctLabel = `${pct}%`;
            detailZh.push(`上下文 ${totalLabel}/${ctxLabel} (${pctLabel})`);
            detailEn.push(`Context ${totalLabel}/${ctxLabel} (${pctLabel})`);
        }
    }
    return { primaryZh, primaryEn, detailZh, detailEn };
}
/**
 * Calculate total cost from model pricing and usage metrics.
 */
/** Read active background tasks from the task progress directory. */
function readActiveTasks() {
    try {
        if (!fs.existsSync(TASK_DIR)) return [];
        const files = fs.readdirSync(TASK_DIR).filter(f => f.endsWith('.json'));
        const tasks = [];
        for (const f of files) {
            try {
                const raw = fs.readFileSync(path.join(TASK_DIR, f), 'utf-8');
                const t = JSON.parse(raw);
                if (t.taskId && t.status) tasks.push(t);
            } catch (_) {}
        }
        return tasks;
    } catch (_) { return []; }
}

function calcModelCost(metrics, inputPrice, outputPrice, cacheReadPrice) {
    if (!metrics || inputPrice == null || outputPrice == null)
        return 0;
    const inT = typeof metrics.inputTokens === 'number' ? metrics.inputTokens : 0;
    const outT = typeof metrics.outputTokens === 'number' ? metrics.outputTokens : 0;
    const cacheReadT = typeof metrics.cacheRead === 'number' ? metrics.cacheRead : 0;
    return (inT * inputPrice + outT * outputPrice + cacheReadT * (cacheReadPrice ?? 0));
}
// ---------------------------------------------------------------------------
// buildCardContent
// ---------------------------------------------------------------------------
/**
 * Build a full Feishu Interactive Message Card JSON object for the
 * given state.
 */
function buildCardContent(state, data = {}) {
    switch (state) {
        case 'thinking':
            return buildThinkingCard();
        case 'streaming':
            return buildStreamingCard(data.text ?? '', {
                reasoningText: data.reasoningText,
                showToolUse: data.showToolUse,
                toolUseSteps: data.toolUseSteps,
                toolUseTitleSuffix: data.toolUseTitleSuffix,
            });
        case 'complete':
            return buildCompleteCard({
                text: data.text ?? '',
                elapsedMs: data.elapsedMs,
                isError: data.isError,
                reasoningText: data.reasoningText,
                reasoningElapsedMs: data.reasoningElapsedMs,
                toolUseSteps: data.toolUseSteps,
                toolUseTitleSuffix: data.toolUseTitleSuffix,
                toolUseElapsedMs: data.toolUseElapsedMs,
                showToolUse: data.showToolUse,
                isAborted: data.isAborted,
                firstTokenLatencyMs: data.firstTokenLatencyMs,
                footer: data.footer,
                footerMetrics: data.footerMetrics,
            });
        case 'confirm':
            return buildConfirmCard(data.confirmData);
        default:
            throw new Error(`Unknown card state: ${state}`);
    }
}
// ---------------------------------------------------------------------------
// Private card builders
// ---------------------------------------------------------------------------
function buildThinkingCard() {
    return {
        config: { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'] },
        elements: [
            {
                tag: 'markdown',
                content: 'Thinking...',
                i18n_content: { zh_cn: '思考中...', en_us: 'Thinking...' },
            },
        ],
    };
}
function buildStreamingCard(partialText, params = {}) {
    const { showToolUse = true, toolUseSteps, toolUseTitleSuffix, reasoningText } = params;
    const elements = [];
    const hasToolUse = Boolean(toolUseSteps?.length);
    if (showToolUse) {
        elements.push(hasToolUse
            ? buildToolUsePanel({
                toolUseSteps,
                titleSuffix: toolUseTitleSuffix,
            })
            : buildStreamingToolUsePendingPanel());
    }
    if (!partialText && reasoningText) {
        // Reasoning phase: show reasoning content in notation style
        elements.push({
            tag: 'markdown',
            content: `💭 **Thinking...**\n\n${reasoningText}`,
            i18n_content: {
                zh_cn: `💭 **思考中...**\n\n${reasoningText}`,
                en_us: `💭 **Thinking...**\n\n${reasoningText}`,
            },
            text_size: 'notation',
        });
    }
    else if (partialText) {
        // Answer phase: show answer content only
        elements.push({
            tag: 'markdown',
            content: (0, markdown_style_1.optimizeMarkdownStyle)(partialText),
        });
    }
    return {
        config: { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'] },
        elements,
    };
}
function buildCompleteCard(params) {
    const { text, elapsedMs, firstTokenLatencyMs, isError, reasoningText, reasoningElapsedMs, toolUseSteps, toolUseTitleSuffix, toolUseElapsedMs, showToolUse = true, isAborted, footer, footerMetrics, } = params;
    const elements = [];

    if (showToolUse) {
        elements.push(buildToolUsePanel({
            toolUseSteps,
            toolUseElapsedMs,
            titleSuffix: toolUseTitleSuffix,
        }));
    }

// ── 📊 Progress Panel helper ──
function buildProgressPanel(steps, extraContent) {
    if (!steps || steps.length === 0) {
        // No steps data but might have bridge content
        if (extraContent) {
            try {
                var bridgeStr = String(extraContent).trim();
                if (bridgeStr) {
                    return {
                        tag: 'collapsible_panel',
                        expanded: true,
                        header: {
                            title: {
                                tag: 'plain_text',
                                content: '\ud83d\udcca \u4efb\u52a1\u8fdb\u5ea6',
                                i18n_content: {
                                    zh_cn: '\ud83d\udcca \u4efb\u52a1\u8fdb\u5ea6',
                                    en_us: '\ud83d\udcca Task Progress',
                                },
                                text_color: 'grey',
                                text_size: 'notation',
                            },
                        },
                        element_id: 'task_progress_panel',
                        border: { color: 'grey', corner_radius: '5px' },
                        vertical_spacing: '4px',
                        padding: '8px 8px 8px 8px',
                        elements: [{
                            tag: 'markdown',
                            content: bridgeStr,
                            text_size: 'notation',
                        }],
                    };
                }
            } catch (_) {}
        }
        return null;
    }
    const pSteps = steps;
    const pDone = pSteps.filter(function(s) { return s.status === 'success' || s.status === 'error'; }).length;
    const pTotal = pSteps.length;
    const pPct = Math.round((pDone / pTotal) * 100);
    const barW = 16;
    const barF = Math.round((pPct / 100) * barW);
    const barS = '\u2588'.repeat(Math.max(0, barF)) + '\u2591'.repeat(Math.max(0, barW - barF));
    const allDone = pDone === pTotal;
    const statusIcon = allDone ? '\u2705' : (pDone > 0 ? '\ud83d\udd04' : '\u23f3');
    const statusText = allDone ? '\u5b8c\u6210' : '\u8fdb\u884c\u4e2d';
    const zhHeader = '\ud83d\udcca \u4efb\u52a1\u603b\u8fdb\u5ea6 ' + statusIcon + ' ' + pDone + '/' + pTotal + ' ' + statusText;
    const enHeader = '\ud83d\udcca Progress ' + statusIcon + ' ' + pDone + '/' + pTotal + ' ' + (allDone ? 'Complete' : 'Running');
    let bodyMd = barS + ' ' + pPct + '%\n';
    bodyMd += '\ud83d\udee0\ufe0f \u5de5\u5177\u6267\u884c \u00b7 ' + pTotal + ' \u6b21';
    for (const st of pSteps) {
        const name = st.title || st.toolName || 'tool';
        const dur = st.durationMs || st.duration || 0;
        let icon, suffix = '';
        if (st.status === 'success') {
            icon = '\u2714';
            suffix = dur ? ' ' + formatElapsed(dur) : '';
        } else if (st.status === 'error') {
            icon = '\u2716';
        } else if (st.status === 'running' || !st.status) {
            icon = '\u25e6';
            if (st.progress != null) {
                const bw = 8;
                const bf = Math.round((st.progress / 100) * bw);
                suffix += ' ' + st.progress + '% ' + '\u2588'.repeat(bf) + '\u2591'.repeat(bw - bf);
            }
            if (dur) {
                suffix += ' (' + formatElapsed(dur);
                if (st.estimated) suffix += '/' + formatElapsed(st.estimated);
                suffix += ')';
            }
        } else if (st.status === 'pending') {
            icon = '\u23f3';
            suffix = ' \u7b49\u5f85\u4e2d';
        } else {
            continue;
        }
        bodyMd += '\n \u25a0 ' + name + ' ' + icon + suffix;
    }
    // Extra content from bridge file
    if (extraContent) {
        try {
            var extra = String(extraContent).trim();
            if (extra) bodyMd += '\n' + extra;
        } catch (_) {}
    }
    return {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
            title: {
                tag: 'plain_text',
                content: zhHeader,
                i18n_content: {
                    zh_cn: zhHeader,
                    en_us: enHeader,
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        element_id: 'task_progress_panel',
        elements: [{
            tag: 'markdown',
            content: bodyMd,
            text_size: 'notation',
        }],
    };
}

    // Progress collapsible panel (after tool panel, before content)
    try {
        const pp = buildProgressPanel(toolUseSteps);
        if (pp) elements.push(pp);
    } catch (e) {
        console.error('[PanelProgress] error:', e);
    }
    // Collapsible reasoning panel (before main content)
    if (reasoningText) {
        const dur = reasoningElapsedMs ? formatReasoningDuration(reasoningElapsedMs) : null;
        const zhLabel = dur ? dur.zh : '思考';
        const enLabel = dur ? dur.en : 'Thought';
        elements.push({
            tag: 'collapsible_panel',
            expanded: false,
            header: {
                title: {
                    tag: 'markdown',
                    content: `💭 ${enLabel}`,
                    i18n_content: {
                        zh_cn: `💭 ${zhLabel}`,
                        en_us: `💭 ${enLabel}`,
                    },
                },
                vertical_align: 'center',
                icon: {
                    tag: 'standard_icon',
                    token: 'down-small-ccm_outlined',
                    size: '16px 16px',
                },
                icon_position: 'follow_text',
                icon_expanded_angle: -180,
            },
            border: { color: 'grey', corner_radius: '5px' },
            vertical_spacing: '8px',
            padding: '8px 8px 8px 8px',
            elements: [
                {
                    tag: 'markdown',
                    content: reasoningText,
                    text_size: 'notation',
                },
            ],
        });
    }
    // System resource panel (top-most)
    try {
        const cp = require('child_process');
        const os5 = require('os');
        let gpuUtil = '', gpuMemUsed = '', gpuMemTotal = '', gpuTemp = '';
        let cpuPct = '';
        let ramUsedG = '', ramTotalG = '', swapUsedG = '', swapTotalG = '';
        let procCount = '';
        let uptimeStr = '';
        // GPU via nvidia-smi
        try {
            const raw = cp.execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader', { timeout: 5000, encoding: 'utf8' });
            const parts = raw.trim().split(', ');
            if (parts.length >= 4) {
                gpuUtil = parts[0].trim();
                const mu = parseInt(parts[1].trim());
                const mt = parseInt(parts[2].trim());
                if (!isNaN(mu)) gpuMemUsed = (mu / 1024).toFixed(1) + 'G';
                if (!isNaN(mt)) gpuMemTotal = (mt / 1024).toFixed(0) + 'G';
                gpuTemp = parts[3].trim() + '\u00b0C';
            }
        } catch (_) {}
        // CPU via /proc/stat delta (real-time)
        try {
            const f2 = require('fs');
            const s1 = f2.readFileSync('/proc/stat', 'utf8');
            const t0 = Date.now();
            while (Date.now() - t0 < 200) {}
            const s2 = f2.readFileSync('/proc/stat', 'utf8');
            const p1 = s1.split('\n').find(l => l.startsWith('cpu '));
            const p2 = s2.split('\n').find(l => l.startsWith('cpu '));
            if (p1 && p2) {
                const v1 = p1.trim().split(/\s+/).slice(1).map(Number);
                const v2 = p2.trim().split(/\s+/).slice(1).map(Number);
                if (v1.length >= 5 && v2.length >= 5) {
                    const tt1 = v1.reduce((a,b)=>a+b,0), id1 = v1[3];
                    const tt2 = v2.reduce((a,b)=>a+b,0), id2 = v2[3];
                    const diffT = tt2 - tt1, diffI = id2 - id1;
                    if (diffT > 0) cpuPct = Math.round((1 - diffI / diffT) * 100) + '%';
                }
            }
        } catch (_) {}
        // RAM via os module
        try {
            const total = os5.totalmem();
            const free = os5.freemem();
            const used = total - free;
            if (total > 0) {
                ramTotalG = (total / 1073741824).toFixed(0);
                ramUsedG = (used / 1073741824).toFixed(1);
            }
        } catch (_) {}
        // Process count
        try { procCount = parseInt(cp.execSync('ps aux | wc -l', { timeout: 3000, encoding: 'utf8' }).trim()) + '\u4e2a'; } catch (_) {}
        // Uptime
        try {
            const up = os5.uptime();
            const days = Math.floor(up / 86400);
            const hrs = Math.floor((up % 86400) / 3600);
            const mins = Math.floor((up % 3600) / 60);
            uptimeStr = days + '\u5929 ' + hrs + '\u5c0f\u65f6 ' + mins + '\u5206\u949f';
        } catch (_) {}
        const hasGPU = gpuUtil !== '';
        const hasCPU = cpuPct !== '';
        const hasRAM = ramUsedG !== '' && ramTotalG !== '';
        if (hasGPU || hasCPU || hasRAM) {
            const headParts = ['\ud83d\udda5\ufe0f'];
            if (hasGPU) headParts.push('GPU ' + gpuUtil + ' \u00b7 ' + gpuTemp + ' \u00b7 VRAM ' + gpuMemUsed + '/' + gpuMemTotal); else if (hasCPU || hasRAM) headParts.push('GPU: \u4e0d\u53ef\u7528');
            if (hasRAM) headParts.push('\ud83d\udc0f ' + ramUsedG + 'G/' + ramTotalG + 'G');
            const zhHead = headParts.join(' ');
            const enHead = zhHead;
            // Build body
            let bodyMd = '\ud83d\udda5\ufe0f \u7cfb\u7edf\u8d44\u6e90\n';
            if (hasGPU) {
                const gu = parseInt(gpuUtil);
                const bb = Math.round(gu / 100 * 14);
                bodyMd += 'GPU \u5229\u7528\u7387     ' + '\u2588'.repeat(Math.max(0, bb)) + '\u2591'.repeat(Math.max(0, 14 - bb)) + '  ' + gpuUtil + '\n';
                const mu = parseFloat(gpuMemUsed);
                const mt = parseFloat(gpuMemTotal);
                const mp = Math.round(mu / mt * 100);
                const bm = Math.round(mp / 100 * 14);
                bodyMd += 'GPU \u663e\u5b58       ' + '\u2588'.repeat(Math.max(0, bm)) + '\u2591'.repeat(Math.max(0, 14 - bm)) + '  ' + gpuMemUsed + ' / ' + gpuMemTotal + ' (' + mp + '%)\n';
                bodyMd += 'GPU \u6e29\u5ea6       ' + gpuTemp + '\n';
            }
            if (hasCPU) {
                const cu = parseInt(cpuPct);
                const bc = Math.round(cu / 100 * 14);
                bodyMd += 'CPU \u603b\u5229\u7528\u7387  ' + '\u2588'.repeat(Math.max(0, bc)) + '\u2591'.repeat(Math.max(0, 14 - bc)) + '  ' + cpuPct + '\n';
            }
            if (hasRAM) {
                const ru = parseFloat(ramUsedG);
                const rt = parseFloat(ramTotalG);
                const rp = Math.round(ru / rt * 100);
                const br = Math.round(rp / 100 * 14);
                bodyMd += '\u5185\u5b58\u5360\u7528     ' + '\u2588'.repeat(Math.max(0, br)) + '\u2591'.repeat(Math.max(0, 14 - br)) + '  ' + ramUsedG + 'G / ' + ramTotalG + 'G (' + rp + '%)\n';
            }
            if (procCount || uptimeStr) {
                const meta = [];
                if (procCount) meta.push('\u8fdb\u7a0b ' + procCount);
                if (uptimeStr) meta.push('\u5df2\u8fd0\u884c ' + uptimeStr);
                if (meta.length > 0) bodyMd += meta.join(' \u00b7 ');
            }
            elements.push({
                tag: 'collapsible_panel',
                expanded: false,
                header: {
                    title: {
                        tag: 'plain_text',
                        content: zhHead,
                        i18n_content: { zh_cn: zhHead, en_us: enHead },
                        text_color: 'grey',
                        text_size: 'notation',
                    },
                    vertical_align: 'center',
                    icon: {
                        tag: 'standard_icon',
                        token: 'down-small-ccm_outlined',
                        color: 'grey',
                        size: '16px 16px',
                    },
                    icon_position: 'right',
                    icon_expanded_angle: -180,
                },
                border: { color: 'grey', corner_radius: '5px' },
                vertical_spacing: '4px',
                padding: '8px 8px 8px 8px',
                elements: [
                    {
                        tag: 'markdown',
                        content: bodyMd,
                        text_size: 'notation',
                    },
                ],
            });
        }
    } catch (_) {}
    // Full text content
    elements.push({
        tag: 'markdown',
        content: (0, markdown_style_1.optimizeMarkdownStyle)(text),
    });

        // Footer: 6-line format (ported from v5.7)
    const fmtK = (v) => { if (v === null || v === undefined || v === 0) return '0'; const n = Number(v); return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : n.toLocaleString(); };
    let tsToday = 0, tsMonth = 0, tsAllTime = 0;
    try {
        const statsPath = path.join(os.homedir(), '.openclaw', 'token-stats.json');
        const raw = fs.readFileSync(statsPath, 'utf8');
        const st = JSON.parse(raw);
        tsToday = st.todayTokens || 0;
        tsMonth = st.monthTokens || 0;
        tsAllTime = st.allTimeTokens || 0;
    } catch (_) {}
    const tsTotal = Math.max(tsMonth, tsAllTime, tsToday);
    const now = new Date();
    const shanghai = new Date(now.getTime() + 8 * 3600 * 1000);
    const ts = `${shanghai.getUTCMonth() + 1}/${shanghai.getUTCDate()}-${String(shanghai.getUTCHours()).padStart(2, '0')}:${String(shanghai.getUTCMinutes()).padStart(2, '0')}`;
    const footerZhLines = [];
    const footerEnLines = [];
    // Line 1: global token stats
    footerZhLines.push(`🪙Token 今/月/总: ${fmtK(tsToday)}/${fmtK(tsMonth)}/${fmtK(tsTotal)} · ${ts}`);
    footerEnLines.push(`🪙Token Today/Month/Total: ${fmtK(tsToday)}/${fmtK(tsMonth)}/${fmtK(tsTotal)} · ${ts}`);
    // Line 2: separator
    footerZhLines.push('──────────────────');
    footerEnLines.push('──────────────────');
    // Line 3: status + elapsed + first-token latency
    const el = elapsedMs != null ? formatElapsed(elapsedMs) : '';
    const ft = firstTokenLatencyMs != null ? (firstTokenLatencyMs / 1000).toFixed(2) + 's' : '';
    const l3 = ['✅ 已完成'];
    if (el) l3.push(`⏳️ ${el}`);
    if (ft) l3.push(`🚀首token ${ft}`);
    footerZhLines.push(l3.join(' · '));
    footerEnLines.push(l3.join(' · '));
    // Line 4: cost breakdown (per-million pricing)
    const inputPrice = 1.0, outputPrice = 2.0, cacheReadPrice = 1.0;
    if (footerMetrics && typeof footerMetrics.inputTokens === 'number') {
        const inT = footerMetrics.inputTokens || 0;
        const outT = footerMetrics.outputTokens || 0;
        const cacR = (footerMetrics.cacheRead || 0) > (inT + outT) ? (inT + outT) : (footerMetrics.cacheRead || 0);
        const cIn = (inT / 1_000_000) * inputPrice;
        const cOut = (outT / 1_000_000) * outputPrice;
        const cCac = (cacR / 1_000_000) * cacheReadPrice;
        const displayTotal = cIn + cOut + cCac;
        const fc = (v) => v < 0.01 ? v.toFixed(4) : v.toFixed(2);
        footerZhLines.push(`💸 ¥${fc(displayTotal)} = 入¥${fc(cIn)} + 出¥${fc(cOut)} + 缓存¥${fc(cCac)}`);
        footerEnLines.push(`💸 ¥${fc(displayTotal)} = In¥${fc(cIn)} + Out¥${fc(cOut)} + Cache¥${fc(cCac)}`);
    }
    // Line 5: context / token detail
    if (footerMetrics && typeof footerMetrics.inputTokens === 'number') {
        const inLabel = fmtK(footerMetrics.inputTokens);
        const outLabel = fmtK(footerMetrics.outputTokens);
        const totalTokens = typeof footerMetrics.totalTokens === 'number' ? footerMetrics.totalTokens : 0;
        const contextTokens = typeof footerMetrics.contextTokens === 'number' ? footerMetrics.contextTokens : 0;
        const totalStr = fmtK(totalTokens);
        const ctxStr = fmtK(contextTokens);
        const pct = (totalTokens && contextTokens && contextTokens >= totalTokens) ? Math.round((totalTokens / contextTokens) * 100) : 0;
        const cacheLine = fmtK((footerMetrics.cacheRead || 0) + (footerMetrics.cacheWrite || 0));
        footerZhLines.push(`📑 本次 ${totalStr}/${ctxStr} (${pct}%)·本轮 ↑ ${inLabel} ↓ ${outLabel}·缓存 ${cacheLine}`);
        footerEnLines.push(`📑 本次 ${totalStr}/${ctxStr} (${pct}%)·本轮 ↑ ${inLabel} ↓ ${outLabel}·缓存 ${cacheLine}`);
    }
    // Line 6: provider + cumulative cost + model
    let hModelName = "";
    let hTotalCost = 0;
    if (footerMetrics?.model) {
        const modelName = footerMetrics.model.replace(/^deepseek\//, ''); hModelName = modelName;
        const provider = (footerMetrics.model || '').includes('deepseek') ? 'DeepSeek' : 'Unknown';
        let totalCost = 0;
        try {
            const bcPath = path.join(os.homedir(), '.hermes', 'data', 'balance-cache.json');
            if (fs.existsSync(bcPath)) {
                const bc = JSON.parse(fs.readFileSync(bcPath, 'utf8'));
                if (bc?.results?.length) {
                    const modelName = (footerMetrics?.model || '').toLowerCase();
                    let platformMatch = '';
                    if (modelName.includes('deepseek')) platformMatch = 'DeepSeek';
                    else if (modelName.includes('qwen') || modelName.includes('bailian')) platformMatch = '阿里百炼';
                    else if (modelName.includes('silicon') || modelName.includes('glm')) platformMatch = '硅基流动';
                    else platformMatch = bc.results[0]?.platform || '';
                    const found = bc.results.find(r => r.platform === platformMatch);
                    if (found && found.total > 0) {
                        totalCost = found.total; hTotalCost = totalCost;
                    }
                }
            }
        } catch (_) {}
        const costStr = totalCost > 0 ? `·¥${totalCost.toFixed(2)}` : '';
        footerZhLines.push(`💰 ${provider}${costStr}·${modelName}`);
        footerEnLines.push(`💰 ${provider}${costStr}·${modelName}`);
    }
    // Line 7: background task progress (optional)
    const bgTasks = params.backgroundTasks || readActiveTasks();
    if (bgTasks.length > 0) {
        const active = bgTasks.filter(t => t.status === 'running');
        if (active.length > 0) {
            const t = active[0];
            const pct = Math.min(100, Math.max(0, t.progress || 0));
            const barW = 10;
            const barF = Math.round((pct / 100) * barW);
            const bar = '\u2588'.repeat(Math.max(0, barF)) + '\u2591'.repeat(Math.max(0, barW - barF));
            const elapsed = t.elapsedMs ? formatElapsed(t.elapsedMs) : '';
            const eta = t.etaMs > 0 ? 'ETA ' + formatElapsed(t.etaMs) : '';
            const taskIcon = { download: '\ud83d\udce5', compile: '\ud83d\udd27', generic: '\ud83d\udd04' }[t.type] || '\ud83d\udd04';
            const taskLine = taskIcon + ' ' + t.name + ' ' + bar + ' ' + pct + '%' + (elapsed ? ' \u23f1\ufe0f ' + elapsed : '');
            if (eta) {
                footerZhLines.push(taskLine + ' \u00b7 ETA ' + eta);
                footerEnLines.push(taskLine + ' \u00b7 ETA ' + eta);
            } else {
                footerZhLines.push(taskLine);
                footerEnLines.push(taskLine);
            }
        }
    }
    if (footerZhLines.length > 0) {
        const footerText = footerZhLines.join('\n');
        const footerTextEn = footerEnLines.join('\n');
        // Build header summary
        const tsLabel = fmtK(tsTotal);
        const hModel = hModelName || 'model';
        const hCost = hTotalCost > 0 ? ' · ¥' + hTotalCost.toFixed(2) : '';
        const zhHeader = '\ud83e\ude99 ' + hModel + hCost;
        const enHeader = '\ud83e\ude99 ' + hModel + hCost;
        elements.push({
            tag: 'collapsible_panel',
            expanded: false,
            header: {
                title: {
                    tag: 'plain_text',
                    content: zhHeader,
                    i18n_content: { zh_cn: zhHeader, en_us: enHeader },
                    text_color: 'grey',
                    text_size: 'notation',
                },
                vertical_align: 'center',
                icon: {
                    tag: 'standard_icon',
                    token: 'down-small-ccm_outlined',
                    color: 'grey',
                    size: '16px 16px',
                },
                icon_position: 'right',
                icon_expanded_angle: -180,
            },
            border: { color: 'grey', corner_radius: '5px' },
            vertical_spacing: '4px',
            padding: '8px 8px 8px 8px',
            elements: [
                {
                    tag: 'markdown',
                    content: footerTextEn,
                    i18n_content: { zh_cn: footerText, en_us: footerTextEn },
                    text_size: 'notation',
                },
            ],
        });
    }
// Use the answer text as the feed preview summary.
    // Strip markdown syntax so the preview reads as plain text.
    const summaryText = text.replace(/[*_`#>[\]()~]/g, '').trim();
    const summary = summaryText ? { content: summaryText.slice(0, 120) } : undefined;
    return {
        config: { wide_screen_mode: true, update_multi: true, locales: ['zh_cn', 'en_us'], summary },
        elements,
    };
}
function buildConfirmCard(confirmData) {
    const elements = [];
    // Operation description
    elements.push({
        tag: 'div',
        text: {
            tag: 'lark_md',
            content: confirmData.operationDescription,
        },
    });
    // Preview (if available)
    if (confirmData.preview) {
        elements.push({ tag: 'hr' });
        elements.push({
            tag: 'div',
            text: {
                tag: 'lark_md',
                content: `**Preview:**\n${confirmData.preview}`,
            },
        });
    }
    // Confirm / Reject / Preview buttons
    elements.push({ tag: 'hr' });
    elements.push({
        tag: 'action',
        actions: [
            {
                tag: 'button',
                text: { tag: 'plain_text', content: 'Confirm' },
                type: 'primary',
                value: {
                    action: 'confirm_write',
                    operation_id: confirmData.pendingOperationId,
                },
            },
            {
                tag: 'button',
                text: { tag: 'plain_text', content: 'Reject' },
                type: 'danger',
                value: {
                    action: 'reject_write',
                    operation_id: confirmData.pendingOperationId,
                },
            },
            ...(confirmData.preview
                ? []
                : [
                    {
                        tag: 'button',
                        text: {
                            tag: 'plain_text',
                            content: 'Preview',
                        },
                        type: 'default',
                        value: {
                            action: 'preview_write',
                            operation_id: confirmData.pendingOperationId,
                        },
                    },
                ]),
        ],
    });
    return {
        config: { wide_screen_mode: true, update_multi: true },
        header: {
            title: {
                tag: 'plain_text',
                content: '\ud83d\udd12 Confirmation Required',
            },
            template: 'orange',
        },
        elements,
    };
}
// ---------------------------------------------------------------------------
// toCardKit2
// ---------------------------------------------------------------------------
/**
 * Convert an old-format FeishuCard to CardKit JSON 2.0 format.
 * JSON 2.0 uses `body.elements` instead of top-level `elements`.
 */
/**
 * Build the initial CardKit 2.0 streaming card with a loading icon.
 * Optionally includes a tool-use pending panel above the streaming area.
 */
function buildStreamingThinkingCard(showToolUse = true) {
    return buildStreamingPreAnswerCard({ showToolUse });
}
/**
 * Build a CardKit 2.0 card for the pre-answer streaming phase.
 * Used both for the initial card and for live updates during tool calls.
 */
function buildStreamingPreAnswerCard(params) {
    const { steps, elapsedMs, showToolUse = true, chatId } = params;
    const hasSteps = Boolean(steps?.length);
    const elements = [];
    if (showToolUse) {
        elements.push(hasSteps ? buildStreamingToolUseActivePanel({ steps: steps, elapsedMs }) : buildStreamingToolUsePendingPanel());
    }
    elements.push({
        tag: 'markdown',
        content: '',
        text_align: 'left',
        text_size: 'normal_v2',
        margin: '0px 0px 0px 0px',
        element_id: exports.STREAMING_ELEMENT_ID,
    });
    elements.push({
        tag: 'markdown',
        content: ' ',
        icon: {
            tag: 'custom_icon',
            img_key: 'img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg',
            size: '16px 16px',
        },
        element_id: 'loading_icon',
    });
    return {
        schema: '2.0',
        config: {
            streaming_mode: true,
            locales: ['zh_cn', 'en_us'],
            summary: {
                content: 'Processing...',
                i18n_content: { zh_cn: '处理中...', en_us: 'Processing...' },
            },
        },
        body: { elements },
    };
}
/**
 * Build the collapsible panel for the active pre-answer phase.
 * Used by buildStreamingPreAnswerCard when at least one step exists.
 */
function buildStreamingToolUseActivePanel(params) {
    const { steps, elapsedMs } = params;
    const enParts = ['Tool use'];
    const zhParts = ['工具执行'];
    // Determine if all steps completed
    const pDone = steps.filter(function(s) { return s.status === 'success' || s.status === 'error'; }).length;
    const pTotal = steps.length;
    const allDone = pDone === pTotal;
    if (allDone && pTotal > 0) {
        // Show completion status in header
        enParts.push('✅ ' + pDone + '/' + pTotal + ' complete');
        zhParts.push('✅ ' + pDone + '/' + pTotal + ' 完成');
    } else if (steps.length > 0) {
        enParts.push(steps.length + ' step' + (steps.length === 1 ? '' : 's'));
        zhParts.push(steps.length + ' 步');
    }
    if (elapsedMs != null && elapsedMs > 0) {
        var d = formatElapsed(elapsedMs);
        enParts.push('(' + d + ')');
        zhParts.push('(' + d + ')');
    }
    // Build elements: step details
    var panelElements = steps.flatMap(function(step) { return buildToolUseStepElements(step); });
    return {
        tag: 'collapsible_panel',
        expanded: true,
        header: {
            title: {
                tag: 'plain_text',
                content: '\ud83d\udee0\ufe0f ' + enParts.join(' \u00b7 '),
                i18n_content: {
                    zh_cn: '\ud83d\udee0\ufe0f ' + zhParts.join(' \u00b7 '),
                    en_us: '\ud83d\udee0\ufe0f ' + enParts.join(' \u00b7 '),
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        elements: panelElements,
    };
}
function toCardKit2(card) {
    const result = {
        schema: '2.0',
        config: card.config,
        body: { elements: card.elements },
    };
    if (card.header)
        result.header = card.header;
    return result;
}
function buildStreamingToolUsePendingPanel() {
    return {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
            title: {
                tag: 'plain_text',
                content: '🛠️ Tool use pending',
                i18n_content: {
                    zh_cn: '🛠️ 等待工具执行',
                    en_us: '🛠️ Tool use pending',
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        elements: [],
    };
}
function buildToolUsePanel(params) {
    const { toolUseSteps = [], toolUseElapsedMs, titleSuffix } = params;
    const duration = toolUseElapsedMs ? formatToolUseDuration(toolUseElapsedMs) : null;
    const zhTitleParts = [duration?.zh ?? '工具执行'];
    const enTitleParts = [duration?.en ?? 'Tool use'];
    if (titleSuffix) {
        zhTitleParts.push(titleSuffix.zh);
        enTitleParts.push(titleSuffix.en);
    }
    // Add completion status if all steps complete
    const pDone = toolUseSteps.filter(function(s) { return s.status === 'success' || s.status === 'error'; }).length;
    const pTotal = toolUseSteps.length;
    if (pTotal > 0 && pDone === pTotal) {
        zhTitleParts.push('✅ ' + pDone + '/' + pTotal + ' 完成');
        enTitleParts.push('✅ ' + pDone + '/' + pTotal + ' complete');
    } else if (pTotal > 0) {
        zhTitleParts.push(pDone + '/' + pTotal + ' 步');
        enTitleParts.push(pDone + '/' + pTotal + ' step' + (pTotal === 1 ? '' : 's'));
    }
    const stepElements = toolUseSteps.length > 0
        ? toolUseSteps.flatMap((step) => buildToolUseStepElements(step))
        : [buildToolUsePlaceholder()];
    return {
        tag: 'collapsible_panel',
        expanded: false,
        header: {
            title: {
                tag: 'plain_text',
                content: `🛠️ ${enTitleParts.join(' · ')}`,
                i18n_content: {
                    zh_cn: `🛠️ ${zhTitleParts.join(' · ')}`,
                    en_us: `🛠️ ${enTitleParts.join(' · ')}`,
                },
                text_color: 'grey',
                text_size: 'notation',
            },
            vertical_align: 'center',
            icon: {
                tag: 'standard_icon',
                token: 'down-small-ccm_outlined',
                color: 'grey',
                size: '16px 16px',
            },
            icon_position: 'right',
            icon_expanded_angle: -180,
        },
        border: { color: 'grey', corner_radius: '5px' },
        vertical_spacing: '4px',
        padding: '8px 8px 8px 8px',
        elements: stepElements,
    };
}
function buildToolUseStepElements(step) {
    const elements = [buildToolUseStepTitleElement(step)];
    const detailElement = buildToolUseStepDetailElement(step);
    if (detailElement) {
        elements.push(detailElement);
    }
    const outputElement = buildToolUseStepOutputElement(step);
    if (outputElement) {
        elements.push(outputElement);
    }
    return elements;
}
function buildToolUsePlaceholder(labels) {
    const zh = labels?.zh ?? '暂无工具步骤';
    const en = labels?.en ?? tool_use_display_1.EMPTY_TOOL_USE_PLACEHOLDER;
    return {
        tag: 'div',
        text: {
            tag: 'plain_text',
            content: en,
            i18n_content: {
                zh_cn: zh,
                en_us: en,
            },
            text_color: 'grey',
            text_size: 'notation',
        },
    };
}
function buildToolUseStepTitleElement(step) {
    return {
        tag: 'div',
        icon: {
            tag: 'standard_icon',
            token: step.iconToken,
            color: 'grey',
        },
        text: {
            tag: 'lark_md',
            content: buildToolUseStepTitleMarkdown(step),
            text_size: 'notation',
        },
    };
}
function buildToolUseStepTitleMarkdown(step) {
    const status = formatToolUseStepStatus(step.status);
    return (0, markdown_style_1.optimizeMarkdownStyle)(`**${escapeToolUseMarkdownText(step.title)}** · <font color='${status.color}'>${status.label}</font>`, 1);
}
function buildToolUseStepDetailElement(step) {
    const detail = step.detail?.trim();
    if (!detail)
        return undefined;
    return {
        tag: 'div',
        margin: TOOL_USE_STEP_CONTENT_INDENT,
        text: {
            tag: 'plain_text',
            content: detail,
            text_color: 'grey',
            text_size: 'notation',
        },
    };
}
function buildToolUseStepOutputElement(step) {
    const content = buildToolUseStepOutputMarkdown(step);
    if (!content)
        return undefined;
    return {
        tag: 'div',
        margin: TOOL_USE_STEP_CONTENT_INDENT,
        text: {
            tag: 'lark_md',
            content,
            text_size: 'notation',
        },
    };
}
function buildToolUseStepOutputMarkdown(step) {
    const lines = [];
    if (step.errorBlock) {
        lines.push('**Error**');
        lines.push(formatToolUseCodeBlock(step.errorBlock.content, step.errorBlock.language));
    }
    else if (step.resultBlock) {
        lines.push('**Result**');
        lines.push(formatToolUseCodeBlock(step.resultBlock.content, step.resultBlock.language));
    }
    if (lines.length === 0)
        return undefined;
    return (0, markdown_style_1.optimizeMarkdownStyle)(lines.join('\n'), 1);
}
function formatToolUseStepStatus(status) {
    switch (status) {
        case 'running':
            return { label: 'Running', color: 'turquoise' };
        case 'error':
            return { label: 'Failed', color: 'red' };
        case 'success':
        default:
            return { label: 'Succeeded', color: 'green' };
    }
}
function formatToolUseCodeBlock(content, language) {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(normalized) + 1));
    return `${fence}${language}\n${normalized}\n${fence}`;
}
function longestBacktickRun(value) {
    const matches = value.match(/`+/g) ?? [];
    return matches.reduce((max, run) => Math.max(max, run.length), 0);
}
function escapeToolUseMarkdownText(value) {
    return value.replace(/\\/g, '\\\\').replace(/([`*_{}[\]<>])/g, '\\$1');
}
