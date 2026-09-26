import * as hostPiAi from '@earendil-works/pi-ai';
import * as hostPiAiCompat from '@earendil-works/pi-ai/compat';
import { parseBackgroundTasksConfig } from '../src/core/config.js';
const ANTHROPIC_PROVIDER = 'anthropic';
function captureProviderSnapshot(registry) {
    const effective = registry.getProvider(ANTHROPIC_PROVIDER);
    if (effective === undefined) {
        throw new Error('pi_anthropic_attribution_unsupported: the host exposes no effective anthropic provider to preserve');
    }
    return {
        effective,
        legacy: registry.getRegisteredProviderConfig(ANTHROPIC_PROVIDER),
        native: registry.getRegisteredNativeProvider(ANTHROPIC_PROVIDER),
    };
}
function confirmProviderInstallation(registry, before) {
    const token = registry.getRegisteredProviderConfig(ANTHROPIC_PROVIDER);
    const native = registry.getRegisteredNativeProvider(ANTHROPIC_PROVIDER);
    const effective = registry.getProvider(ANTHROPIC_PROVIDER);
    // The accepted duplicate-owner protocol returned without registering anything.
    if (token === before.legacy && native === before.native && effective === before.effective) {
        return undefined;
    }
    if (token === undefined ||
        token === before.legacy ||
        native !== undefined ||
        effective === undefined ||
        effective === before.effective ||
        token.streamSimple === before.legacy?.streamSimple) {
        throw new Error('pi_anthropic_attribution_install_failed: host provider registration did not install the package transport atomically');
    }
    return { registry, before, token };
}
function sameConfigValues(left, right) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && Object.is(Reflect.get(left, key), Reflect.get(right, key))));
}
function restoreProviderInstallation(installation) {
    const { registry, before, token } = installation;
    if (registry.getRegisteredProviderConfig(ANTHROPIC_PROVIDER) !== token ||
        registry.getRegisteredNativeProvider(ANTHROPIC_PROVIDER) !== undefined) {
        // A later owner replaced this exact installation. It owns teardown now.
        return;
    }
    if (before.native !== undefined) {
        registry.registerProvider(before.native);
    }
    else if (before.legacy !== undefined) {
        // Native replacement removes only the still-current package legacy layer. Reapplying
        // the prior legacy snapshot then starts from an empty legacy layer, so package-only
        // fields cannot leak through ModelRuntime's documented merge semantics.
        registry.registerProvider(before.effective);
        registry.registerProvider(ANTHROPIC_PROVIDER, before.legacy);
    }
    else {
        // The exact package token and absence of a later native owner were proven above.
        // Public unregister is therefore owner-conditional here: it removes only this
        // still-current package layer and restores dynamic-registration absence. The host
        // may legitimately refresh its built-in provider while our overlay is installed,
        // so that host-owned effective object is not required to retain stale identity.
        registry.unregisterProvider(ANTHROPIC_PROVIDER);
    }
    const restoredConfig = registry.getRegisteredProviderConfig(ANTHROPIC_PROVIDER);
    const restoredNative = registry.getRegisteredNativeProvider(ANTHROPIC_PROVIDER);
    const restoredEffective = registry.getProvider(ANTHROPIC_PROVIDER);
    const restoredIds = registry.getRegisteredProviderIds();
    const registrationRestored = before.legacy !== undefined
        ? restoredNative === undefined &&
            restoredConfig !== undefined &&
            sameConfigValues(restoredConfig, before.legacy)
        : restoredConfig === undefined &&
            (before.native !== undefined
                ? restoredNative === before.native
                : restoredNative === undefined);
    const registeredIdRestored = before.legacy !== undefined || before.native !== undefined
        ? restoredIds.includes(ANTHROPIC_PROVIDER)
        : !restoredIds.includes(ANTHROPIC_PROVIDER);
    if (!registrationRestored || restoredEffective === undefined || !registeredIdRestored) {
        throw new Error('pi_anthropic_attribution_restore_failed: the preexisting public provider registration state was not restored');
    }
}
export default async function ambientAnthropicAttribution(pi) {
    const config = parseBackgroundTasksConfig();
    if (config.features.attribution) {
        const { default: spawnAnthropicAttribution, resolveHostAnthropicMessagesApi, resolveHostTranscriptHelpers, } = await import('../src/core/anthropic-attribution.js');
        const anthropicMessagesApi = resolveHostAnthropicMessagesApi(hostPiAiCompat);
        const hostTranscriptHelpers = resolveHostTranscriptHelpers(hostPiAi);
        let installation;
        pi.on('session_start', (_event, context) => {
            const registry = context.modelRegistry;
            const before = captureProviderSnapshot(registry);
            spawnAnthropicAttribution(pi, {
                hostAnthropicMessagesApi: anthropicMessagesApi,
                hostTranscriptHelpers,
            });
            installation = confirmProviderInstallation(registry, before) ?? installation;
        });
        pi.on('session_shutdown', () => {
            const current = installation;
            installation = undefined;
            if (current !== undefined)
                restoreProviderInstallation(current);
        });
    }
}
//# sourceMappingURL=anthropic-attribution.js.map