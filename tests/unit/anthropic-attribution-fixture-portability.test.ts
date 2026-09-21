import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  parseQualificationHostArgument,
  resolveQualificationHost,
} from '../fixtures/anthropic-forwarding-host-resolution.ts';

const HOST_NAME = '@earendil-works/pi-coding-agent';
const PI_AI_NAME = '@earendil-works/pi-ai';

interface SyntheticPackageOptions {
  readonly root: string;
  readonly name: string;
  readonly version?: string;
  readonly entry?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

async function writeSyntheticPackage(options: SyntheticPackageOptions): Promise<void> {
  const entry = options.entry ?? './lib/public-entry.mjs';
  await mkdir(dirname(join(options.root, entry)), { recursive: true });
  await writeFile(join(options.root, entry), 'export const qualificationFixture = true;\n', 'utf8');
  await writeFile(
    join(options.root, 'package.json'),
    `${JSON.stringify({
      name: options.name,
      version: options.version ?? '0.86.0',
      type: 'module',
      exports: { '.': { import: entry } },
      dependencies: options.dependencies,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function makeTestRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'attribution-host-resolution-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

test('keeps the optional host fixture independent of absolute installation imports', async () => {
  const fixture = await readFile(
    new URL('../fixtures/anthropic-forwarding-pi086.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(fixture, /\bfrom\s+['"](?:\/|[A-Za-z]:[\\/])/u);
  assert.doesNotMatch(fixture, /import\s*\(\s*['"](?:\/|[A-Za-z]:[\\/])/u);
});

test('requires an explicit host package path and never selects a default host', () => {
  assert.throws(() => parseQualificationHostArgument([]), /--host-package/u);
  assert.throws(() => parseQualificationHostArgument(['--host-package', '']), /non-empty explicit path/u);
  assert.equal(
    parseQualificationHostArgument(['--host-package', './chosen-host']),
    './chosen-host',
  );
});

test('resolves the host public entry and its nested pi-ai by package resolution', async (t) => {
  const root = await makeTestRoot(t);
  const hostRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
  const piAiRoot = join(hostRoot, 'node_modules', '@earendil-works', 'pi-ai');
  await writeSyntheticPackage({
    root: hostRoot,
    name: HOST_NAME,
    dependencies: { [PI_AI_NAME]: '^0.86.0' },
  });
  await writeSyntheticPackage({ root: piAiRoot, name: PI_AI_NAME });

  const resolved = await resolveQualificationHost(join(hostRoot, 'lib', 'public-entry.mjs'));
  assert.equal(resolved.host.name, HOST_NAME);
  assert.equal(resolved.host.version, '0.86.0');
  assert.equal(resolved.host.entryPath, join(hostRoot, 'lib', 'public-entry.mjs'));
  assert.equal(resolved.piAi.name, PI_AI_NAME);
  assert.equal(resolved.piAi.manifestPath, join(piAiRoot, 'package.json'));
});

test('resolves a valid hoisted pi-ai dependency without assuming a nested layout', async (t) => {
  const root = await makeTestRoot(t);
  const modulesRoot = join(root, 'node_modules');
  const hostRoot = join(modulesRoot, '@earendil-works', 'pi-coding-agent');
  const piAiRoot = join(modulesRoot, '@earendil-works', 'pi-ai');
  await writeSyntheticPackage({
    root: hostRoot,
    name: HOST_NAME,
    entry: './output/host.mjs',
    dependencies: { [PI_AI_NAME]: '^0.86.0' },
  });
  await writeSyntheticPackage({
    root: piAiRoot,
    name: PI_AI_NAME,
    entry: './output/ai.mjs',
  });

  const resolved = await resolveQualificationHost(hostRoot);
  assert.equal(resolved.host.entryPath, join(hostRoot, 'output', 'host.mjs'));
  assert.equal(resolved.piAi.entryPath, join(piAiRoot, 'output', 'ai.mjs'));
});

test('refuses missing, malformed, wrong-package, and wrong-line hosts before loading APIs', async (t) => {
  const root = await makeTestRoot(t);
  await assert.rejects(
    resolveQualificationHost(join(root, 'missing-host')),
    /does not exist or is unreadable/u,
  );

  const malformedRoot = join(root, 'malformed');
  await mkdir(malformedRoot, { recursive: true });
  await writeFile(join(malformedRoot, 'package.json'), '{not-json\n', 'utf8');
  await assert.rejects(resolveQualificationHost(malformedRoot), /manifest is malformed/u);

  const wrongPackageRoot = join(root, 'wrong-package');
  await writeSyntheticPackage({
    root: wrongPackageRoot,
    name: '@example/not-pi',
    dependencies: { [PI_AI_NAME]: '^0.86.0' },
  });
  await assert.rejects(resolveQualificationHost(wrongPackageRoot), /package identity mismatch/u);

  const wrongVersionRoot = join(root, 'wrong-version');
  await writeSyntheticPackage({
    root: wrongVersionRoot,
    name: HOST_NAME,
    version: '0.84.0',
    dependencies: { [PI_AI_NAME]: '^0.84.0' },
  });
  await assert.rejects(resolveQualificationHost(wrongVersionRoot), /version line mismatch/u);

  const wrongPiAiHostRoot = join(root, 'wrong-pi-ai', 'node_modules', '@earendil-works', 'pi-coding-agent');
  const wrongPiAiRoot = join(wrongPiAiHostRoot, 'node_modules', '@earendil-works', 'pi-ai');
  await writeSyntheticPackage({
    root: wrongPiAiHostRoot,
    name: HOST_NAME,
    dependencies: { [PI_AI_NAME]: '^0.86.0' },
  });
  await writeSyntheticPackage({ root: wrongPiAiRoot, name: PI_AI_NAME, version: '0.84.0' });
  await assert.rejects(resolveQualificationHost(wrongPiAiHostRoot), /host pi-ai package version line mismatch/u);
});
