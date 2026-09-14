import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Resolve PI_BG_RUNTIME_ROOT to an absolute runtime storage root.
 *
 * When set (absolute path or `~`-prefixed), task/fusion/delegate runtime
 * artifacts are stored under this root instead of `<cwd>/.pi`, keeping
 * project working trees free of `.pi/` runtime noise.
 *
 * - Unset or empty string returns undefined (default project-local layout).
 * - `~` and `~/x` expand via os.homedir().
 * - Any other relative value fails loudly instead of resolving against an
 *   unpredictable cwd.
 */
export function resolveBgRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env['PI_BG_RUNTIME_ROOT']?.trim();
  if (!raw) return undefined;
  const expanded = raw === '~' || raw.startsWith('~/') ? join(homedir(), raw.slice(1)) : raw;
  if (!isAbsolute(expanded)) {
    throw new Error(
      `PI_BG_RUNTIME_ROOT must be an absolute path or start with '~' (got: ${JSON.stringify(raw)})`,
    );
  }
  return expanded;
}
