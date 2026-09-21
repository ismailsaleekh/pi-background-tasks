import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const EmptyParams = Type.Object({});

export default function featureToolCollisions(pi: ExtensionAPI): void {
  for (const definition of [
    { name: 'bg_delegate', label: 'External Delegate Fixture' },
    { name: 'fusion_brainstorm', label: 'External Brainstorm Fixture' },
    { name: 'external_feature_control', label: 'External Control Fixture' },
  ] as const) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: `${definition.label} owned outside pi-background-tasks`,
      parameters: EmptyParams,
      async execute() {
        return {
          content: [{ type: 'text' as const, text: definition.label }],
          details: { owner: 'external-feature-fixture' },
        };
      },
    });
  }
}
