import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Resolve the package-owned always-on Anthropic child attribution extension.
 *
 * Package-owned child Pi processes disable ambient extension discovery, so they
 * must explicitly load this safety entrypoint. It deliberately bypasses the
 * independently selectable ambient parent capability. Keeping path resolution
 * in one module prevents Fusion, delegation, and attested runs from deriving
 * different package paths.
 */
export function resolveAnthropicAttributionExtensionPath(moduleUrl = import.meta.url, pathExists = existsSync) {
    const modulePath = fileURLToPath(moduleUrl);
    const extension = modulePath.endsWith('.ts')
        ? 'anthropic-attribution-child.ts'
        : 'anthropic-attribution-child.js';
    const candidate = resolve(dirname(modulePath), '../../extensions', extension);
    if (!pathExists(candidate)) {
        throw new Error(`Anthropic attribution extension is missing: ${candidate}`);
    }
    return candidate;
}
//# sourceMappingURL=anthropic-attribution-path.js.map