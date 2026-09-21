import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const PEER_GUIDANCE =
  '<pi_background_feature_guidance>peer feature guidance survives</pi_background_feature_guidance>';

export default function shellPolicyPeerGuidance(pi: ExtensionAPI): void {
  pi.on('before_agent_start', (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${PEER_GUIDANCE}`,
  }));
}
