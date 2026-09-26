import * as hostPiAi from '@earendil-works/pi-ai';
import * as hostPiAiCompat from '@earendil-works/pi-ai/compat';
import spawnAnthropicAttribution, {
  resolveHostAnthropicMessagesApi,
  resolveHostTranscriptHelpers,
  type PiExtensionHost,
} from '../src/core/anthropic-attribution.js';

// Always-on safety entrypoint for package-owned isolated Anthropic children.
// Ambient parent capability selection must never disable this extension.
export default function childAnthropicAttribution(pi: PiExtensionHost): void {
  const anthropicMessagesApi = resolveHostAnthropicMessagesApi(hostPiAiCompat);
  spawnAnthropicAttribution(pi, {
    hostAnthropicMessagesApi: anthropicMessagesApi,
    hostTranscriptHelpers: resolveHostTranscriptHelpers(hostPiAi),
  });
}
