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
        return Math.abs(k) >= 1000 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    return `${Math.round(value)}`;
}
/**
 * Calculate estimated cost from token usage and model pricing.
 * Formula: inputTokens/1M * input_price + outputTokens/1M * output_price + cacheRead/1M * cacheRead_price
 * @returns estimated cost in USD (or 0 if no pricing data available)
 */
function calcModelCost(metrics, inputPrice, outputPrice, cacheReadPrice) {
    const inT = typeof metrics?.inputTokens === 'number' && metrics.inputTokens > 0 ? metrics.inputTokens : 0;
    const outT = typeof metrics?.outputTokens === 'number' && metrics.outputTokens > 0 ? metrics.outputTokens : 0;
    const cacheR = typeof metrics?.cacheRead === 'number' && metrics.cacheRead > 0 ? metrics.cacheRead : 0;
    const inPrice = typeof inputPrice === 'number' && inputPrice > 0 ? inputPrice : 0;
    const outPrice = typeof outputPrice === 'number' && outputPrice > 0 ? outputPrice : 0;
    const cacheRPrice = typeof cacheReadPrice === 'number' && cacheReadPrice > 0 ? cacheReadPrice : 0;
    if (inPrice === 0 && outPrice === 0 && cacheRPrice === 0)
        return 0;
    const cost = (inT / 1_000_000) * inPrice
        + (outT / 1_000_000) * outPrice
        + (cacheR / 1_000_000) * cacheRPrice;
    return cost > 0.0001 ? Math.round(cost * 10000) / 10000 : 0;
}
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
function getShanghaiDateKey() {
    const d = new Date(Date.now() + SHANGHAI_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function getShanghaiMonthKey() {
    const d = new Date(Date.now() + SHANGHAI_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function formatFooterRuntimeSegments(params) {
    const { footer, metrics, elapsedMs, isError, isAborted, showGlobalTokens, inputPrice, outputPrice, cacheReadPrice, firstTokenLatencyMs } = params;
    const primaryZh = [];
    const primaryEn = [];
    const detailZh = [];
    const detailEn = [];
    const contextZh = [];
    const contextEn = [];
    const dailyZh = [];
    const dailyEn = [];
    // --- Primary line: status, elapsed, model ---
    if (footer?.status) {
        if (isError) {
            primaryZh.push('❌ 出错');
            primaryEn.push('❌ Error');
        }
        else if (isAborted) {
            primaryZh.push('⏹️ 已停止');
            primaryEn.push('⏹️ Stopped');
        }
        else {
            primaryZh.push('✅ 已完成');
            primaryEn.push('✅ Completed');
        }
    }
    if (footer?.elapsed && elapsedMs != null) {
        const d = formatElapsed(elapsedMs);
        primaryZh.push(`⏳️ ${d}`);
        primaryEn.push(`⏳️ ${d}`);
    }
    if (footer?.model && metrics?.model) {
        const model = metrics.model.trim();
        if (model) {
            primaryZh.push(model);
            primaryEn.push(model);
        }
    }
    // --- Detail line 1: tokens, cache, cost ---
    // Token counts moved to context section below with "累计" label
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
    if (footer?.cost && metrics) {
        const cost = calcModelCost(metrics, inputPrice, outputPrice, cacheReadPrice);
        if (cost > 0) {
            const costStr = cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
            detailZh.push(`💸 ¥${costStr}`);
            detailEn.push(`💸 ¥${costStr}`);
        }
    }
    if (footer?.elapsed && firstTokenLatencyMs != null) {
        const sec = (firstTokenLatencyMs / 1000).toFixed(2);
        detailZh.push(`🚀首token ${sec}s`);
        detailEn.push(`🚀 First token ${sec}s`);
    }
    // --- Detail line 2 (separate line): context window + tokens ---
    if (footer?.context && metrics) {
        // 📑: 本次请求上下文用量（current totalTokens, 能涨能跌）
        // ↑↓: 会话累计输入/输出（lifetime in/out, 只增不降）
        let curTotal;
        if (typeof metrics.totalTokens === 'number' && metrics.totalTokens > 0) {
            curTotal = metrics.totalTokens;
        }
        else {
            const hi = typeof metrics.inputTokens === 'number' ? metrics.inputTokens : 0;
            const ho = typeof metrics.outputTokens === 'number' ? metrics.outputTokens : 0;
            curTotal = hi + ho;
        }
        curTotal = Math.max(0, curTotal);
        const ctx = typeof metrics.contextTokens === 'number' ? Math.max(0, metrics.contextTokens) : undefined;
        if (ctx != null) {
            const curLabel = compactNumber(curTotal);
            const ctxLabel = compactNumber(ctx);
            const pct = ctx > 0 ? Math.round((curTotal / ctx) * 100) : 0;
            contextZh.push(`📑 本次 ${curLabel}/${ctxLabel} (${pct}%)`);
            contextEn.push(`📑 cur ${curLabel}/${ctxLabel} (${pct}%)`);
        }
        // 累计 ↑↓ 加 label 区分
        const inTokens = typeof metrics.inputTokens === 'number' ? Math.max(0, metrics.inputTokens) : undefined;
        const outTokens = typeof metrics.outputTokens === 'number' ? Math.max(0, metrics.outputTokens) : undefined;
        if (inTokens != null && outTokens != null) {
            contextZh.push(`累计 ↑ ${compactNumber(inTokens)} ↓ ${compactNumber(outTokens)}`);
            contextEn.push(`lifetime ↑ ${compactNumber(inTokens)} ↓ ${compactNumber(outTokens)}`);
        }
    }
    // --- Daily token line: 🪙 Token今/月 (read from token-stats.json) ---
    if (footer?.todayTokens || footer?.monthTokens) {
        let tDay = 0, tMonth = 0;
        try {
            const statsPath = path.join(os.homedir(), '.openclaw', 'token-stats.json');
            if (fs.existsSync(statsPath)) {
                const raw = fs.readFileSync(statsPath, 'utf8');
                const data = JSON.parse(raw);
                const sameDay = data.dateKey === getShanghaiDateKey();
                const sameMonth = data.dateKey && data.dateKey.substring(0, 7) === getShanghaiMonthKey();
                tDay = sameDay && typeof data.todayTokens === 'number' ? data.todayTokens : 0;
                tMonth = sameMonth && typeof data.monthTokens === 'number' ? data.monthTokens : 0;
            }
        } catch { /* ignore read errors */ }
        const dayLabel = compactNumber(tDay);
        const monthLabel = compactNumber(tMonth);
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        dailyZh.push(`🪙 Token今/月: ${dayLabel}丨${monthLabel} · ${timeStr}`);
        dailyEn.push(`🪙 Token today/month: ${dayLabel}丨${monthLabel} · ${timeStr}`);
    }
    return { primaryZh, primaryEn, detailZh, detailEn, contextZh, contextEn, dailyZh, dailyEn };
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
                footer: data.footer,
                footerMetrics: data.footerMetrics,
                showGlobalTokens: data.showGlobalTokens,
                inputPrice: data.inputPrice,
                outputPrice: data.outputPrice,
                cacheReadPrice: data.cacheReadPrice,
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
    const { text, elapsedMs, isError, reasoningText, reasoningElapsedMs, toolUseSteps, toolUseTitleSuffix, toolUseElapsedMs, showToolUse = true, isAborted, footer, footerMetrics, showGlobalTokens, inputPrice, outputPrice, cacheReadPrice } = params;
    const elements = [];
    if (showToolUse) {
        elements.push(buildToolUsePanel({
            toolUseSteps,
            toolUseElapsedMs,
            titleSuffix: toolUseTitleSuffix,
        }));
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
    // Full text content
    elements.push({
        tag: 'markdown',
        content: (0, markdown_style_1.optimizeMarkdownStyle)(text),
    });
    // Footer meta-info: split into three lines for readability.
    // Line 1 (primary): status · elapsed · model
    // Line 2 (detail):  tokens · cache · cost
    // Line 3 (context): context window
    // 从 token-stats.json 读取全局 Token 统计（用户自定义前置行）
    const fmtK = v => { if(v===null||v===undefined||v===0)return '0'; const n=Number(v); return n>=1e9?(n/1e9).toFixed(2)+'B': n>=1e6?(n/1e6).toFixed(1)+'M': n>=1e3?(n/1e3).toFixed(1)+'k': n.toLocaleString(); };
    let tsToday = 0, tsMonth = 0, tsAllTime = 0;
    try {
        const statsDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw');
        const statsPath = path.join(statsDir, 'token-stats.json');
        const raw = fs.readFileSync(statsPath, 'utf8');
        const st = JSON.parse(raw);
        tsToday = st.todayTokens || 0;
        tsMonth = st.monthTokens || 0;
        tsAllTime = st.allTimeTokens || 0;
    } catch(e) {}
    // Total = actual allTimeTokens (no Math.max — reflects true cumulative)
    const tsTotal = tsAllTime;
    const now = new Date();
    const ts = `${now.getMonth()+1}/${now.getDate()}-${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const footerZhLines = [];
    const footerEnLines = [];
    // ── Line 1: 今/月/总（从 token-stats.json 读取） ──
    footerZhLines.push(`🪙Token 今/月/总: ${fmtK(tsToday)}/${fmtK(tsMonth)}/${fmtK(tsTotal)} · ${ts}`);
    footerEnLines.push(`🪙Token Today/Month/Total: ${fmtK(tsToday)}/${fmtK(tsMonth)}/${fmtK(tsTotal)} · ${ts}`);
    // ── Line 2: 分隔线 ──
    footerZhLines.push('──────────────────');
    footerEnLines.push('──────────────────');
    // ── Line 3: ✅ 已完成 · ⏳️ time · 🚀首token ft ──
    const el = elapsedMs != null ? formatElapsed(elapsedMs) : '';
    const ft = footerMetrics?.firstTokenLatencyMs != null ? (footerMetrics.firstTokenLatencyMs/1000).toFixed(2)+'s' : '';
    let l3 = ['✅ 已完成'];
    if (el) l3.push(`⏳️ ${el}`);
    if (ft) l3.push(`🚀首token ${ft}`);
    footerZhLines.push(l3.join(' · '));
    footerEnLines.push(l3.join(' · '));
    // ── Line 4: 💸 ¥total = 入¥input + 出¥output + 缓存¥cache (session delta) ──
    const costTotal = calcModelCost(footerMetrics, inputPrice, outputPrice, cacheReadPrice);
    if (costTotal > 0 || (footerMetrics?.inputTokens || 0) > 0) {
        const inT = footerMetrics?.inputTokens || 0;
        const outT = footerMetrics?.outputTokens || 0;
        // Use session delta for cache cost: only count the current turn's context
        // cacheRead in session store is ACCUMULATED across all turns
        // The per-turn cache delta ≈ inT + outT (what was read from context this turn)
        const cacR = (footerMetrics?.cacheRead || 0) > (inT + outT) 
            ? (inT + outT) // cache is accumulated, cap at current turn's total
            : (footerMetrics?.cacheRead || 0);
        const cIn = (inT/1_000_000)*(inputPrice||0);
        const cOut = (outT/1_000_000)*(outputPrice||0);
        const cCac = (cacR/1_000_000)*(cacheReadPrice||0);
        // Always compute total from parts to guarantee sum matches
        const displayTotal = cIn + cOut + cCac;
        const fc = v => v < 0.01 ? v.toFixed(4) : v.toFixed(2);
        // Cost config in openclaw.json is stored in USD (e.g. DeepSeek $1/M input).
        // Display as ¥ for Chinese users. Assumes 1:1 USD:CNY — config is in USD
        // but DeepSeek/阿里百炼 CNY prices happen to match USD values closely.
        footerZhLines.push(`💸 ¥${fc(displayTotal)} = 入¥${fc(cIn)} + 出¥${fc(cOut)} + 缓存¥${fc(cCac)}`);
        footerEnLines.push(`💸 ¥${fc(displayTotal)} = In ¥${fc(cIn)} + Out ¥${fc(cOut)} + Cache ¥${fc(cCac)}`);
    }
    // ── Line 5: 📑 context/limit (%)·↑ input ↓ output · 缓存 read/write (%) ──
    let l5 = [];
    const ctxUsed = footerMetrics?.totalTokens || footerMetrics?.inputTokens || 0;
    const ctxMax = footerMetrics?.contextTokens || 0;
    if (ctxMax > 0) {
        const pct = Math.round((ctxUsed/ctxMax)*100);
        l5.push(`📑 本次 ${fmtK(ctxUsed)}/${fmtK(ctxMax)} (${pct}%)`);
    }
    const iTk = footerMetrics?.inputTokens;
    const oTk = footerMetrics?.outputTokens;
    if (iTk != null && oTk != null) {
        l5.push(`本轮 ↑ ${fmtK(iTk)} ↓ ${fmtK(oTk)}`);
    }
    const cR = footerMetrics?.cacheRead;
    const hasCW = footerMetrics?.cacheWrite && footerMetrics.cacheWrite > 0;
    if (cR != null && cR > 0 && hasCW) {
        // cacheWrite tracked: show read/write + hit rate
        const denom = (iTk||0) + cR + (footerMetrics.cacheWrite || 0);
        const hr = denom > 0 ? Math.round((cR/denom)*100) : 0;
        l5.push(`缓存 ${fmtK(cR)}/${fmtK(footerMetrics.cacheWrite)} (${hr}%)`);
    } else if (cR != null && cR > 0) {
        // cacheWrite untracked (always 0): show raw read amount only, no misleading %
        l5.push(`缓存 ${fmtK(cR)}`);
    }
    footerZhLines.push(l5.join('·'));
    footerEnLines.push(l5.join('·'));
    // ── Line 6: 💰 platform·¥amount·model ──
    try {
        const bcPath = path.join(os.homedir(), '.hermes', 'data', 'balance-cache.json');
        if (fs.existsSync(bcPath)) {
            const bc = JSON.parse(fs.readFileSync(bcPath, 'utf8'));
            if (bc?.results?.length) {
                const modelName = footerMetrics?.model?.toLowerCase() || '';
                // 根据当前模型匹配平台: deepseek → DeepSeek, qwen/bailian → 阿里百炼
                let platformMatch = '';
                if (modelName.includes('deepseek')) platformMatch = 'DeepSeek';
                else if (modelName.includes('qwen') || modelName.includes('bailian')) platformMatch = '阿里百炼';
                else if (modelName.includes('silicon') || modelName.includes('glm')) platformMatch = '硅基流动';
                else platformMatch = bc.results[0]?.platform || '';
                const found = bc.results.find(r => r.platform === platformMatch);
                const md = footerMetrics?.model?.trim() || '';
                if (found && found.total > 0) {
                    footerZhLines.push(`💰 ${found.platform}·¥${found.total.toFixed(2)}·${md}`);
                    footerEnLines.push(`💰 ${found.platform}·¥${found.total.toFixed(2)}·${md}`);
                } else if (md) {
                    footerZhLines.push(`💰 ${platformMatch}·暂无余额·${md}`);
                    footerEnLines.push(`💰 ${platformMatch}·No balance·${md}`);
                }
            }
        }
    } catch(e) {}
    // ── 渲染 ──
    if (footerZhLines.length > 0) {
elements.push(...buildFooter(footerZhLines.join('\n'), footerEnLines.join('\n'), isError));
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
    const { steps, elapsedMs, showToolUse = true } = params;
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
    if (steps.length > 0) {
        enParts.push(`${steps.length} step${steps.length === 1 ? '' : 's'}`);
        zhParts.push(`${steps.length} 步`);
    }
    if (elapsedMs != null && elapsedMs > 0) {
        const d = formatElapsed(elapsedMs);
        enParts.push(`(${d})`);
        zhParts.push(`(${d})`);
    }
    return {
        tag: 'collapsible_panel',
        expanded: true,
        header: {
            title: {
                tag: 'plain_text',
                content: `🛠️ ${enParts.join(' · ')}`,
                i18n_content: {
                    zh_cn: `🛠️ ${zhParts.join(' · ')}`,
                    en_us: `🛠️ ${enParts.join(' · ')}`,
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
        elements: steps.flatMap((step) => buildToolUseStepElements(step)),
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
