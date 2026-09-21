import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);

function text(path: string): string {
  return readFileSync(new URL(path, root), 'utf8');
}

void describe('docs package integration contract', () => {
  void it('declares docs scripts, prepack gates, and packaged docs payload', () => {
    const pkg = JSON.parse(text('package.json')) as {
      files: string[];
      scripts: Record<string, string>;
      pi?: { image?: string };
    };
    assert.ok(pkg.files.includes('docs/'));
    assert.ok(pkg.files.includes('BACKGROUND-TASKS-INSTRUCTIONS.md'));
    assert.ok(pkg.files.includes('logo.png'));
    assert.equal(
      pkg.pi?.image,
      'https://raw.githubusercontent.com/ismailsaleekh/pi-background-tasks/main/logo.png',
    );
    assert.equal(pkg.scripts['docs:generate'], 'node scripts/docs/generate.mjs');
    assert.equal(pkg.scripts['docs:verify'], 'node scripts/docs/verify.mjs');
    assert.equal(
      pkg.scripts['docs:verify:attestations'],
      'node scripts/docs/verify.mjs --require-attestations',
    );
    assert.equal(pkg.scripts['docs:attest/record'], 'node scripts/docs/attest.mjs');
    assert.equal(
      pkg.scripts['test:docs'],
      'tsx --test tests/unit/docs-gate.test.ts tests/package/docs-contract.test.ts',
    );
    assert.equal(
      pkg.scripts['payload:check'],
      'npm run build:runtime && node scripts/check-package-payload.mjs',
    );
    assert.equal(pkg.scripts['release:check-version'], 'node scripts/check-release-version.mjs');
    assert.match(pkg.scripts['prepack'] ?? '', /build:runtime/);
    assert.match(pkg.scripts['prepack'] ?? '', /docs:verify/);
    assert.match(pkg.scripts['prepack'] ?? '', /check-package-payload/);
    for (const path of [
      'docs/INDEX.md',
      'docs/read-before-edit.md',
      'docs/manifest.json',
      'docs/attestations.json',
      'docs/subsystems/docs-freshness-gate.md',
    ]) {
      assert.ok(existsSync(new URL(path, root)), `${path} must exist`);
    }
  });

  void it('publishes finite capability and shortcut availability from runtime source', () => {
    const manifest = JSON.parse(text('docs/manifest.json')) as {
      default_public_surface_ids?: string[];
      public_surfaces?: Record<
        string,
        Array<{ id?: string; availability?: string; default_available?: boolean }>
      >;
    };
    assert.ok(Array.isArray(manifest.default_public_surface_ids));
    const surfaces = Object.values(manifest.public_surfaces ?? {}).flat();
    const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
    assert.deepEqual(
      {
        delegate: byId.get('tool:bg_delegate')?.availability,
        fusion: byId.get('tool:fusion_reason')?.availability,
        result: byId.get('tool:bg_result')?.availability,
        attested: byId.get('tool:bg_run_pi_attested')?.availability,
        attribution: byId.get('command:claude-cache')?.availability,
        defaultDock: byId.get('shortcut:shift+down')?.availability,
        alternateDock: byId.get('shortcut:ctrl+alt+b')?.availability,
      },
      {
        delegate: 'feature:delegate',
        fusion: 'feature:fusion',
        result: 'any(feature:delegate,feature:fusion)',
        attested: 'feature:attested',
        attribution: 'feature:attribution',
        defaultDock: 'dock:shift+down',
        alternateDock: 'dock:ctrl+alt+b',
      },
    );
    assert.equal(byId.get('shortcut:shift+down')?.default_available, true);
    assert.equal(byId.get('shortcut:ctrl+alt+b')?.default_available, false);
    assert.ok(manifest.default_public_surface_ids?.includes('shortcut:shift+down'));
    assert.equal(manifest.default_public_surface_ids?.includes('shortcut:ctrl+alt+b'), false);

    assert.match(text('docs/INDEX.md'), /Availability \| Default/);
    assert.match(text('README.md'), /any\(feature:delegate,feature:fusion\)/);
    assert.match(text('docs/tools/bg_result.md'), /any\(feature:delegate,feature:fusion\)/);
    assert.match(text('docs/reference/shortcuts-and-dock.md'), /ctrl\+alt\+b/);
    assert.match(text('docs/operations/configuration.md'), /PI_BG_FEATURES/);
    assert.match(text('docs/operations/configuration.md'), /PI_BG_DOCK_SHORTCUT/);
  });

  void it('evaluates the exact manifest inventory for all 48 feature and dock profiles', () => {
    const manifest = JSON.parse(text('docs/manifest.json')) as {
      public_surfaces: Record<
        string,
        Array<{ id: string; availability: string; default_available: boolean }>
      >;
    };
    const surfaces = Object.values(manifest.public_surfaces).flat();
    const always = new Set(
      surfaces.filter((surface) => surface.availability === 'always').map((surface) => surface.id),
    );
    assert.equal(always.size, 15);
    const byFeature = new Map<string, ReadonlySet<string>>([
      ['delegate', new Set(['tool:bg_delegate'])],
      [
        'fusion',
        new Set([
          'command:fusion',
          'command:fusion-models',
          'tool:fusion_investigate',
          'tool:fusion_reason',
          'tool:fusion_research',
          'tool:fusion_validate',
          'renderer:fusion-result',
          'workflow:investigate',
          'workflow:reason',
          'workflow:research',
          'workflow:validate',
        ]),
      ],
      ['attested', new Set(['tool:bg_run_pi_attested'])],
      ['attribution', new Set(['command:claude-cache'])],
    ]);
    const optional = [...byFeature.keys()];
    const docks = ['shift+down', 'ctrl+alt+b', 'off'] as const;
    for (let mask = 0; mask < 1 << optional.length; mask += 1) {
      const selected = new Set(optional.filter((_feature, index) => (mask & (1 << index)) !== 0));
      for (const dock of docks) {
        const expected = new Set(always);
        for (const feature of selected) {
          for (const id of byFeature.get(feature) ?? []) expected.add(id);
        }
        if (selected.has('delegate') || selected.has('fusion')) expected.add('tool:bg_result');
        if (dock !== 'off') expected.add(`shortcut:${dock}`);

        const actual = surfaces
          .filter((surface) => {
            if (surface.availability === 'always') return true;
            if (surface.availability === 'any(feature:delegate,feature:fusion)') {
              return selected.has('delegate') || selected.has('fusion');
            }
            if (surface.availability.startsWith('feature:')) {
              return selected.has(surface.availability.slice('feature:'.length));
            }
            if (surface.availability.startsWith('dock:')) {
              return surface.availability === `dock:${dock}`;
            }
            assert.fail(`unsupported availability ${surface.availability}`);
          })
          .map((surface) => surface.id)
          .sort();
        assert.deepEqual(
          actual,
          [...expected].sort(),
          `manifest profile mask=${String(mask)} dock=${dock}`,
        );
      }
    }
  });

  void it('states the initialized-host SDK boundary without narrowing the blocker', () => {
    const gettingStarted = text('docs/getting-started.md');
    const configuration = text('docs/operations/configuration.md');
    const attribution = text('docs/subsystems/anthropic-attribution.md');
    const eventBus = text('docs/api/eventbus-v1.md');
    const cacheCommand = text('docs/commands/claude-cache.md');

    assert.match(gettingStarted, /SDK embedding requirement/i);
    assert.match(gettingStarted, /at least one counted binding/i);
    assert.match(configuration, /bindExtensions\(\)/);
    assert.match(configuration, /after every `reload\(\)`/i);
    assert.match(attribution, /BLOCKED_SCOPE/);
    assert.match(attribution, /bare `createAgentSession\(\)`/);
    assert.match(eventBus, /normal Pi TUI, RPC, print, and JSON modes/i);
    assert.match(cacheCommand, /bare SDK sessions and empty\/mode-only reloads require/i);
    for (const prose of [gettingStarted, configuration, attribution, eventBus, cacheCommand]) {
      assert.match(prose, /initialized-host contract/i);
      assert.match(prose, /not a pre-bind availability guarantee/i);
    }
  });

  void it('pins reviewed runtime and generated artifact semantics', () => {
    const contracts = text('docs/reference/runtime-contracts.md');
    assert.match(contracts, /candidate-<slot>\.attempt-<n>/);
    assert.match(contracts, /evaluation\.attempt-<n>\.response\.txt/);
    assert.match(contracts, /merge\.attempt-<n>\.response\.md/);
    assert.match(contracts, /tool-calls\.jsonl\.seal\.json/);
    assert.doesNotMatch(contracts, /<stage>\[\.<slot>\]/);

    assert.match(text('docs/commands/task-manager.md'), /exact task id opens detail view/);
    assert.match(text('docs/api/eventbus-v1.md'), /at least once under emission failure/);
    assert.match(
      text('docs/api/eventbus-v1.md'),
      /requests first emitted after close are not handled and receive no service response/,
    );
    assert.match(
      text('docs/api/eventbus-v1.md'),
      /request already accepted before close may receive one error response, but never a post-close success/,
    );
    assert.match(text('docs/subsystems/background-task-runtime.md'), /rather than issuing `fsync`/);
    assert.match(
      text('docs/subsystems/background-task-runtime.md'),
      /may occur after the completion notification/,
    );
    assert.match(
      text('docs/subsystems/attested-pi-runs.md'),
      /last assistant `stopReason` value reported/,
    );
    assert.match(text('docs/subsystems/delegation.md'), /Inside `preflightDelegateLaunch\(\)`/);
    assert.match(text('docs/subsystems/delegation.md'), /Windows skips directory fsync/);
    assert.match(
      text('docs/subsystems/delegation.md'),
      /best-effort durable write of `outcome\.json`/,
    );
    assert.match(text('docs/subsystems/host-ui-and-telemetry.md'), /detail view is opened/);
    assert.match(text('docs/subsystems/host-ui-and-telemetry.md'), /dock is closed/);
    assert.doesNotMatch(
      text('docs/reference/shortcuts-and-dock.md'),
      /Opening or closing the dock does not clear them/,
    );
    assert.match(
      text('docs/commands/fusion-models.md'),
      /typed text—including `q`—filters the list/,
    );
    assert.match(text('docs/commands/fusion-models.md'), /Esc returns to the slots/);
    assert.match(
      text('docs/tools/fusion_research.md'),
      /DNS\/redirect transport classification does not explicitly include/,
    );
    assert.match(
      text('docs/subsystems/fusion.md'),
      /deny rules are not an exhaustive network sandbox/,
    );
  });
});
