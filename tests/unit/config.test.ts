import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dockShortcutFooterHint,
  parseBackgroundTasksConfig,
  PI_BG_DEFAULT_DOCK_SHORTCUT,
  PI_BG_DEFAULT_FEATURES,
  PI_BG_DOCK_SHORTCUT_VALUES,
  PI_BG_FEATURE_VALUES,
} from '../../src/core/config.js';

void describe('background task capability configuration', () => {
  void it('keeps the full capability surface and Shift+Down as defaults', () => {
    const config = parseBackgroundTasksConfig({});
    assert.deepEqual(PI_BG_DEFAULT_FEATURES, PI_BG_FEATURE_VALUES);
    assert.equal(PI_BG_DEFAULT_DOCK_SHORTCUT, 'shift+down');
    assert.deepEqual(config.features, {
      process: true,
      delegate: true,
      fusion: true,
      attested: true,
      attribution: true,
    });
    assert.equal(config.dockShortcut, 'shift+down');
    assert.equal(dockShortcutFooterHint(config.dockShortcut), 'Shift↓');
  });

  void it('parses every optional-feature subset without adding dependencies', () => {
    const optional = ['delegate', 'fusion', 'attested', 'attribution'] as const;
    for (let mask = 0; mask < 1 << optional.length; mask += 1) {
      const selected = optional.filter((_feature, index) => (mask & (1 << index)) !== 0);
      const config = parseBackgroundTasksConfig({
        PI_BG_FEATURES: ['process', ...selected].join(','),
      });
      assert.equal(config.features.process, true);
      for (const feature of optional) {
        assert.equal(config.features[feature], selected.includes(feature), `${mask}:${feature}`);
      }
    }
  });

  void it('accepts only the three finite dock choices and derives their hints', () => {
    assert.deepEqual(PI_BG_DOCK_SHORTCUT_VALUES, ['shift+down', 'ctrl+alt+b', 'off']);
    assert.deepEqual(
      PI_BG_DOCK_SHORTCUT_VALUES.map((shortcut) => [
        parseBackgroundTasksConfig({
          PI_BG_FEATURES: 'process',
          PI_BG_DOCK_SHORTCUT: shortcut,
        }).dockShortcut,
        dockShortcutFooterHint(shortcut),
      ]),
      [
        ['shift+down', 'Shift↓'],
        ['ctrl+alt+b', 'CtrlAltB'],
        ['off', '/tasks'],
      ],
    );
  });

  void it('rejects malformed values without fallback or unbounded echo', () => {
    for (const value of [
      '',
      'process,',
      'process, delegate',
      'process,delegate,delegate',
      'process,unknown',
      'delegate',
      'process,bg_result',
      'PROCESS',
    ]) {
      assert.throws(
        () => parseBackgroundTasksConfig({ PI_BG_FEATURES: value }),
        /pi_bg_config_invalid: PI_BG_FEATURES/,
        value,
      );
    }
    assert.throws(
      () =>
        parseBackgroundTasksConfig({
          PI_BG_FEATURES: 'process',
          PI_BG_DOCK_SHORTCUT: 'shift+up',
        }),
      /pi_bg_config_invalid: PI_BG_DOCK_SHORTCUT.*shift\+down,ctrl\+alt\+b,off/,
    );
    const huge = `process,${'x'.repeat(10_000)}`;
    let message = '';
    try {
      parseBackgroundTasksConfig({ PI_BG_FEATURES: huge });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.ok(message.length > 0 && message.length < 700, message.length.toString());
    assert.doesNotMatch(message, /x{200}/);
  });
});
