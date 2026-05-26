"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * WebSocket monitoring for the Lark/Feishu channel plugin.
 *
 * Manages per-account WSClient connections and routes inbound Feishu
 * events (messages, bot membership changes, read receipts) to the
 * appropriate handlers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitorFeishuProvider = monitorFeishuProvider;
exports.getTokenAggregator = () => _tokenAggregator;
const accounts_1 = require("../core/accounts.js");
const lark_client_1 = require("../core/lark-client.js");
const dedup_1 = require("../messaging/inbound/dedup.js");
const lark_logger_1 = require("../core/lark-logger.js");
const shutdown_hooks_1 = require("../core/shutdown-hooks.js");
const event_handlers_1 = require("./event-handlers.js");
const { TokenAggregator } = require('./token-aggregator.js');
const { startTokenAggregatorDaemon, stopTokenAggregatorDaemon, isDaemonAlive } = require('./token-aggregator-daemon.js');
const path = require('path');
const os = require('os');
const tokenStatsPath = path.join(os.homedir(), '.openclaw', 'token-stats.json');
const mlog = (0, lark_logger_1.larkLogger)('channel/monitor');
// Ensure TaskManager starts at plugin load time
require('../progress/task-manager.js');
// ---------------------------------------------------------------------------
// Single-account monitor
// ---------------------------------------------------------------------------
/**
 * Start monitoring a single Feishu account.
 *
 * Creates a LarkClient, probes bot identity, registers event handlers,
 * and starts a WebSocket connection. Returns a Promise that resolves
 * when the abort signal fires (or immediately if already aborted).
 */
async function monitorSingleAccount(params) {
    const { account, runtime, abortSignal } = params;
    const { accountId } = account;
    const log = runtime?.log ?? ((...args) => mlog.info(args.map(String).join(' ')));
    const error = runtime?.error ?? ((...args) => mlog.error(args.map(String).join(' ')));
    // Only websocket mode is supported in the monitor path.
    const connectionMode = account.config.connectionMode ?? 'websocket';
    if (connectionMode !== 'websocket') {
        log(`feishu[${accountId}]: webhook mode not implemented in monitor`);
        return;
    }
    // Message dedup — filters duplicate deliveries from WebSocket reconnects.
    const dedupCfg = account.config.dedup;
    const messageDedup = new dedup_1.MessageDedup({
        ttlMs: dedupCfg?.ttlMs,
        maxEntries: dedupCfg?.maxEntries,
    });
    log(`feishu[${accountId}]: message dedup enabled (ttl=${messageDedup['ttlMs']}ms, max=${messageDedup['maxEntries']})`);
    log(`feishu[${accountId}]: starting WebSocket connection...`);
    // Create LarkClient instance — manages SDK client, WS, and bot identity.
    const lark = lark_client_1.LarkClient.fromAccount(account);
    // Pass Feishu credentials + config to TaskManager for independent progress cards
    if (global._feishuTaskManager && account.appId && account.appSecret) {
        try {
            global._feishuTaskManager.setCredentials(account.appId, account.appSecret, account.domain);
            global._feishuTaskManager.setLarkClient(lark);
            try { global._feishuTaskManager.setConfig(lark_client_1.LarkClient.globalConfig); } catch (_) {}
        } catch (_) {}
    }
    // Attach dedup instance so it is disposed together with the client.
    lark.messageDedup = messageDedup;
    /** Per-chat history maps (used for group-chat context window). */
    const chatHistories = new Map();
    const ctx = {
        get cfg() {
            return lark_client_1.LarkClient.runtime.config.loadConfig();
        },
        lark,
        accountId,
        chatHistories,
        messageDedup,
        runtime,
        log,
        error,
    };
    // Start progress card timer (watchdog-style polling) — simplified, no-op if task-manager not available
    let progressTimer = null;
    if (account.appId && account.appSecret) {
        try { const { TaskManager } = require('../progress/task-manager.js'); const tm = new TaskManager(); tm.start(); progressTimer = tm; } catch (_) {}
    }
    await lark.startWS({
        handlers: {
            'im.message.receive_v1': (data) => (0, event_handlers_1.handleMessageEvent)(ctx, data),
            'im.message.message_read_v1': async () => { },
            'im.message.reaction.created_v1': (data) => (0, event_handlers_1.handleReactionEvent)(ctx, data),
            // These events are expected in normal usage but do not affect the
            // plugin's current behavior. Register no-op handlers to avoid SDK
            // warnings about missing handlers.
            'im.message.reaction.deleted_v1': async () => { },
            'im.chat.access_event.bot_p2p_chat_entered_v1': async () => { },
            'im.chat.member.bot.added_v1': (data) => (0, event_handlers_1.handleBotMembershipEvent)(ctx, data, 'added'),
            'im.chat.member.bot.deleted_v1': (data) => (0, event_handlers_1.handleBotMembershipEvent)(ctx, data, 'removed'),
            'vc.bot.meeting_invited_v1': (data) => (0, event_handlers_1.handleVcMeetingInvitedEvent)(ctx, data),
            // Drive comment event — fires when a user adds a comment or reply on a document.
            'drive.notice.comment_add_v1': (data) => (0, event_handlers_1.handleCommentEvent)(ctx, data),
            // 飞书 SDK EventDispatcher.register 不支持带返回值的处理器，此处 as any 是 SDK 类型限制的变通
            'card.action.trigger': ((data) => 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (0, event_handlers_1.handleCardActionEvent)(ctx, data)),
        },
        abortSignal,
    });
    // startWS resolves when abortSignal fires — probe result is logged inside startWS.
    log(`feishu[${accountId}]: bot open_id resolved: ${lark.botOpenId ?? 'unknown'}`);
    log(`feishu[${accountId}]: WebSocket client started`);
    mlog.info(`websocket started for account ${accountId}`);
}
// ---------------------------------------------------------------------------
// Module-level state for TokenAggregator / health-check
// ---------------------------------------------------------------------------
/** @type {TokenAggregator|null} */
let _tokenAggregator = null;
/** @type {boolean} */
let _tokenAggregatorDaemonStarted = false;
/** @type {NodeJS.Timeout|null} */
let _healthCheckTimer = null;

