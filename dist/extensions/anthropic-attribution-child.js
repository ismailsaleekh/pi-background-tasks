import { anthropicMessagesApi } from '@earendil-works/pi-ai/compat';
import spawnAnthropicAttribution, {} from '../src/core/anthropic-attribution.js';
// Always-on safety entrypoint for package-owned isolated Anthropic children.
// Ambient parent capability selection must never disable this extension.
export default function childAnthropicAttribution(pi) {
    spawnAnthropicAttribution(pi, { hostAnthropicMessagesApi: anthropicMessagesApi });
}
//# sourceMappingURL=anthropic-attribution-child.js.map