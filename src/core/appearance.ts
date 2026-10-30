import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Dock colors: defaults first, then overrides from <agentDir>/settings.json
// under the "background-tasks" key, e.g.
//   "background-tasks": { "chipBg": "#b7dfff", "chipFg": "#0b466e", "chipBorder": "#53a0d7" }
// Values: "#rgb" / "#rrggbb" hex; chipBg also accepts "none" (no background).
const DEFAULT_CHIP_BG = '183;223;255';
const DEFAULT_CHIP_FG = '11;70;110';
const DEFAULT_CHIP_BORDER = '83;160;215';

function agentDir(): string {
	const env = process.env['PI_CODING_AGENT_DIR'];
	if (env) return env.replace(/^~(?=$|[/\\])/, homedir());
	return join(homedir(), '.pi', 'agent');
}

// Returns 'none', 'r;g;b', or null when unparseable.
function parseColor(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	if (v === 'none') return 'none';
	if (!v.startsWith('#')) return null;
	const hex = v.slice(1);
	if (/^[0-9a-f]{3}$/.test(hex)) {
		return hex
			.split('')
			.map((ch) => String(parseInt(ch + ch, 16)))
			.join(';');
	}
	if (/^[0-9a-f]{6}$/.test(hex)) {
		return `${parseInt(hex.slice(0, 2), 16)};${parseInt(hex.slice(2, 4), 16)};${parseInt(hex.slice(4, 6), 16)}`;
	}
	return null;
}

interface DockColors {
	chipBg: string;
	chipFg: string;
	chipBorder: string;
}

function readConfiguredColors(): DockColors {
	const out: DockColors = { chipBg: DEFAULT_CHIP_BG, chipFg: DEFAULT_CHIP_FG, chipBorder: DEFAULT_CHIP_BORDER };
	try {
		const raw: unknown = JSON.parse(readFileSync(join(agentDir(), 'settings.json'), 'utf8'));
		const cfg = (raw as Record<string, unknown> | null)?.['background-tasks'];
		if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
			const colors = cfg as Record<string, unknown>;
			const bg = parseColor(colors['chipBg']);
			if (bg) out.chipBg = bg; // 'none' allowed here: disables the chip background
			for (const key of ['chipFg', 'chipBorder'] as const) {
				const parsed = parseColor(colors[key]);
				if (parsed && parsed !== 'none') out[key] = parsed;
			}
		}
	} catch {
		// Missing or invalid settings.json: keep defaults.
	}
	return out;
}

const colors = readConfiguredColors();

export const CHIP_BG = colors.chipBg === 'none' ? '' : `\x1b[48;2;${colors.chipBg}m`;
export const CHIP_FG = `\x1b[38;2;${colors.chipFg}m`;
export const CHIP_BORDER = `\x1b[38;2;${colors.chipBorder}m`;