/**
 * Start or rearm the health-check watchdog that monitors the token
 * aggregator daemon liveness. Clears any previous timer to prevent
 * duplicate intervals on re-entry.
 */
function ensureHealthCheck(log) {
    if (_healthCheckTimer) {
        clearInterval(_healthCheckTimer);
    }
    _healthCheckTimer = setInterval(() => {
        if (!isDaemonAlive()) {
            log?.('health-check: token-aggregator daemon not alive, restarting...');
            _tokenAggregatorDaemonStarted = false;
            if (!_tokenAggregatorDaemonStarted) {
                _tokenAggregatorDaemonStarted = true;
                startTokenAggregatorDaemon();
                shutdown_hooks_1.registerShutdownHook('token-aggregator-daemon', () => stopTokenAggregatorDaemon());
            }
        }
    }, 30000);
    // Allow process to exit even if the timer is still pending.
    if (_healthCheckTimer && typeof _healthCheckTimer.unref === 'function') {
        _healthCheckTimer.unref();
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Start monitoring for all enabled Feishu accounts (or a single
 * account when `opts.accountId` is specified).
 */
async function monitorFeishuProvider(opts = {}) {
    const cfg = opts.config;
    if (!cfg) {
        throw new Error('Config is required for Feishu monitor');
    }
    // Store the original global config so plugin commands (doctor, diagnose)
    // can access cross-account information even when running inside an
    // account-scoped config context.
    lark_client_1.LarkClient.setGlobalConfig(cfg);
    const log = opts.runtime?.log ?? ((...args) => mlog.info(args.map(String).join(' ')));
    // TokenAggregator singleton — start once per process.
    if (!_tokenAggregator) {
        _tokenAggregator = new TokenAggregator(tokenStatsPath);
        shutdown_hooks_1.registerShutdownHook('token-aggregator', () => _tokenAggregator?.stop());
    }
    if (!_tokenAggregatorDaemonStarted) {
        _tokenAggregatorDaemonStarted = true;
        startTokenAggregatorDaemon();
        shutdown_hooks_1.registerShutdownHook('token-aggregator-daemon', () => stopTokenAggregatorDaemon());
    }
    // Start health-check watchdog — monitors daemon & aggregator liveness.
    ensureHealthCheck(log);
    // Single-account mode.
    if (opts.accountId) {
        const account = (0, accounts_1.getLarkAccount)(cfg, opts.accountId);
        if (!account.enabled || !account.configured) {
            throw new Error(`Feishu account "${opts.accountId}" not configured or disabled`);
        }
        await monitorSingleAccount({
            cfg,
            account,
            runtime: opts.runtime,
            abortSignal: opts.abortSignal,
        });
        await (0, shutdown_hooks_1.drainShutdownHooks)({ log });
        _tokenAggregator = null;
        _tokenAggregatorDaemonStarted = false;
        return;
    }
    // Multi-account mode: start all enabled accounts in parallel.
    const accounts = (0, accounts_1.getEnabledLarkAccounts)(cfg);
    if (accounts.length === 0) {
        throw new Error('No enabled Feishu accounts configured');
    }
    log(`feishu: starting ${accounts.length} account(s): ${accounts.map((a) => a.accountId).join(', ')}`);
    await Promise.all(accounts.map((account) => monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
    })));
    await (0, shutdown_hooks_1.drainShutdownHooks)({ log });
    _tokenAggregator = null;
    _tokenAggregatorDaemonStarted = false;
}
