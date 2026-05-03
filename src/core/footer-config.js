"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Default values and resolution logic for the Feishu card footer configuration.
 *
 * Each boolean flag controls whether a particular metadata item is displayed
 * in the card footer (e.g. elapsed time, model name).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FOOTER_CONFIG = void 0;
exports.resolveFooterConfig = resolveFooterConfig;
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
/**
 * The default footer configuration.
 *
 * All metadata items are shown by default (opt-out model).
 */
exports.DEFAULT_FOOTER_CONFIG = {
    status: true,
    elapsed: true,
    tokens: true,
    cache: true,
    context: true,
    model: true,
    cost: true,
    todayTokens: true,
    monthTokens: true,
};
// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------
/**
 * Merge a partial footer configuration with `DEFAULT_FOOTER_CONFIG`.
 *
 * Fields present in the input take precedence; anything absent falls back
 * to the default value.
 */
function resolveFooterConfig(cfg) {
    if (!cfg)
        return { ...exports.DEFAULT_FOOTER_CONFIG };
    return {
        status: cfg.status ?? exports.DEFAULT_FOOTER_CONFIG.status,
        elapsed: cfg.elapsed ?? exports.DEFAULT_FOOTER_CONFIG.elapsed,
        tokens: cfg.tokens ?? exports.DEFAULT_FOOTER_CONFIG.tokens,
        cache: cfg.cache ?? exports.DEFAULT_FOOTER_CONFIG.cache,
        context: cfg.context ?? exports.DEFAULT_FOOTER_CONFIG.context,
        model: cfg.model ?? exports.DEFAULT_FOOTER_CONFIG.model,
        cost: cfg.cost ?? exports.DEFAULT_FOOTER_CONFIG.cost,
        todayTokens: cfg.todayTokens ?? exports.DEFAULT_FOOTER_CONFIG.todayTokens,
        monthTokens: cfg.monthTokens ?? exports.DEFAULT_FOOTER_CONFIG.monthTokens,
    };
}
