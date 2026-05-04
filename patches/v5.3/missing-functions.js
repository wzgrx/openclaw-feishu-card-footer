// ============================================================================
// missing-functions.js — v5.3 源码缺失函数补丁
// 将本文件内容插入到 src/card/builder.js 中 buildStreamingToolUsePendingPanel
// 函数定义之前（约 660 行位置）。
// 使用: cat missing-functions.js >> src/card/builder.js （错误做法）
// 正确: 用 sed/awk 在 buildStreamingToolUsePendingPanel 前插入
// ============================================================================

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
        elements.push(hasSteps
            ? buildStreamingToolUseActivePanel({ steps: steps, elapsedMs })
            : buildStreamingToolUsePendingPanel());
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
