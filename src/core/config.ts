export const PI_BG_FEATURE_VALUES = Object.freeze([
  'process',
  'delegate',
  'fusion',
  'attested',
  'attribution',
] as const);
export type PiBackgroundFeature = (typeof PI_BG_FEATURE_VALUES)[number];

export const PI_BG_DEFAULT_FEATURES = PI_BG_FEATURE_VALUES;

export const PI_BG_DOCK_SHORTCUT_VALUES = Object.freeze([
  'shift+down',
  'ctrl+alt+b',
  'off',
] as const);
export type PiBackgroundDockShortcut = (typeof PI_BG_DOCK_SHORTCUT_VALUES)[number];

export const PI_BG_DEFAULT_DOCK_SHORTCUT: PiBackgroundDockShortcut = 'shift+down';

export interface PiBackgroundFeatureSelection {
  readonly process: true;
  readonly delegate: boolean;
  readonly fusion: boolean;
  readonly attested: boolean;
  readonly attribution: boolean;
}

export interface PiBackgroundConfig {
  readonly features: PiBackgroundFeatureSelection;
  readonly dockShortcut: PiBackgroundDockShortcut;
}

const CONFIG_VALUE_EXCERPT_CHARS = 96;

function boundedConfigValue(value: string): string {
  if (value.length <= CONFIG_VALUE_EXCERPT_CHARS) return JSON.stringify(value);
  return `${JSON.stringify(value.slice(0, CONFIG_VALUE_EXCERPT_CHARS))}… (${String(value.length)} chars)`;
}

function invalidConfig(variable: string, reason: string, value: string): never {
  throw new Error(
    `pi_bg_config_invalid: ${variable} ${reason}; received ${boundedConfigValue(value)}`,
  );
}

function parseFeatures(rawValue: string | undefined): PiBackgroundFeatureSelection {
  const raw = rawValue ?? PI_BG_DEFAULT_FEATURES.join(',');
  const accepted = PI_BG_FEATURE_VALUES.join(',');
  if (raw.length === 0) {
    invalidConfig('PI_BG_FEATURES', `must not be empty; accepted tokens: ${accepted}`, raw);
  }
  if (/\s/u.test(raw)) {
    invalidConfig(
      'PI_BG_FEATURES',
      `must contain no whitespace; accepted tokens: ${accepted}`,
      raw,
    );
  }
  const tokens = raw.split(',');
  if (tokens.some((token) => token.length === 0)) {
    invalidConfig(
      'PI_BG_FEATURES',
      `contains a blank comma token; accepted tokens: ${accepted}`,
      raw,
    );
  }

  const selected = new Set<PiBackgroundFeature>();
  for (const token of tokens) {
    if (!(PI_BG_FEATURE_VALUES as readonly string[]).includes(token)) {
      invalidConfig(
        'PI_BG_FEATURES',
        `contains unknown token ${boundedConfigValue(token)}; accepted tokens: ${accepted}; bg_result is derived from delegate or fusion`,
        raw,
      );
    }
    const feature = token as PiBackgroundFeature;
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

function parseDockShortcut(rawValue: string | undefined): PiBackgroundDockShortcut {
  const raw = rawValue ?? PI_BG_DEFAULT_DOCK_SHORTCUT;
  if (!(PI_BG_DOCK_SHORTCUT_VALUES as readonly string[]).includes(raw)) {
    invalidConfig(
      'PI_BG_DOCK_SHORTCUT',
      `accepted values are exactly ${PI_BG_DOCK_SHORTCUT_VALUES.join(',')}`,
      raw,
    );
  }
  return raw as PiBackgroundDockShortcut;
}

export function parseBackgroundTasksConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PiBackgroundConfig {
  const features = parseFeatures(env['PI_BG_FEATURES']);
  const dockShortcut = parseDockShortcut(env['PI_BG_DOCK_SHORTCUT']);
  return Object.freeze({ features, dockShortcut });
}

export function dockShortcutFooterHint(shortcut: PiBackgroundDockShortcut): string {
  if (shortcut === 'shift+down') return 'Shift↓';
  if (shortcut === 'ctrl+alt+b') return 'CtrlAltB';
  return '/tasks';
}
