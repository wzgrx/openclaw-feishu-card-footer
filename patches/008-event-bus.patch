"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * In-process event bus (pub/sub) for cross-module communication.
 *
 * Used by StreamingCardController → TokenAggregator to publish
 * session_tokens_accrued events without direct module coupling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribe = subscribe;
exports.unsubscribe = unsubscribe;
exports.publish = publish;
exports.clearSubscriptions = clearSubscriptions;
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
/**
 * Map of event name → Set of handler references.
 */
const subscriptions = new Map();
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Subscribe to an event.
 * Returns an unsubscribe function for convenience.
 */
function subscribe(event, handler) {
    if (!subscriptions.has(event)) {
        subscriptions.set(event, new Set());
    }
    subscriptions.get(event).add(handler);
    return () => unsubscribe(event, handler);
}
/**
 * Unsubscribe a specific handler from an event.
 */
function unsubscribe(event, handler) {
    const handlers = subscriptions.get(event);
    if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
            subscriptions.delete(event);
        }
    }
}
/**
 * Publish an event to all subscribed handlers.
 * Handlers are called synchronously in registration order.
 * Errors from individual handlers are caught and logged to console.error
 * so that one misbehaving subscriber does not break others.
 */
function publish(event, data) {
    const handlers = subscriptions.get(event);
    if (!handlers || handlers.size === 0)
        return;
    for (const handler of handlers) {
        try {
            handler(data);
        }
        catch (err) {
            console.error(`[event-bus] handler error for event "${event}":`, err);
        }
    }
}
/**
 * Clear all subscriptions (primarily for testing / teardown).
 */
function clearSubscriptions() {
    subscriptions.clear();
}
