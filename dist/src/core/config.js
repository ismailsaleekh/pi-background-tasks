export const PI_BG_FEATURE_VALUES = Object.freeze([
    'process',
    'delegate',
    'fusion',
    'attested',
    'attribution',
]);
export const PI_BG_DEFAULT_FEATURES = PI_BG_FEATURE_VALUES;
export const PI_BG_DOCK_SHORTCUT_VALUES = Object.freeze([
    'shift+down',
    'ctrl+alt+b',
    'off',
]);
export const PI_BG_DEFAULT_DOCK_SHORTCUT = 'shift+down';
export const PI_BG_FOOTER_DISPLAY_VALUES = Object.freeze(['all', 'running', 'off']);
export const PI_BG_DEFAULT_FOOTER_DISPLAY = 'all';
export const BG_DISPLAY_ENTRY = 'pi-background-tasks.footer-display';
export const BG_DISPLAY_SCHEMA = 'pi-background-tasks.footer-display.v1';
const CONFIG_VALUE_EXCERPT_CHARS = 96;
function boundedConfigValue(value) {
    if (value.length <= CONFIG_VALUE_EXCERPT_CHARS)
        return JSON.stringify(value);
    return `${JSON.stringify(value.slice(0, CONFIG_VALUE_EXCERPT_CHARS))}… (${String(value.length)} chars)`;
}
function invalidConfig(variable, reason, value) {
    throw new Error(`pi_bg_config_invalid: ${variable} ${reason}; received ${boundedConfigValue(value)}`);
}
function parseFeatures(rawValue) {
    const raw = rawValue ?? PI_BG_DEFAULT_FEATURES.join(',');
    const accepted = PI_BG_FEATURE_VALUES.join(',');
    if (raw.length === 0) {
        invalidConfig('PI_BG_FEATURES', `must not be empty; accepted tokens: ${accepted}`, raw);
    }
    if (/\s/u.test(raw)) {
        invalidConfig('PI_BG_FEATURES', `must contain no whitespace; accepted tokens: ${accepted}`, raw);
    }
    const tokens = raw.split(',');
    if (tokens.some((token) => token.length === 0)) {
        invalidConfig('PI_BG_FEATURES', `contains a blank comma token; accepted tokens: ${accepted}`, raw);
    }
    const selected = new Set();
    for (const token of tokens) {
        if (!PI_BG_FEATURE_VALUES.includes(token)) {
            invalidConfig('PI_BG_FEATURES', `contains unknown token ${boundedConfigValue(token)}; accepted tokens: ${accepted}; bg_result is derived from delegate or fusion`, raw);
        }
        const feature = token;
        if (selected.has(feature)) {
            invalidConfig('PI_BG_FEATURES', `contains duplicate token ${feature}`, raw);
        }
        selected.add(feature);
    }
    if (!selected.has('process')) {
        invalidConfig('PI_BG_FEATURES', 'must include mandatory token process', raw);
    }
    return Object.freeze({
        process: true,
        delegate: selected.has('delegate'),
        fusion: selected.has('fusion'),
        attested: selected.has('attested'),
        attribution: selected.has('attribution'),
    });
}
function parseDockShortcut(rawValue) {
    const raw = rawValue ?? PI_BG_DEFAULT_DOCK_SHORTCUT;
    if (!PI_BG_DOCK_SHORTCUT_VALUES.includes(raw)) {
        invalidConfig('PI_BG_DOCK_SHORTCUT', `accepted values are exactly ${PI_BG_DOCK_SHORTCUT_VALUES.join(',')}`, raw);
    }
    return raw;
}
function parseFooterDisplay(rawValue) {
    const raw = rawValue ?? PI_BG_DEFAULT_FOOTER_DISPLAY;
    if (!PI_BG_FOOTER_DISPLAY_VALUES.includes(raw)) {
        invalidConfig('PI_BG_FOOTER_DISPLAY', `accepted values are exactly ${PI_BG_FOOTER_DISPLAY_VALUES.join(',')}`, raw);
    }
    return raw;
}
export function restoreBackgroundTasksFooterDisplay(entries) {
    let restored;
    for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
            continue;
        const record = entry;
        if (record['type'] !== 'custom' || record['customType'] !== BG_DISPLAY_ENTRY)
            continue;
        const data = record['data'];
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            throw new Error('pi_bg_footer_entry_invalid: malformed footer display entry');
        }
        const value = data;
        const mode = value['mode'];
        if (value['schema_version'] !== BG_DISPLAY_SCHEMA ||
            (mode !== 'default' && mode !== 'all' && mode !== 'running' && mode !== 'off')) {
            throw new Error('pi_bg_footer_entry_invalid: malformed footer display entry');
        }
        restored = mode === 'default' ? undefined : mode;
    }
    return restored;
}
export function parseBackgroundTasksConfig(env = process.env) {
    const features = parseFeatures(env['PI_BG_FEATURES']);
    const dockShortcut = parseDockShortcut(env['PI_BG_DOCK_SHORTCUT']);
    const footerDisplay = parseFooterDisplay(env['PI_BG_FOOTER_DISPLAY']);
    return Object.freeze({ features, dockShortcut, footerDisplay });
}
export function dockShortcutFooterHint(shortcut) {
    if (shortcut === 'shift+down')
        return 'Shift↓';
    if (shortcut === 'ctrl+alt+b')
        return 'CtrlAltB';
    return '/tasks';
}
//# sourceMappingURL=config.js.map