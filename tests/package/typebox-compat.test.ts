import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { Compile } from 'typebox/compile';
import { parseJsonText } from '../../src/core/common.js';

// `URL.pathname` yields `/D:/...` on Windows, which then joins into `D:\D:\...`.
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

/** TypeBox APIs removed in the 1.3.x line bundled by Pi 0.83.0 and 0.84.0. */
const REMOVED_TYPEBOX_APIS = [
  'Type.Base',
  'Type.Awaited',
  'Type.Promise',
  'Type.AsyncIterator',
  'Type.Iterator',
  'Type.Options',
  'Value.Mutate',
] as const;

async function sourceFiles(): Promise<string[]> {
  const roots = ['src', 'extensions', 'scripts', 'tests'];
  const files: string[] = [];
  for (const root of roots) {
    const stack = [join(packageRoot, root)];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) break;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    }
  }
  return files.sort();
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value);
}

void describe('TypeBox compatibility', () => {
  void it('resolves the TypeBox version bundled by the installed Pi, not a private pin', async (t: TestContext) => {
    const typeboxPackageJson = join(packageRoot, 'node_modules/typebox/package.json');
    if (!existsSync(typeboxPackageJson)) {
      t.skip('local node_modules/typebox is unavailable in this isolated worktree');
      return;
    }
    const installed = parseJsonText(await readFile(typeboxPackageJson, 'utf8'));
    assert.ok(isRecord(installed));
    const version = String(installed['version']);
    assert.match(
      version,
      /^1\.3\./,
      `expected the Pi 0.83/0.84 TypeBox 1.3.x line, saw ${version}`,
    );

    const manifest = parseJsonText(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    assert.ok(isRecord(manifest));
    const peers = manifest['peerDependencies'];
    assert.ok(isRecord(peers));
    // Pi bundles its extension SDK modules: they are host-provided peers and must
    // never be bundled as private runtime copies.
    assert.equal(peers['typebox'], '*');
    assert.equal(peers['@earendil-works/pi-ai'], '*');
    const deps = manifest['dependencies'];
    assert.equal(
      isRecord(deps) ? deps['typebox'] : undefined,
      undefined,
      'typebox must not be a runtime dependency',
    );
    assert.equal(
      isRecord(deps) ? deps['@earendil-works/pi-ai'] : undefined,
      undefined,
      'pi-ai must not be a private runtime dependency',
    );
    const bundled = manifest['bundledDependencies'];
    assert.equal(Array.isArray(bundled) && bundled.includes('typebox'), false);
    assert.equal(
      Array.isArray(bundled) && bundled.includes('@earendil-works/pi-ai'),
      false,
    );
  });

  void it('requires Pi lines that expose the Fusion settlement and provider-request hooks', async () => {
    const manifest = parseJsonText(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    assert.ok(isRecord(manifest));
    const peers = manifest['peerDependencies'];
    assert.ok(isRecord(peers));
    for (const key of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
      const declaredRange = stringValue(peers[key]);
      for (const supported of ['0.81.1', '0.82.1', '0.83.0', '0.84.0']) {
        assert.ok(
          declaredRange.includes(supported),
          `${key} must declare ${supported}: ${declaredRange}`,
        );
      }
      assert.equal(
        declaredRange.includes('0.75.5'),
        false,
        `${key} must not claim pre-agent_settled Pi compatibility: ${declaredRange}`,
      );
    }
  });

  void it('uses no TypeBox API removed by the Pi 0.83/0.84 bundled version', async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles()) {
      const text = await readFile(file, 'utf8');
      for (const api of REMOVED_TYPEBOX_APIS) {
        // Real member invocations only, so this very list does not self-trip.
        if (new RegExp(`\\b${api.replace('.', '\\.')}\\s*\\(`).test(text)) {
          violations.push(`${file} uses removed TypeBox API ${api}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  void it('compiles the exact shipped delegate and Fusion public schemas under TypeBox 1.3', async () => {
    const { DelegateParams } = await import('../../src/delegate-extension.js');
    const delegate = Compile(DelegateParams);
    assert.equal(delegate.Check({ name: 'inspect', prompt: 'find it' }), true);
    assert.equal(
      delegate.Check({ name: 'inspect', prompt: 'find it', extensionMode: 'ambient' }),
      true,
    );
    assert.equal(
      delegate.Check({ name: 'inspect', prompt: 'find it', extensionPaths: ['/tmp/x.ts'] }),
      false,
    );
    const {
      FusionInvestigateParams,
      FusionReasonParams,
      FusionResearchParams,
      FusionValidateParams,
    } = await import('../../src/fusion-extension.js');
    const reason = Compile(FusionReasonParams);
    assert.equal(reason.Check({ prompt: 'ok' }), true);
    assert.equal(reason.Check({ prompt: 'ok', capability: 'reason' }), false);
    assert.equal(Value.Check(FusionReasonParams, { prompt: 'ok' }), true);

    const investigate = Compile(FusionInvestigateParams);
    assert.equal(
      investigate.Check({
        objective: 'o',
        background: [],
        deliverable: 'd',
        capability: 'inspect',
      }),
      false,
    );
    assert.equal(investigate.Check({ objective: 'o', background: [], deliverable: 'd' }), true);

    const research = Compile(FusionResearchParams);
    assert.equal(
      research.Check({
        objective: 'o',
        background: [],
        deliverable: 'd',
        sources: [{ url: 'https://example.com/', purpose: 'p' }],
      }),
      true,
    );
    assert.equal(
      research.Check({
        objective: 'o',
        background: [],
        deliverable: 'd',
        sources: [],
      }),
      false,
    );

    const validate = Compile(FusionValidateParams);
    assert.equal(
      validate.Check({
        objective: 'o',
        background: [],
        changeSummary: 'c',
        scope: ['s'],
        acceptanceCriteria: ['a'],
        verification: { status: 'provided', evidence: [{ check: 'c', outcome: 'o' }] },
      }),
      true,
    );
    const verification = Reflect.get(
      Reflect.get(FusionValidateParams, 'properties'),
      'verification',
    );
    const status = Reflect.get(Reflect.get(verification, 'properties'), 'status');
    assert.deepEqual(Reflect.get(status, 'enum'), ['provided', 'not_run']);
  });

  void it('compiles nullable-array schemas matching Fusion projection shapes', () => {
    // Nullable array plus nullable string, as used by branch_filter.tool_call_id
    // and the omission ledger's optional tool metadata.
    const Nullable = Type.Object(
      {
        tool_call_id: Type.Union([Type.String(), Type.Null()]),
        entries: Type.Union([Type.Array(Type.String()), Type.Null()]),
        counts: Type.Array(Type.Object({ name: Type.String(), calls: Type.Number() })),
      },
      { additionalProperties: false },
    );
    const compiled = Compile(Nullable);
    assert.equal(compiled.Check({ tool_call_id: null, entries: null, counts: [] }), true);
    assert.equal(
      compiled.Check({ tool_call_id: 'c1', entries: ['a'], counts: [{ name: 'read', calls: 1 }] }),
      true,
    );
    assert.equal(
      compiled.Check({ tool_call_id: null, entries: [1], counts: [] }),
      false,
      'array element types must still be enforced',
    );
    assert.equal(
      compiled.Check({ tool_call_id: null, entries: undefined, counts: [] }),
      false,
      'a nullable array is still required',
    );
    type NullableValue = Static<typeof Nullable>;
    const typed: NullableValue = { tool_call_id: null, entries: ['x'], counts: [] };
    assert.deepEqual(typed.entries, ['x']);
  });

  void it('keeps Value.Check available for the optional-field shapes the package registers', () => {
    const WithOptional = Type.Object(
      {
        taskId: Type.Optional(Type.String()),
        maxBytes: Type.Optional(Type.Number()),
        tail: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    );
    assert.equal(Value.Check(WithOptional, {}), true);
    assert.equal(Value.Check(WithOptional, { taskId: 'a', tail: true }), true);
    assert.equal(Value.Check(WithOptional, { taskId: 5 }), false);
  });
});
