"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Streaming card controller for the Lark/Feishu channel plugin.
 *
 * Manages the full lifecycle of a streaming CardKit card:
 * idle → creating → streaming → completed / aborted / terminated.
 *
 * Delegates throttling to FlushController and message-unavailable
 * detection to UnavailableGuard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingCardController = void 0;
exports.prepareTerminalCardContent = prepareTerminalCardContent;
const fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const agent_runtime_1 = require("openclaw/plugin-sdk/agent-runtime");
const config_runtime_1 = require("openclaw/plugin-sdk/config-runtime");
const reply_runtime_1 = require("openclaw/plugin-sdk/reply-runtime");
const api_error_1 = require("../core/api-error.js");
const lark_logger_1 = require("../core/lark-logger.js");
const lark_client_1 = require("../core/lark-client.js");
const shutdown_hooks_1 = require("../core/shutdown-hooks.js");
const send_1 = require("../messaging/outbound/send.js");
const builder_1 = require("./builder.js");
const card_error_1 = require("./card-error.js");
const cardkit_1 = require("./cardkit.js");
const flush_controller_1 = require("./flush-controller.js");
const image_resolver_1 = require("./image-resolver.js");
const markdown_style_1 = require("./markdown-style.js");
const tool_use_display_1 = require("./tool-use-display.js");
const tool_use_trace_store_1 = require("./tool-use-trace-store.js");
const event_bus_1 = require("../channel/event-bus.js");
const reply_dispatcher_types_1 = require("./reply-dispatcher-types.js");
const unavailable_guard_1 = require("./unavailable-guard.js");
const log = (0, lark_logger_1.larkLogger)('card/streaming');
// ---------------------------------------------------------------------------
// Token / metrics helpers
// ---------------------------------------------------------------------------
function computeTranscriptTokenTotals(sessionFile) {
    if (!sessionFile)
        return undefined;
    try {
        if (!(0, fs_1.existsSync)(sessionFile))
            return undefined;
        const content = (0, fs_1.readFileSync)(sessionFile, 'utf8');
        const lines = content.split('\n');
        let input = 0, output = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            let entry;
            try {
                entry = JSON.parse(trimmed);
            }
            catch { continue; }
            if (!entry || typeof entry !== 'object')
                continue;
            const usage = entry?.message?.usage ?? entry?.usage;
            if (!usage || typeof usage !== 'object')
                continue;
            const i = typeof usage.input === 'number' ? usage.input
                : typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
            const o = typeof usage.output === 'number' ? usage.output
                : typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
            if (i > 0 || o > 0) {
                input += i;
                output += o;
            }
        }
        if (input > 0 || output > 0)
            return { input, output };
    }
    catch { /* fall through */ }
    return undefined;
}
function extractAgentIdFromSessionKey(sessionKey) {
    const match = sessionKey.trim().toLowerCase().match(/^agent:([^:]+):/);
    return match?.[1];
}
function collectFooterMetrics(entry, extra) {
    const inT = typeof entry.inputTokens === 'number' ? entry.inputTokens : undefined;
    const outT = typeof entry.outputTokens === 'number' ? entry.outputTokens : undefined;
    const totalT = typeof entry.totalTokens === 'number' ? entry.totalTokens
        : (inT != null || outT != null) ? (inT || 0) + (outT || 0) : undefined;
    return {
        inputTokens: inT,
        outputTokens: outT,
        cacheRead: typeof entry.cacheRead === 'number' ? entry.cacheRead : undefined,
        cacheWrite: typeof entry.cacheWrite === 'number' ? entry.cacheWrite : undefined,
        totalTokens: totalT,
        totalTokensFresh: typeof entry.totalTokensFresh === 'boolean' ? entry.totalTokensFresh : undefined,
        contextTokens: typeof entry.contextTokens === 'number' ? entry.contextTokens : undefined,
        model: typeof entry.model === 'string' ? entry.model : undefined,
        firstTokenLatencyMs: extra?.firstTokenLatencyMs ?? entry.firstTokenLatencyMs,
    };
}
function resolveContextWindowFromConfig(cfg, modelName) {
    try {
        const providers = cfg?.models?.providers;
        if (!providers || !modelName)
            return undefined;
        for (const provider of Object.values(providers)) {
            if (!provider?.models)
                continue;
            for (const m of provider.models) {
                if (!m?.id)
                    continue;
                if (m.id === modelName || modelName.endsWith('/' + m.id)
                    || m.id.endsWith('/' + modelName) || modelName.includes(m.id)) {
                    const ctx = typeof m.contextWindow === 'number' ? m.contextWindow
                        : typeof m.contextTokens === 'number' ? m.contextTokens : undefined;
                    if (ctx && ctx > 0)
                        return ctx;
                }
            }
        }
    }
    catch { /* ignore */ }
    return undefined;
}
function resolveModelPrices(cfg, modelName) {
    try {
        const providers = cfg?.models?.providers;
        if (!providers || !modelName) return {};
        for (const provider of Object.values(providers)) {
            if (!provider?.models) continue;
            for (const m of provider.models) {
                if (!m?.id || !m?.cost) continue;
                if (m.id === modelName || modelName.endsWith('/' + m.id)
                    || m.id.endsWith('/' + modelName) || modelName.includes(m.id)) {
                    return {
                        inputPrice: typeof m.cost.input === 'number' ? m.cost.input : undefined,
                        outputPrice: typeof m.cost.output === 'number' ? m.cost.output : undefined,
                        cacheReadPrice: typeof m.cost.cacheRead === 'number' ? m.cost.cacheRead : undefined,
                    };
                }
            }
        }
    } catch { /* ignore */ }
    return {};
}
// ---------------------------------------------------------------------------
// StreamingCardController
// ---------------------------------------------------------------------------
class StreamingCardController {
    // ---- Explicit state machine ----
    phase = 'idle';
    // ---- Structured state ----
    cardKit = {
        cardKitCardId: null,
        originalCardKitCardId: null,
        cardKitSequence: 0,
        cardMessageId: null,
    };
    text = {
        accumulatedText: '',
        completedText: '',
        streamingPrefix: '',
        lastPartialText: '',
        lastFlushedText: '',
    };
    reasoning = {
        accumulatedReasoningText: '',
        reasoningStartTime: null,
        reasoningElapsedMs: 0,
        isReasoningPhase: false,
    };
    toolUse = {
        startedAt: null,
        elapsedMs: 0,
        isActive: false,
    };
    // ---- Sub-controllers ----
    flush;
    guard;
    imageResolver;
    // ---- Lifecycle ----
    createEpoch = 0;
    _terminalReason = null;
    dispatchFullyComplete = false;
    cardCreationPromise = null;
    disposeShutdownHook = null;
    dispatchStartTime = Date.now();
    _firstContentTime = null;
    _lastTokenEvent = null;
    // ---- Injected dependencies ----
    deps;
    elapsed() {
        return Date.now() - this.dispatchStartTime;
    }
    needsFooterMetrics() {
        const footer = this.deps.resolvedFooter;
        return footer.tokens || footer.cache || footer.context || footer.model;
    }
    async getFooterSessionMetrics() {
        try {
            const cfgWithSession = this.deps.cfg;
            const sessionStorePath = cfgWithSession.sessions?.store ?? cfgWithSession.session?.store;
            const key = this.deps.sessionKey.trim().toLowerCase();
            // WORKAROUND: SDK session key round-trip bug.
            // The SDK's toAgentRequestSessionKey() strips the agent scope from keys
            // like "agent:hr:main" → "main", then toAgentStoreSessionKey() rebuilds
            // using the default agent ID → "agent:main:main".  This means metrics
            // written by the SDK always land under "agent:<defaultAgentId>:…"
            // regardless of the account-scoped agent ID the plugin routing generated.
            // Fallback: when the primary key misses, try replacing the agent-id
            // segment with the resolved default agent ID.
            // TODO: remove once the SDK preserves the original agent ID during the
            // request→store key round-trip.
            const defaultAgentId = (0, agent_runtime_1.resolveDefaultAgentId)(this.deps.cfg);
            const fallbackKey = key.replace(/^(agent):[^:]+:/, `$1:${defaultAgentId}:`);
            const candidateKeys = fallbackKey !== key ? [key, fallbackKey] : [key];
            // Primary path: config-runtime SDK (resolveStorePath + loadSessionStore)
            const sdk = config_runtime_1;
            if (sdk?.resolveStorePath && sdk?.loadSessionStore) {
                const storePath = sdk.resolveStorePath(sessionStorePath);
                const store = sdk.loadSessionStore(storePath);
                let entry;
                let matchedKey;
                for (const candidate of candidateKeys) {
                    const val = store[candidate];
                    if (val && typeof val === 'object') {
                        entry = val;
                        matchedKey = candidate;
                        break;
                    }
                }
                if (!entry) {
                    log.debug('footer metrics lookup: session entry missing', {
                        sessionKey: this.deps.sessionKey,
                        candidateKeys,
                        storePath,
                        source: 'config-runtime',
                    });
                    return undefined;
                }
                const metrics = collectFooterMetrics(entry, { firstTokenLatencyMs: this._firstContentTime ? this._firstContentTime - this.dispatchStartTime : undefined });
                log.debug('footer metrics lookup: session entry found', {
                    sessionKey: this.deps.sessionKey,
                    matchedKey,
                    storePath,
                    source: 'config-runtime',
                });
                return metrics;
            }
            // Fallback path: resolveSessionStoreEntry dual candidate
            if (sdk?.resolveSessionStoreEntry) {
                let entry;
                let matchedKey;
                for (const candidate of candidateKeys) {
                    const val = sdk.resolveSessionStoreEntry(sessionStorePath, candidate);
                    if (val && typeof val === 'object') {
                        entry = val;
                        matchedKey = candidate;
                        break;
                    }
                }
                if (!entry) {
                    log.debug('footer metrics lookup: session entry missing', {
                        sessionKey: this.deps.sessionKey,
                        candidateKeys,
                        source: 'config-runtime.resolveSessionStoreEntry',
                    });
                    return undefined;
                }
                const metrics = collectFooterMetrics(entry, { firstTokenLatencyMs: this._firstContentTime ? this._firstContentTime - this.dispatchStartTime : undefined });
                log.debug('footer metrics lookup: session entry found', {
                    sessionKey: this.deps.sessionKey,
                    matchedKey,
                    source: 'config-runtime.resolveSessionStoreEntry',
                });
                return metrics;
            }
            // Legacy fallback: lark-client runtime.channel.session
            const runtime = lark_client_1.LarkClient.runtime;
            if (!runtime)
                return undefined;
            const channelSession = runtime.channel?.session;
            if (!channelSession?.resolveStorePath) {
                return undefined;
            }
            const storePath = channelSession.resolveStorePath(sessionStorePath);
            const raw = await (0, promises_1.readFile)(storePath, 'utf8');
            const parsed = JSON.parse(raw);
            const store = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : {};
            let entry;
            let matchedKey;
            for (const candidate of candidateKeys) {
                const val = store[candidate];
                if (val && typeof val === 'object') {
                    entry = val;
                    matchedKey = candidate;
                    break;
                }
            }
            if (!entry) {
                log.debug('footer metrics lookup: session entry missing', {
                    sessionKey: this.deps.sessionKey,
                    candidateKeys,
                    storePath,
                    source: 'channel.session.file',
                });
                return undefined;
            }
            const metrics = collectFooterMetrics(entry, { firstTokenLatencyMs: this._firstContentTime ? this._firstContentTime - this.dispatchStartTime : undefined });
            log.debug('footer metrics lookup: session entry found', {
                sessionKey: this.deps.sessionKey,
                matchedKey,
                storePath,
                source: 'channel.session.file',
            });
            return metrics;
        }
        catch (err) {
            log.warn('footer metrics lookup failed', { error: String(err), sessionKey: this.deps.sessionKey });
            return undefined;
        }
    }
    _publishTokenEvent() {
        if (!this.deps.sessionKey || !this.deps.cfg)
            return;
        try {
            const cfgWithSession = this.deps.cfg;
            const sessionStorePath = cfgWithSession.sessions?.store ?? cfgWithSession.session?.store;
            if (!sessionStorePath)
                return;
            const agentId = extractAgentIdFromSessionKey(this.deps.sessionKey);
            if (!agentId)
                return;
            const key = this.deps.sessionKey.trim().toLowerCase();
            // 1) Try transcript file for token totals
            const agentSessionDir = typeof sessionStorePath === 'string'
                ? sessionStorePath
                    .replace('{agentDir}', require('path').join(require('os').homedir(), '.openclaw', 'agents'))
                    .replace('{agentId}', agentId)
                : sessionStorePath;
            let transcriptFile;
            try {
                const sdk = config_runtime_1;
                if (sdk?.resolveStorePath) {
                    transcriptFile = sdk.resolveStorePath(agentSessionDir + '/transcript.jsonl');
                }
            }
            catch { /* ignore */ }
            if (!transcriptFile) {
                transcriptFile = agentSessionDir + '/transcript.jsonl';
            }
            const transcriptTotals = computeTranscriptTokenTotals(transcriptFile);
            // 2) Try session store entry for per-turn tokens + model
            let entryTokens;
            let entryModel;
            try {
                const sdk = config_runtime_1;
                if (sdk?.resolveStorePath && sdk?.loadSessionStore) {
                    const storePath = sdk.resolveStorePath(sessionStorePath);
                    const store = sdk.loadSessionStore(storePath);
                    const val = store[key];
                    if (val && typeof val === 'object') {
                        entryTokens = {
                            input: typeof val.inputTokens === 'number' ? val.inputTokens : undefined,
                            output: typeof val.outputTokens === 'number' ? val.outputTokens : undefined,
                        };
                        entryModel = typeof val.model === 'string' ? val.model : undefined;
                    }
                }
                else if (sdk?.resolveSessionStoreEntry) {
                    const val = sdk.resolveSessionStoreEntry(sessionStorePath, key);
                    if (val && typeof val === 'object') {
                        entryTokens = {
                            input: typeof val.inputTokens === 'number' ? val.inputTokens : undefined,
                            output: typeof val.outputTokens === 'number' ? val.outputTokens : undefined,
                        };
                        entryModel = typeof val.model === 'string' ? val.model : undefined;
                    }
                }
            }
            catch { /* ignore */ }
            // 4) Merge transcript totals with entry tokens
            const totalInput = transcriptTotals?.input ?? entryTokens?.input;
            const totalOutput = transcriptTotals?.output ?? entryTokens?.output;
            // 4b) Capture first content time (also set by onPartialReply/onReasoningStream)
            if (this._firstContentTime === null && (totalInput > 0 || totalOutput > 0)) {
                this._firstContentTime = Date.now();
            }
            // Compute first-token latency
            const firstTokenLatencyMs = this._firstContentTime
            // 5) Compute delta from last published event
            const delta = this._lastTokenEvent
                ? {
                    input: typeof totalInput === 'number' && typeof this._lastTokenEvent.input === 'number'
                        ? totalInput - this._lastTokenEvent.input : undefined,
                    output: typeof totalOutput === 'number' && typeof this._lastTokenEvent.output === 'number'
                        ? totalOutput - this._lastTokenEvent.output : undefined,
                }
                : undefined;
            const eventPayload = {
                inputTokens: totalInput,
                outputTokens: totalOutput,
                model: entryModel,
                firstTokenLatencyMs,
                deltaInput: delta?.input,
                deltaOutput: delta?.output,
                contextWindow: resolveContextWindowFromConfig(this.deps.cfg, entryModel),
                timestamp: Date.now(),
            };
            // Publish via tool-use trace store or log
            try {
                const publishTarget = (0, tool_use_trace_store_1.getToolUseTraceStore)?.();
                if (publishTarget?.emitTokenEvent) {
                    publishTarget.emitTokenEvent(this.deps.sessionKey, eventPayload);
                }
                else {
                    log.info('token event', { sessionKey: this.deps.sessionKey, eventPayload });
                }
            }
            catch { /* ignore */ }
            // Publish via event-bus for TokenAggregator
            try {
                const tokens = (typeof totalInput === 'number' ? totalInput : 0) + (typeof totalOutput === 'number' ? totalOutput : 0);
                const deltaInput = delta?.input;
                const deltaOutput = delta?.output;
                const deltaTokens = (typeof deltaInput === 'number' ? deltaInput : 0) + (typeof deltaOutput === 'number' ? deltaOutput : 0);
                (0, event_bus_1.publish)('session_tokens_accrued', {
                    tokens: deltaTokens > 0 ? deltaTokens : tokens,
                    inputTokens: totalInput,
                    outputTokens: totalOutput,
                    sessionKey: this.deps.sessionKey,
                    timestamp: new Date().toISOString(),
                });
            }
            catch { /* ignore */ }
            this._lastTokenEvent = {
                input: totalInput,
                output: totalOutput,
            };
        }
        catch { /* ignore */ }
    }
    constructor(deps) {
        this.deps = deps;
        this.guard = new unavailable_guard_1.UnavailableGuard({
            replyToMessageId: deps.replyToMessageId,
            getCardMessageId: () => this.cardKit.cardMessageId,
            onTerminate: () => {
                this.transition('terminated', 'UnavailableGuard', 'unavailable');
            },
        });
        this.flush = new flush_controller_1.FlushController(() => this.performFlush());
        this.imageResolver = new image_resolver_1.ImageResolver({
            cfg: deps.cfg,
            accountId: deps.accountId,
            onImageResolved: () => {
                if (!this.isTerminalPhase && this.cardKit.cardMessageId) {
                    void this.throttledCardUpdate();
                }
            },
        });
    }
    // ------------------------------------------------------------------
    // Public accessors
    // ------------------------------------------------------------------
    get cardMessageId() {
        return this.cardKit.cardMessageId;
    }
    get isTerminalPhase() {
        return reply_dispatcher_types_1.TERMINAL_PHASES.has(this.phase);
    }
    /**
     * Whether the card has been explicitly aborted (via abortCard()).
     *
     * Distinct from isTerminalPhase — creation_failed is NOT an abort;
     * it should allow fallthrough to static delivery in the factory.
     */
    get isAborted() {
        return this.phase === 'aborted';
    }
    /** Whether the reply pipeline was terminated due to an unavailable message. */
    get isTerminated() {
        return this.guard.isTerminated;
    }
    /** Check if the pipeline should skip further operations for this source. */
    shouldSkipForUnavailable(source) {
        return this.guard.shouldSkip(source);
    }
    /** Attempt to terminate the pipeline due to an unavailable message error. */
    terminateIfUnavailable(source, err) {
        return this.guard.terminate(source, err);
    }
    /** Why the controller entered a terminal phase, or null if still active. */
    get terminalReason() {
        return this._terminalReason;
    }
    /** @internal — exposed for test assertions only. */
    get currentPhase() {
        return this.phase;
    }
    get shouldDisplayToolUse() {
        return this.deps.toolUseDisplay.showToolUse;
    }
    computeToolUseDisplay() {
        if (!this.shouldDisplayToolUse)
            return null;
        const traceSteps = (0, tool_use_trace_store_1.getToolUseTraceSteps)(this.deps.sessionKey);
        return (0, tool_use_display_1.normalizeToolUseDisplay)({
            traceSteps,
            showFullPaths: this.deps.toolUseDisplay.showFullPaths,
            showResultDetails: this.deps.toolUseDisplay.showToolResultDetails,
        });
    }
    get visibleToolUseElapsedMs() {
        if (!this.shouldDisplayToolUse || !this.toolUse.startedAt) {
            return undefined;
        }
        return this.toolUse.elapsedMs || Date.now() - this.toolUse.startedAt;
    }
    computeToolUseTitleSuffix(display) {
        if (!this.shouldDisplayToolUse)
            return undefined;
        const stepCount = display?.stepCount ?? 0;
        return stepCount > 0 ? (0, tool_use_display_1.buildToolUseTitleSuffix)({ stepCount }) : undefined;
    }
    // ------------------------------------------------------------------
    // Unified callback guard
    // ------------------------------------------------------------------
    /**
     * Unified callback guard — returns true if the pipeline is active
     * and the callback should proceed.
     *
     * Combines three checks:
     * 1. guard.isTerminated — message recalled/deleted
     * 2. guard.shouldSkip(source) — eagerly detect unavailable messages
     * 3. isTerminalPhase — completed/aborted/terminated/creation_failed
     */
    shouldProceed(source) {
        if (this.guard.isTerminated || this.guard.shouldSkip(source))
            return false;
        return !this.isTerminalPhase;
    }
    // ------------------------------------------------------------------
    // State machine
    // ------------------------------------------------------------------
    isStaleCreate(epoch) {
        return epoch !== this.createEpoch;
    }
    transition(to, source, reason) {
        const from = this.phase;
        if (from === to)
            return false;
        if (!reply_dispatcher_types_1.PHASE_TRANSITIONS[from].has(to)) {
            log.warn('phase transition rejected', { from, to, source });
            return false;
        }
        this.phase = to;
        log.info('phase transition', { from, to, source, reason });
        if (reply_dispatcher_types_1.TERMINAL_PHASES.has(to)) {
            this._terminalReason = reason ?? null;
            this.onEnterTerminalPhase();
        }
        return true;
    }
    onEnterTerminalPhase() {
        this.createEpoch += 1;
        this.flush.cancelPendingFlush();
        this.flush.complete();
        this.disposeShutdownHook?.();
        this.disposeShutdownHook = null;
        if (this.phase === 'terminated' || this.phase === 'creation_failed') {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    markToolUseActivity() {
        if (!this.toolUse.startedAt) {
            this.toolUse.startedAt = Date.now();
        }
        this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
        this.toolUse.isActive = true;
    }
    captureToolUseElapsed() {
        if (!this.toolUse.startedAt)
            return;
        this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
        this.toolUse.isActive = false;
    }
    // ------------------------------------------------------------------
    // SDK callback bindings
    // ------------------------------------------------------------------
    /**
     * Handle a deliver() call in streaming card mode.
     *
     * Accumulates text from the SDK's deliver callbacks to build the
     * authoritative "completedText" for the final card.
     */
    async onDeliver(payload) {
        if (!this.shouldProceed('onDeliver'))
            return;
        // Capture first content time on first deliver (for non-streaming path)
        if (this._firstContentTime === null) {
            this._firstContentTime = Date.now();
        }
        const text = payload.text ?? '';
        if (!text.trim())
            return;
        await this.ensureCardCreated();
        if (!this.shouldProceed('onDeliver.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        this.captureToolUseElapsed();
        const split = (0, builder_1.splitReasoningText)(text);
        if (split.reasoningText && !split.answerText) {
            // Pure reasoning payload
            this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
                ? Date.now() - this.reasoning.reasoningStartTime
                : 0;
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.reasoning.isReasoningPhase = true;
            await this.throttledCardUpdate();
            return;
        }
        // Answer payload (may also contain inline reasoning from tags)
        this.reasoning.isReasoningPhase = false;
        if (split.reasoningText) {
            this.reasoning.accumulatedReasoningText = split.reasoningText;
        }
        const answerText = split.answerText ?? text;
        // 累积 deliver 文本用于最终卡片
        this.text.completedText += (this.text.completedText ? '\n\n' : '') + answerText;
        // 没有流式数据时，用 deliver 文本显示在卡片上
        if (!this.text.lastPartialText && !this.text.streamingPrefix) {
            this.text.accumulatedText += (this.text.accumulatedText ? '\n\n' : '') + answerText;
            this.text.streamingPrefix = this.text.accumulatedText;
            await this.throttledCardUpdate();
        }
    }
    async onReasoningStream(payload) {
        if (!this.shouldProceed('onReasoningStream'))
            return;
        await this.ensureCardCreated();
        if (!this.shouldProceed('onReasoningStream.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        const rawText = payload.text ?? '';
        if (!rawText)
            return;
        if (!this.reasoning.reasoningStartTime) {
            this.reasoning.reasoningStartTime = Date.now();
        }
        this.reasoning.isReasoningPhase = true;
        const split = (0, builder_1.splitReasoningText)(rawText);
        this.reasoning.accumulatedReasoningText = split.reasoningText ?? rawText;
        await this.throttledCardUpdate();
    }
    async onToolStart(payload) {
        if (!this.shouldProceed('onToolStart'))
            return;
        if (!this.shouldDisplayToolUse)
            return;
        if (payload.phase && payload.phase !== 'start')
            return;
        this.markToolUseActivity();
        await this.ensureCardCreated();
        if (!this.shouldProceed('onToolStart.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
            await this.throttledToolUseStatusUpdate();
            return;
        }
        await this.throttledCardUpdate();
    }
    async onToolPayload(_payload) {
        if (!this.shouldProceed('onToolPayload'))
            return;
        if (!this.shouldDisplayToolUse)
            return;
        this.markToolUseActivity();
        await this.ensureCardCreated();
        if (!this.shouldProceed('onToolPayload.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
            await this.throttledToolUseStatusUpdate();
            return;
        }
        await this.throttledCardUpdate();
    }
    async onPartialReply(payload) {
        if (!this.shouldProceed('onPartialReply'))
            return;
        if (this._firstContentTime === null)
            this._firstContentTime = Date.now();
        // Use splitReasoningText (consistent with onDeliver/onReasoningStream)
        // to extract <think> tag content before stripping it from the answer.
        // Previously only stripReasoningTags was called, silently discarding
        // any thinking content that the LLM wrapped in <think> tags.
        const rawText = payload.text ?? '';
        const split = (0, builder_1.splitReasoningText)(rawText);
        if (split.reasoningText) {
            if (!this.reasoning.reasoningStartTime) {
                this.reasoning.reasoningStartTime = Date.now();
            }
            this.reasoning.accumulatedReasoningText = split.reasoningText;
            this.reasoning.isReasoningPhase = true;
        }
        const text = split.answerText ?? (0, builder_1.stripReasoningTags)(rawText);
        log.debug('onPartialReply', { len: text.length });
        if (!text)
            return;
        this.captureToolUseElapsed();
        if (!this.reasoning.reasoningStartTime) {
            this.reasoning.reasoningStartTime = Date.now();
        }
        if (this.reasoning.isReasoningPhase) {
            this.reasoning.isReasoningPhase = false;
            this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
                ? Date.now() - this.reasoning.reasoningStartTime
                : 0;
        }
        // 检测回复边界：文本长度缩短 → 新回复开始
        if (this.text.lastPartialText && text.length < this.text.lastPartialText.length) {
            this.text.streamingPrefix += (this.text.streamingPrefix ? '\n\n' : '') + this.text.lastPartialText;
        }
        this.text.lastPartialText = text;
        this.text.accumulatedText = this.text.streamingPrefix ? this.text.streamingPrefix + '\n\n' + text : text;
        // NO_REPLY 缓冲
        if (!this.text.streamingPrefix && reply_runtime_1.SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim())) {
            log.debug('onPartialReply: buffering NO_REPLY prefix');
            return;
        }
        await this.ensureCardCreated();
        if (!this.shouldProceed('onPartialReply.postCreate'))
            return;
        if (!this.cardKit.cardMessageId)
            return;
        await this.throttledCardUpdate();
    }
    async onError(err, info) {
        if (this.guard.terminate('onError', err))
            return;
        log.error(`${info.kind} reply failed`, { error: String(err) });
        this.captureToolUseElapsed();
        this._publishTokenEvent();
        this.finalizeCard('onError', 'error');
        await this.flush.waitForFlush();
        if (this.cardCreationPromise)
            await this.cardCreationPromise;
        const errorEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
        const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
        const toolUseDisplay = this.computeToolUseDisplay();
        try {
            if (this.cardKit.cardMessageId) {
                const rawErrorText = this.text.accumulatedText
                    ? `${this.text.accumulatedText}\n\n---\n**Error**: An error occurred while generating the response.`
                    : '**Error**: An error occurred while generating the response.';
                const terminalContent = prepareTerminalCardContent({
                    text: rawErrorText,
                    reasoningText: this.reasoning.accumulatedReasoningText || undefined,
                }, this.imageResolver);
                const errorCard = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: toolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(toolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs: this.elapsed(),
                    isError: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    showGlobalTokens: true,
                    ...resolveModelPrices(this.deps.cfg, footerMetrics?.model),
                });
                if (errorEffectiveCardId) {
                    await this.closeStreamingAndUpdate(errorEffectiveCardId, errorCard, 'onError');
                }
                else {
                    await (0, send_1.updateCardFeishu)({
                        cfg: this.deps.cfg,
                        messageId: this.cardKit.cardMessageId,
                        card: errorCard,
                        accountId: this.deps.accountId,
                    });
                }
            }
        }
        catch {
            // Ignore update failures during error handling
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    async onIdle() {
        if (this.guard.isTerminated || this.guard.shouldSkip('onIdle'))
            return;
        if (!this.dispatchFullyComplete)
            return;
        if (this.isTerminalPhase)
            return;
        this.captureToolUseElapsed();
        this._publishTokenEvent();
        this.finalizeCard('onIdle', 'normal');
        await this.flush.waitForFlush();
        if (this.cardCreationPromise) {
            await this.cardCreationPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            await this.flush.waitForFlush();
        }
        const idleEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
        try {
            if (this.cardKit.cardMessageId) {
                if (idleEffectiveCardId) {
                    const seqBeforeClose = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.info('onIdle: closing streaming mode', {
                        seqBefore: seqBeforeClose,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.setCardStreamingMode)({
                        cfg: this.deps.cfg,
                        cardId: idleEffectiveCardId,
                        streamingMode: false,
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                const isNoReplyLeak = !this.text.completedText && reply_runtime_1.SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim());
                const displayText = this.text.completedText || (isNoReplyLeak ? '' : this.text.accumulatedText) || reply_dispatcher_types_1.EMPTY_REPLY_FALLBACK_TEXT;
                if (!this.text.completedText && !this.text.accumulatedText) {
                    log.warn('reply completed without visible text, using empty-reply fallback');
                }
                // 等待图片异步解析（最多 15s），避免终态卡片留占位符
                const resolvedDisplayText = await this.imageResolver.resolveImagesAwait(displayText, 15_000);
                const idleToolUseDisplay = this.computeToolUseDisplay();
                const terminalContent = prepareTerminalCardContent({
                    text: resolvedDisplayText,
                    reasoningText: this.reasoning.accumulatedReasoningText || undefined,
                }, this.imageResolver);
                const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
                const modelPrices = resolveModelPrices(this.deps.cfg, footerMetrics?.model);
                const completeCard = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: idleToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(idleToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs: this.elapsed(),
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    showGlobalTokens: true,
                    ...modelPrices,
                });
                if (idleEffectiveCardId) {
                    const seqBeforeUpdate = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.info('onIdle: updating final card', {
                        seqBefore: seqBeforeUpdate,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.updateCardKitCard)({
                        cfg: this.deps.cfg,
                        cardId: idleEffectiveCardId,
                        card: (0, builder_1.toCardKit2)(completeCard),
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                }
                else {
                    await (0, send_1.updateCardFeishu)({
                        cfg: this.deps.cfg,
                        messageId: this.cardKit.cardMessageId,
                        card: completeCard,
                        accountId: this.deps.accountId,
                    });
                }
                log.info('reply completed, card finalized', {
                    elapsedMs: this.elapsed(),
                    isCardKit: !!idleEffectiveCardId,
                });
            }
        }
        catch (err) {
            log.warn('final card update failed', { error: String(err) });
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    // ------------------------------------------------------------------
    // External control
    // ------------------------------------------------------------------
    markFullyComplete() {
        log.debug('markFullyComplete', {
            completedTextLen: this.text.completedText.length,
            accumulatedTextLen: this.text.accumulatedText.length,
        });
        this.dispatchFullyComplete = true;
    }
    async abortCard() {
        try {
            this.captureToolUseElapsed();
            this._publishTokenEvent();
            if (!this.transition('aborted', 'abortCard', 'abort'))
                return;
            // transition() already executed onEnterTerminalPhase (cancel + complete + dispose hook)
            // Only need to wait for any in-flight flush to finish
            await this.flush.waitForFlush();
            if (this.cardCreationPromise)
                await this.cardCreationPromise;
            const effectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
            const elapsedMs = Date.now() - this.dispatchStartTime;
            const abortToolUseDisplay = this.computeToolUseDisplay();
            const terminalContent = prepareTerminalCardContent({
                text: this.text.accumulatedText || 'Aborted.',
                reasoningText: this.reasoning.accumulatedReasoningText || undefined,
            }, this.imageResolver);
            const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
            if (effectiveCardId) {
                const abortCardContent = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: abortToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs,
                    isAborted: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    showGlobalTokens: true,
                    ...resolveModelPrices(this.deps.cfg, footerMetrics?.model),
                });
                await this.closeStreamingAndUpdate(effectiveCardId, abortCardContent, 'abortCard');
                log.info('abortCard completed', { effectiveCardId });
            }
            else if (this.cardKit.cardMessageId) {
                // IM fallback: 卡片不是通过 CardKit 发的，用 im.message.patch 更新
                const abortCard = (0, builder_1.buildCardContent)('complete', {
                    text: terminalContent.text,
                    reasoningText: terminalContent.reasoningText,
                    reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
                    toolUseSteps: abortToolUseDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
                    toolUseElapsedMs: this.visibleToolUseElapsedMs,
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                    elapsedMs,
                    isAborted: true,
                    footer: this.deps.resolvedFooter,
                    footerMetrics,
                    showGlobalTokens: true,
                    ...resolveModelPrices(this.deps.cfg, footerMetrics?.model),
                });
                await (0, send_1.updateCardFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    card: abortCard,
                    accountId: this.deps.accountId,
                });
                log.info('abortCard completed (IM fallback)', {
                    messageId: this.cardKit.cardMessageId,
                });
            }
        }
        catch (err) {
            log.warn('abortCard failed', { error: String(err) });
        }
        finally {
            (0, tool_use_trace_store_1.clearToolUseTraceRun)(this.deps.sessionKey);
        }
    }
    // ------------------------------------------------------------------
    // Internal: card creation
    // ------------------------------------------------------------------
    async ensureCardCreated() {
        if (this.guard.shouldSkip('ensureCardCreated.precheck'))
            return;
        if (this.cardKit.cardMessageId || this.phase === 'creation_failed' || this.isTerminalPhase) {
            return;
        }
        if (this.cardCreationPromise) {
            await this.cardCreationPromise;
            return;
        }
        if (!this.transition('creating', 'ensureCardCreated'))
            return;
        this.createEpoch += 1;
        const epoch = this.createEpoch;
        this.cardCreationPromise = (async () => {
            try {
                try {
                    // Step 1: Create card entity
                    const cId = await (0, cardkit_1.createCardEntity)({
                        cfg: this.deps.cfg,
                        card: (0, builder_1.buildStreamingThinkingCard)(this.deps.toolUseDisplay.showToolUse),
                        accountId: this.deps.accountId,
                    });
                    if (this.isStaleCreate(epoch)) {
                        log.info('ensureCardCreated: stale epoch after createCardEntity, bailing out', {
                            epoch,
                            phase: this.phase,
                        });
                        return;
                    }
                    if (cId) {
                        this.cardKit.cardKitCardId = cId;
                        this.cardKit.originalCardKitCardId = cId;
                        this.cardKit.cardKitSequence = 1;
                        this.disposeShutdownHook = (0, shutdown_hooks_1.registerShutdownHook)(`streaming-card:${cId}`, () => this.abortCard());
                        log.info('created CardKit entity', {
                            cardId: cId,
                            initialSequence: this.cardKit.cardKitSequence,
                        });
                        // Step 2: Send IM message referencing card_id
                        const result = await (0, cardkit_1.sendCardByCardId)({
                            cfg: this.deps.cfg,
                            to: this.deps.chatId,
                            cardId: cId,
                            replyToMessageId: this.deps.replyToMessageId,
                            replyInThread: this.deps.replyInThread,
                            accountId: this.deps.accountId,
                        });
                        if (this.isStaleCreate(epoch)) {
                            log.info('ensureCardCreated: stale epoch after sendCardByCardId, bailing out', {
                                epoch,
                                phase: this.phase,
                            });
                            this.disposeShutdownHook?.();
                            this.disposeShutdownHook = null;
                            return;
                        }
                        this.cardKit.cardMessageId = result.messageId;
                        this.flush.setCardMessageReady(true);
                        if (!this.transition('streaming', 'ensureCardCreated.cardkit')) {
                            this.disposeShutdownHook?.();
                            this.disposeShutdownHook = null;
                            return;
                        }
                        log.info('sent CardKit card', { messageId: result.messageId });
                    }
                    else {
                        throw new Error('card.create returned empty card_id');
                    }
                }
                catch (cardKitErr) {
                    if (this.isStaleCreate(epoch))
                        return;
                    if (this.guard.terminate('ensureCardCreated.cardkitFlow', cardKitErr)) {
                        return;
                    }
                    // CardKit flow failed — fall back to regular IM card
                    const apiDetail = extractApiDetail(cardKitErr);
                    log.warn('CardKit flow failed, falling back to IM', { apiDetail });
                    this.cardKit.cardKitCardId = null;
                    this.cardKit.originalCardKitCardId = null;
                    const fallbackCard = (0, builder_1.buildCardContent)('streaming', {
                        showToolUse: this.deps.toolUseDisplay.showToolUse,
                    });
                    const result = await (0, send_1.sendCardFeishu)({
                        cfg: this.deps.cfg,
                        to: this.deps.chatId,
                        card: fallbackCard,
                        replyToMessageId: this.deps.replyToMessageId,
                        replyInThread: this.deps.replyInThread,
                        accountId: this.deps.accountId,
                    });
                    if (this.isStaleCreate(epoch)) {
                        log.info('ensureCardCreated: stale epoch after IM fallback send, bailing out', {
                            epoch,
                            phase: this.phase,
                        });
                        return;
                    }
                    this.cardKit.cardMessageId = result.messageId;
                    this.flush.setCardMessageReady(true);
                    if (!this.transition('streaming', 'ensureCardCreated.imFallback')) {
                        return;
                    }
                    log.info('sent fallback IM card', { messageId: result.messageId });
                }
            }
            catch (err) {
                if (this.isStaleCreate(epoch))
                    return;
                if (this.guard.terminate('ensureCardCreated.outer', err)) {
                    return;
                }
                log.warn('thinking card failed, falling back to static', {
                    error: String(err),
                });
                this.transition('creation_failed', 'ensureCardCreated.outer', 'creation_failed');
            }
        })();
        await this.cardCreationPromise;
    }
    // ------------------------------------------------------------------
    // Internal: flush
    // ------------------------------------------------------------------
    async performFlush() {
        if (!this.cardKit.cardMessageId || this.isTerminalPhase)
            return;
        // v2 CardKit 卡片不能走 IM patch，如果流式 CardKit 已禁用但 originalCardKitCardId
        // 仍在，说明卡片是通过 CardKit 发的——跳过中间态更新，等终态用 originalCardKitCardId 收尾
        if (!this.cardKit.cardKitCardId && this.cardKit.originalCardKitCardId) {
            log.debug('performFlush: skipping (CardKit streaming disabled, awaiting final update)');
            return;
        }
        log.debug('flushCardUpdate: enter', {
            seq: this.cardKit.cardKitSequence,
            isCardKit: !!this.cardKit.cardKitCardId,
        });
        try {
            const displayText = this.buildDisplayText();
            // 流式中间帧使用同步 resolveImages（不等待异步上传）
            const resolvedText = this.imageResolver.resolveImages(displayText);
            if (this.cardKit.cardKitCardId) {
                if (resolvedText !== this.text.lastFlushedText) {
                    const prevSeq = this.cardKit.cardKitSequence;
                    this.cardKit.cardKitSequence += 1;
                    log.debug('flushCardUpdate: answer seq bump', {
                        seqBefore: prevSeq,
                        seqAfter: this.cardKit.cardKitSequence,
                    });
                    await (0, cardkit_1.streamCardContent)({
                        cfg: this.deps.cfg,
                        cardId: this.cardKit.cardKitCardId,
                        elementId: builder_1.STREAMING_ELEMENT_ID,
                        content: (0, markdown_style_1.optimizeMarkdownStyle)(resolvedText),
                        sequence: this.cardKit.cardKitSequence,
                        accountId: this.deps.accountId,
                    });
                    this.text.lastFlushedText = resolvedText;
                }
            }
            else {
                log.debug('flushCardUpdate: IM patch fallback');
                const flushDisplay = this.computeToolUseDisplay();
                const card = (0, builder_1.buildCardContent)('streaming', {
                    text: this.reasoning.isReasoningPhase ? '' : resolvedText,
                    reasoningText: this.reasoning.isReasoningPhase ? this.reasoning.accumulatedReasoningText : undefined,
                    toolUseSteps: flushDisplay?.steps,
                    toolUseTitleSuffix: this.computeToolUseTitleSuffix(flushDisplay),
                    showToolUse: this.deps.toolUseDisplay.showToolUse,
                });
                await (0, send_1.updateCardFeishu)({
                    cfg: this.deps.cfg,
                    messageId: this.cardKit.cardMessageId,
                    card: card,
                    accountId: this.deps.accountId,
                });
            }
        }
        catch (err) {
            if (this.guard.terminate('flushCardUpdate', err))
                return;
            const apiCode = (0, api_error_1.extractLarkApiCode)(err);
            // 速率限制（230020）— 跳过此帧，不降级
            if ((0, card_error_1.isCardRateLimitError)(err)) {
                log.info('flushCardUpdate: rate limited (230020), skipping', {
                    seq: this.cardKit.cardKitSequence,
                });
                return;
            }
            // 卡片表格数超出飞书限制（230099/11310）— 禁用 CardKit 流式，
            // 保留 originalCardKitCardId 供 onIdle 做最终 CardKit 更新
            if ((0, card_error_1.isCardTableLimitError)(err)) {
                log.warn('flushCardUpdate: card table limit exceeded (230099/11310), disabling CardKit streaming', {
                    seq: this.cardKit.cardKitSequence,
                });
                this.cardKit.cardKitCardId = null;
                return;
            }
            const apiDetail = extractApiDetail(err);
            log.error('card stream update failed', {
                apiCode,
                seq: this.cardKit.cardKitSequence,
                apiDetail,
            });
            if (this.cardKit.cardKitCardId) {
                log.warn('disabling CardKit streaming, falling back to im.message.patch');
                this.cardKit.cardKitCardId = null;
            }
        }
    }
    buildDisplayText() {
        if (this.reasoning.isReasoningPhase && this.reasoning.accumulatedReasoningText) {
            const reasoningDisplay = `💭 **Thinking...**\n\n${this.reasoning.accumulatedReasoningText}`;
            return this.text.accumulatedText ? this.text.accumulatedText + '\n\n' + reasoningDisplay : reasoningDisplay;
        }
        return this.text.accumulatedText;
    }
    async throttledCardUpdate() {
        if (this.guard.shouldSkip('throttledCardUpdate'))
            return;
        const throttleMs = this.cardKit.cardKitCardId ? reply_dispatcher_types_1.THROTTLE_CONSTANTS.CARDKIT_MS : reply_dispatcher_types_1.THROTTLE_CONSTANTS.PATCH_MS;
        await this.flush.throttledUpdate(throttleMs);
    }
    // ---- Tool-use status streaming (pre-answer phase) ----
    lastToolUseStatusUpdateTime = 0;
    async throttledToolUseStatusUpdate() {
        if (!this.cardKit.cardKitCardId)
            return;
        const now = Date.now();
        if (now - this.lastToolUseStatusUpdateTime < reply_dispatcher_types_1.THROTTLE_CONSTANTS.REASONING_STATUS_MS)
            return;
        this.lastToolUseStatusUpdateTime = now;
        await this.updateToolUseStatus();
    }
    async updateToolUseStatus() {
        if (!this.cardKit.cardKitCardId || this.isTerminalPhase)
            return;
        try {
            const display = this.computeToolUseDisplay();
            const card = (0, builder_1.buildStreamingPreAnswerCard)({
                steps: display?.steps,
                elapsedMs: this.visibleToolUseElapsedMs,
                showToolUse: this.shouldDisplayToolUse,
            });
            this.cardKit.cardKitSequence += 1;
            await (0, cardkit_1.updateCardKitCard)({
                cfg: this.deps.cfg,
                cardId: this.cardKit.cardKitCardId,
                card,
                sequence: this.cardKit.cardKitSequence,
                accountId: this.deps.accountId,
            });
        }
        catch (err) {
            log.debug('updateToolUseStatus failed', { error: String(err) });
        }
    }
    // ------------------------------------------------------------------
    // Internal: lifecycle helpers
    // ------------------------------------------------------------------
    finalizeCard(source, reason) {
        this.transition('completed', source, reason);
    }
    /**
     * Close streaming mode then update card content (shared by onError and abortCard).
     */
    async closeStreamingAndUpdate(cardId, card, label) {
        const seqBeforeClose = this.cardKit.cardKitSequence;
        this.cardKit.cardKitSequence += 1;
        log.info(`${label}: closing streaming mode`, {
            seqBefore: seqBeforeClose,
            seqAfter: this.cardKit.cardKitSequence,
        });
        await (0, cardkit_1.setCardStreamingMode)({
            cfg: this.deps.cfg,
            cardId,
            streamingMode: false,
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
        });
        const seqBeforeUpdate = this.cardKit.cardKitSequence;
        this.cardKit.cardKitSequence += 1;
        log.info(`${label}: updating card`, {
            seqBefore: seqBeforeUpdate,
            seqAfter: this.cardKit.cardKitSequence,
        });
        await (0, cardkit_1.updateCardKitCard)({
            cfg: this.deps.cfg,
            cardId,
            card: (0, builder_1.toCardKit2)(card),
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
        });
    }
}
exports.StreamingCardController = StreamingCardController;
// ---------------------------------------------------------------------------
// Error detail extraction helpers (replacing `any` casts)
// ---------------------------------------------------------------------------
/**
 * 终态卡片的正文和 reasoning 都会被飞书按 markdown 渲染，
 * 因此两者都要先做图片替换与表格降级，避免再次撞到 230099/11310。
 */
function prepareTerminalCardContent(content, imageResolver, tableLimit = card_error_1.FEISHU_CARD_TABLE_LIMIT) {
    const resolvedReasoningText = content.reasoningText ? imageResolver.resolveImages(content.reasoningText) : undefined;
    const resolvedText = imageResolver.resolveImages(content.text);
    const sanitizedSegments = (0, card_error_1.sanitizeTextSegmentsForCard)(resolvedReasoningText ? [resolvedReasoningText, resolvedText] : [resolvedText], tableLimit);
    if (resolvedReasoningText) {
        return {
            reasoningText: sanitizedSegments[0],
            text: sanitizedSegments[1],
        };
    }
    return { text: sanitizedSegments[0] };
}
function extractApiDetail(err) {
    if (!err || typeof err !== 'object')
        return String(err);
    const e = err;
    return e.response?.data ? JSON.stringify(e.response.data) : String(err);
}
