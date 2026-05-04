#!/usr/bin/env node
/**
 * Token Aggregator Daemon — Standalone process for 🪙 token tracking.
 *
 * Runs as a systemd user service, polling sessions.json every 5 seconds
 * and maintaining ~/.openclaw/token-stats.json.
 *
 * Installation:
 *   1. cp token-aggregator-daemon.js ~/.openclaw/channels/feishu/
 *   2. cp openclaw-token-aggregator.service ~/.config/systemd/user/
 *   3. systemctl --user daemon-reload
 *   4. systemctl --user enable --now openclaw-token-aggregator
 */
"use strict";

const path = require('path');
const aggrPath = path.join(process.env.HOME, '.openclaw', 'channels', 'feishu', 'token-aggregator.js');

try {
    const { manager } = require(aggrPath);
    console.log('[token-aggregator-daemon] started');
    manager.start();

    // Graceful shutdown
    process.on('SIGINT', () => { manager.stop(); process.exit(0); });
    process.on('SIGTERM', () => { manager.stop(); process.exit(0); });
} catch (e) {
    console.error('[token-aggregator-daemon] failed to load aggregator:', e.message);
    process.exit(1);
}
