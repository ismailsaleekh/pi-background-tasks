import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const SHORTCUT_FIXTURE_EVENT = 'pi-bg-test:shortcut-owner:shift-down';

export default function shortcutOwnerFixture(pi: ExtensionAPI): void {
  pi.registerShortcut('shift+down', {
    description: 'Fixture-owned Shift+Down shortcut',
    handler: () => {
      pi.events.emit(SHORTCUT_FIXTURE_EVENT, { owner: 'fixture', key: 'shift+down' });
    },
  });
}
