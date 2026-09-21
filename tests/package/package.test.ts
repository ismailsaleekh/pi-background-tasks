import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseJsonText } from '../../src/core/common.js';
import { startInstalledDependencyRegistry } from '../helpers/offline-npm-registry.js';
import { findFileUrlPathnameViolations } from '../helpers/typescript-source-guards.js';
import {
  FusionInvestigateParams,
  FusionReasonParams,
  FusionResearchParams,
  FusionValidateParams,
  prepareFusionInvestigateArguments,
  prepareFusionReasonArguments,
  prepareFusionResearchArguments,
  prepareFusionValidateArguments,
} from '../../src/fusion-extension.js';

// npm ships as npm.cmd on Windows, and spawnSync with shell:false does not
// consult PATHEXT, so spawning the bare name yields status null with no child.
// Resolving npm's own JavaScript entry and running it through the current Node
// executable avoids the shim without introducing shell:true, mirroring how
// production resolves the Pi bin.
function resolveNpmCli(): string {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot resolve npm-cli.js near ${process.execPath}`);
}

const npmCli = resolveNpmCli();

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type NpmIgnoreScriptsObservation = readonly [
  version: string,
  status: number | null,
  output: string,
  markers: readonly string[],
];

function requireSupportedNpmVersion(rawVersion: string): string {
  const version = rawVersion.trim();
  const match = /^(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version);
  assert.ok(
    match,
    `expected npm --version to report a semantic version, received ${JSON.stringify(rawVersion)}`,
  );
  const npmMajor = Number(match[1]);
  assert.ok(
    Number.isSafeInteger(npmMajor) && npmMajor >= 10,
    `expected npm >=10, received ${version}`,
  );
  return version;
}

function assertNpmIgnoreScriptsObservation(
  versionText: string,
  status: number | null,
  output: string,
  markers: readonly string[],
): void {
  const version = requireSupportedNpmVersion(versionText);
  if (status === 0 && markers.length === 0) return;

  const isKnownNpm1093PrepareDefect =
    version === '10.9.3' &&
    status === 1 &&
    output.includes('sentinel lifecycle executed: prepare') &&
    markers.length === 1 &&
    markers[0] === 'prepare';
  if (isKnownNpm1093PrepareDefect) return;

  assert.fail(
    `unexpected npm pack --ignore-scripts lifecycle observation for npm ${version}: ` +
      `status=${String(status)} markers=${JSON.stringify(markers)} output=${JSON.stringify(output)}`,
  );
}

function runNpm(
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): CommandResult {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runNpmAsync(
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (status) => {
      resolveResult({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

interface PackageJson {
  name: string;
  type: string;
  keywords: string[];
  pi: { extensions: string[]; image?: string | undefined };
  scripts: Record<string, string>;
  files: string[];
  peerDependencies: Record<string, string>;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
}

interface NpmPackFile {
  path: string;
}

interface NpmPackEntry {
  filename: string;
  files: NpmPackFile[];
}

interface SourceViolation {
  file: string;
  rule: string;
  excerpt: string;
}

const root = new URL('../../', import.meta.url);

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function field(value: object, key: string): unknown {
  const property: unknown = Reflect.get(value, key);
  return property;
}

function parseJsonValue(text: string): unknown {
  return parseJsonText(text);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(
    value.every((item) => typeof item === 'string'),
    `${label} must contain strings`,
  );
  return value;
}

function parsePackageJson(value: unknown): PackageJson {
  assert.ok(isObject(value), 'package.json must be an object');
  const name = requireString(field(value, 'name'), 'name');
  const type = requireString(field(value, 'type'), 'type');
  const pi = field(value, 'pi');
  const scripts = field(value, 'scripts');
  const peerDependencies = field(value, 'peerDependencies');
  assert.ok(isObject(pi));
  assert.ok(isObject(scripts));
  assert.ok(isObject(peerDependencies));
  return {
    name,
    type,
    keywords: requireStringArray(field(value, 'keywords'), 'keywords'),
    pi: {
      extensions: requireStringArray(field(pi, 'extensions'), 'pi.extensions'),
      image: typeof field(pi, 'image') === 'string' ? (field(pi, 'image') as string) : undefined,
    },
    scripts: Object.fromEntries(
      Object.entries(scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    files: requireStringArray(field(value, 'files'), 'files'),
    peerDependencies: Object.fromEntries(
      Object.entries(peerDependencies).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    dependencies: stringRecordField(value, 'dependencies'),
    devDependencies: stringRecordField(value, 'devDependencies'),
  };
}

function stringRecordField(value: object, key: string): Record<string, string> | undefined {
  const raw = field(value, key);
  if (raw === undefined) return undefined;
  assert.ok(isObject(raw), `${key} must be an object`);
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

async function pkg(): Promise<PackageJson> {
  return parsePackageJson(parseJsonValue(await readFile(new URL('package.json', root), 'utf8')));
}

async function text(file: string): Promise<string> {
  return readFile(new URL(file, root), 'utf8');
}

async function walkSourceTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkSourceTree(path)));
    else if (/\.ts$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function readMarkdownTree(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) parts.push(await readMarkdownTree(path));
    else if (entry.name.endsWith('.md')) parts.push(await readFile(path, 'utf8'));
  }
  return parts.join('\n');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function compactExcerpt(source: string): string {
  return source.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function isPathLikeParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'path' || lower === 'file' || lower.endsWith('path');
}

function isPathSyncHelperName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('write') || lower.startsWith('replace')) return false;
  if (
    lower === 'fsync' ||
    lower === 'sync' ||
    lower === 'fsyncfile' ||
    lower === 'fsyncpath' ||
    lower === 'syncfile' ||
    lower === 'syncpath'
  )
    return true;
  if (lower.includes('fsync') && (lower.includes('file') || lower.includes('path'))) return true;
  return lower.startsWith('sync') && (lower.includes('file') || lower.includes('path'));
}

function addPatternViolations(
  violations: SourceViolation[],
  file: string,
  rule: string,
  source: string,
  pattern: RegExp,
): void {
  for (const match of source.matchAll(pattern)) {
    violations.push({ file, rule, excerpt: compactExcerpt(match[0] ?? '') });
  }
}

function addExportedPathSyncViolations(
  violations: SourceViolation[],
  file: string,
  source: string,
): void {
  const exportedFunction =
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\b/g;
  for (const match of source.matchAll(exportedFunction)) {
    const name = match[1];
    const parameter = match[2];
    if (
      name !== undefined &&
      parameter !== undefined &&
      isPathSyncHelperName(name) &&
      isPathLikeParameter(parameter)
    ) {
      violations.push({
        file,
        rule: 'exported path sync helper',
        excerpt: compactExcerpt(match[0]),
      });
    }
  }

  const exportedConst =
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\b/g;
  for (const match of source.matchAll(exportedConst)) {
    const name = match[1];
    const parameter = match[2];
    if (
      name !== undefined &&
      parameter !== undefined &&
      isPathSyncHelperName(name) &&
      isPathLikeParameter(parameter)
    ) {
      violations.push({
        file,
        rule: 'exported path sync helper',
        excerpt: compactExcerpt(match[0]),
      });
    }
  }

  const exportedList = /\bexport\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(exportedList)) {
    const names = match[1];
    if (names !== undefined && names.split(',').some((name) => isPathSyncHelperName(name.trim()))) {
      violations.push({
        file,
        rule: 'exported path sync helper',
        excerpt: compactExcerpt(match[0]),
      });
    }
  }
}

function addSwallowedSyncViolations(
  violations: SourceViolation[],
  file: string,
  source: string,
): void {
  const syncTryCatch =
    /try\s*\{(?:(?!\}\s*catch)[\s\S])*?\.sync\s*\([^)]*\)[\s\S]*?\}\s*catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\}/g;
  for (const match of source.matchAll(syncTryCatch)) {
    const body = match[1] ?? '';
    const trimmed = body.trim();
    const recordsFailure =
      /failure\(\s*['"]sync_(?:file|directory)['"]/.test(body) || /throwDurable\b/.test(body);
    const throwsImmediately = /^throw\b/.test(trimmed);
    if (
      trimmed.length === 0 ||
      /\breturn\b/.test(body) ||
      (!recordsFailure && !throwsImmediately)
    ) {
      violations.push({ file, rule: 'silent sync catch', excerpt: compactExcerpt(match[0] ?? '') });
    }
  }
}

function formatSourceViolations(violations: readonly SourceViolation[]): string {
  return violations
    .map((violation) => `${violation.file} ${violation.rule}: ${violation.excerpt}`)
    .join('\n');
}

function makeIsolatedEnvRoot(prefix: string): string {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(rootDir, 'home'), { recursive: true });
  mkdirSync(join(rootDir, 'cache'), { recursive: true });
  mkdirSync(join(rootDir, 'config'), { recursive: true });
  mkdirSync(join(rootDir, 'tmp'), { recursive: true });
  writeFileSync(join(rootDir, 'config', 'user.npmrc'), '');
  writeFileSync(join(rootDir, 'config', 'global.npmrc'), '');
  return rootDir;
}

function makeIsolatedNpmProject(directory: string, name: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, private: true, version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(join(directory, '.npmrc'), '');
}

function removeIsolatedEnvRoot(rootDir: string): void {
  rmSync(rootDir, { recursive: true, force: true });
}

function isolatedNpmEnv(rootDir: string): NodeJS.ProcessEnv {
  const cache = join(rootDir, 'cache');
  const userConfig = join(rootDir, 'config', 'user.npmrc');
  const globalConfig = join(rootDir, 'config', 'global.npmrc');
  const registry = 'http://127.0.0.1.invalid/';
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: join(rootDir, 'home'),
    USERPROFILE: join(rootDir, 'home'),
    XDG_CONFIG_HOME: join(rootDir, 'config'),
    TMPDIR: join(rootDir, 'tmp'),
    TMP: join(rootDir, 'tmp'),
    TEMP: join(rootDir, 'tmp'),
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    NPM_CONFIG_USERCONFIG: userConfig,
    npm_config_userconfig: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    npm_config_globalconfig: globalConfig,
    NPM_CONFIG_REGISTRY: registry,
    npm_config_registry: registry,
    GIT_ALLOW_PROTOCOL: 'file',
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    CI: '1',
  };
}

function localRegistryNpmEnv(rootDir: string, registry: string): NodeJS.ProcessEnv {
  const env = isolatedNpmEnv(rootDir);
  env['NPM_CONFIG_REGISTRY'] = registry;
  env['npm_config_registry'] = registry;
  return env;
}

function hashReadOnlyTree(directory: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, relativePath: string): void => {
    const stat = lstatSync(path);
    const mode = stat.mode & 0o7777;
    if (stat.isSymbolicLink()) {
      hash.update(`link\0${relativePath}\0${String(mode)}\0${readlinkSync(path)}\0`);
      return;
    }
    if (stat.isFile()) {
      hash.update(`file\0${relativePath}\0${String(mode)}\0${String(stat.size)}\0`);
      hash.update(readFileSync(path));
      hash.update('\0');
      return;
    }
    assert.ok(stat.isDirectory(), `fixture source contains unsupported entry ${path}`);
    hash.update(`directory\0${relativePath}\0${String(mode)}\0`);
    for (const name of readdirSync(path).sort()) {
      visit(join(path, name), relativePath.length === 0 ? name : `${relativePath}/${name}`);
    }
  };
  visit(directory, '');
  return hash.digest('hex');
}

function parsePackEntries(stdout: string): NpmPackEntry[] {
  const trimmed = stdout.trim();
  const arrayStart = trimmed.startsWith('[') ? 0 : stdout.lastIndexOf('\n[') + 1;
  assert.ok(
    arrayStart > 0 || trimmed.startsWith('['),
    `npm pack output must end with a JSON array; received ${JSON.stringify(stdout.slice(0, 160))}`,
  );
  const parsed = parseJsonValue(arrayStart === 0 ? trimmed : stdout.slice(arrayStart).trim());
  assert.ok(Array.isArray(parsed), 'npm pack output must be an array');
  return parsed.map((entry): NpmPackEntry => {
    assert.ok(isObject(entry), 'pack entry must be an object');
    const filename = requireString(field(entry, 'filename'), 'pack filename');
    const files = field(entry, 'files');
    assert.ok(Array.isArray(files), 'pack entry files must be an array');
    return {
      filename,
      files: files.map((file): NpmPackFile => {
        assert.ok(isObject(file), 'pack file must be an object');
        const path = requireString(field(file, 'path'), 'pack file path');
        return { path };
      }),
    };
  });
}

void describe('package', () => {
  void it('manifest/docs cover public extension surfaces', async () => {
    const p = await pkg();
    assert.equal(p.name, 'pi-background-tasks');
    assert.equal(p.type, 'module');
    assert.ok(p.keywords.includes('pi-package'));
    assert.ok(p.keywords.includes('pi-extension'));
    assert.deepEqual(p.pi.extensions, [
      './dist/extensions/anthropic-attribution.js',
      './dist/extensions/background-tasks.js',
    ]);
    assert.equal(
      p.pi.image,
      'https://raw.githubusercontent.com/ismailsaleekh/pi-background-tasks/main/logo.png',
    );
    assert.match(p.scripts['test:agent-loop'] ?? '', /scripted-provider/);
    assert.match(p.scripts['test:full'] ?? '', /test:agent-loop/);
    assert.match(p.scripts['test:compat'] ?? '', /test-compat/);
    assert.match(p.scripts['test:pnpm-pack'] ?? '', /test-pnpm-pack-install/);
    assert.ok(p.files.includes('dist/'));
    assert.ok(p.files.includes('extensions/'));
    assert.ok(p.files.includes('src/'));
    assert.ok(p.files.includes('docs/'));
    assert.ok(p.files.includes('BACKGROUND-TASKS-INSTRUCTIONS.md'));
    assert.ok(p.files.includes('THIRD_PARTY_NOTICES.md'));
    assert.ok(p.files.includes('logo.png'));
    assert.ok(!p.files.includes('scripts/'));
    assert.equal(p.scripts['build:runtime'], 'node scripts/build-runtime.mjs');
    assert.equal(p.scripts['docs:generate'], 'node scripts/docs/generate.mjs');
    assert.equal(p.scripts['docs:verify'], 'node scripts/docs/verify.mjs');
    assert.match(p.scripts['prepack'] ?? '', /build:runtime/);
    assert.match(p.scripts['prepack'] ?? '', /docs:verify/);
    assert.match(p.scripts['prepack'] ?? '', /check-package-payload/);
    assert.equal(p.peerDependencies['@earendil-works/pi-ai'], '*');
    assert.ok(p.peerDependencies['@earendil-works/pi-coding-agent']);
    assert.ok(p.peerDependencies['@earendil-works/pi-tui']);
    assert.ok(p.peerDependencies['typebox']);
    for (const f of [
      'README.md',
      'BACKGROUND-TASKS-INSTRUCTIONS.md',
      'logo.png',
      'TESTING.md',
      'TEST_PLAN.md',
      'PUBLISHING.md',
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'src/extension.ts',
      'src/ui/background-tasks-manager.ts',
      'src/ui/fusion-model-selector.ts',
      'src/core/common.ts',
      'src/core/registry.ts',
      'src/core/extension-api.ts',
      'src/core/attested-pi-contract.ts',
      'src/core/attested-pi-run.ts',
      'src/core/canonical-json.ts',
      'src/core/task-durable.ts',
      'src/core/anthropic-attribution.ts',
      'src/core/anthropic-attribution-path.ts',
      'src/core/config.ts',
      'src/core/pi-launch.ts',
      'src/core/fusion/orchestrator.ts',
      'src/core/fusion/pi-child.ts',
      'src/core/fusion/child-protocol.ts',
      'src/core/fusion/budget.ts',
      'src/core/fusion/output-contract.ts',
      'src/core/fusion/workflows.ts',
      'src/core/fusion/result-package.ts',
      'src/fusion-extension.ts',
      'src/fusion-child-extension.ts',
      'src/core/context/visible-conversation-v2.ts',
      'src/core/context/parent-snapshot.ts',
      'src/core/context/token-budget.ts',
      'src/core/delegate/types.ts',
      'src/core/delegate/seed.ts',
      'src/core/delegate/budget.ts',
      'src/core/delegate/launch.ts',
      'src/core/delegate/runner.ts',
      'src/core/delegate/artifacts.ts',
      'src/core/delegate/result-package.ts',
      'src/core/delegate/hook-contract.ts',
      'src/core/delegate/hook-contract-evidence.json',
      'src/delegate-extension.ts',
      'src/delegate-child-extension.ts',
      'extensions/anthropic-attribution-child.ts',
      'extensions/anthropic-attribution.ts',
      'extensions/background-tasks.ts',
      'extensions/fusion-child.ts',
      'extensions/delegate-child.ts',
      'dist/extensions/anthropic-attribution.js',
      'dist/extensions/background-tasks.js',
      'dist/extensions/anthropic-attribution-child.js',
      'dist/extensions/delegate-child.js',
      'dist/extensions/fusion-child.js',
      'dist/src/core/delegate/hook-contract-evidence.json',
      'dist/package.json',
    ])
      assert.ok(existsSync(new URL(f, root)), f);

    const extensionSource = await text('src/extension.ts');
    assert.match(
      extensionSource,
      /if \(config\.features\.fusion\) \{[\s\S]*?registerFusionExtension\(pi, \{/,
    );
    assert.match(
      extensionSource,
      /if \(config\.features\.delegate\) \{[\s\S]*?registerDelegateExtension\(pi, \{/,
    );
    assert.match(
      extensionSource,
      /if \(config\.features\.delegate \|\| config\.features\.fusion\) \{[\s\S]*?registerBackgroundResultExtension\(pi, \{/,
    );
    assert.match(p.scripts['test:hook-contract'] ?? '', /pi-hook-contract/);
    assert.match(
      p.scripts['test'] ?? '',
      /test:hook-contract/,
      'the default gate must include the Pi hook characterisation gate',
    );
    const readme = await text('README.md');
    const documentationInventory = `${readme}\n${await readMarkdownTree(fileURLToPath(new URL('docs/', root)))}`;
    const plan = await text('TEST_PLAN.md');
    for (const surface of [
      '/bg',
      '/jobs',
      '/logs',
      '/kill',
      '/tasks',
      '/bg-tasks',
      '/bg-clear',
      '/bg-update',
      '/claude-cache',
      'bg_run',
      'bg_delegate',
      'extensionMode',
      'bg_result',
      'bg_run_pi_attested',
      'bg_status',
      'bg_logs',
      'bg_kill',
      'pi-background-tasks:request:v1',
      'pi-background-tasks:response:v1',
      'pi-background-tasks:terminal:v1',
      '/fusion',
      '/fusion-models',
      'fusion_reason',
      'fusion_investigate',
      'fusion_research',
      'fusion_validate',
      'fusion-result',
      'fusion-models.json',
      '.pi/fusion',
      'context-omission-ledger.json',
      'budget-plan.json',
      'fusion-input.v5',
      'prompt_budget_exceeded_forecast',
      'prompt_budget_exceeded_measured',
    ]) {
      assert.match(
        documentationInventory,
        new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `README/generated docs inventory missing ${surface}`,
      );
      assert.match(
        plan,
        new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `TEST_PLAN missing ${surface}`,
      );
    }
    const eventBusDocs = await text('docs/api/eventbus-v1.md');
    assert.match(eventBusDocs, /src\/core\/extension-api\.ts/);
    const shortcutDocs = await text('docs/reference/shortcuts-and-dock.md');
    assert.match(shortcutDocs, /Shift\+Down/);
    assert.match(shortcutDocs, /Ctrl\+Alt\+C/);
  });

  void it('validates Fusion v1 public tool arguments loudly', () => {
    assert.deepEqual(prepareFusionReasonArguments({ prompt: ' hello ' }), { prompt: 'hello' });
    assert.throws(
      () => prepareFusionReasonArguments({ prompt: 'hello', capability: 'reason' }),
      /unsupported key\(s\): capability/,
    );

    assert.deepEqual(
      prepareFusionInvestigateArguments({
        objective: ' find risk ',
        background: [' repo changed '],
        deliverable: ' report ',
      }),
      {
        objective: 'find risk',
        background: ['repo changed'],
        deliverable: 'report',
        scope: [],
        constraints: [],
      },
    );

    assert.deepEqual(
      prepareFusionResearchArguments({
        objective: ' compare docs ',
        background: ['need citations'],
        deliverable: 'answer',
        sources: [{ url: 'HTTPS://Example.COM/a#frag', purpose: 'official docs' }],
      }),
      {
        objective: 'compare docs',
        background: ['need citations'],
        deliverable: 'answer',
        scope: [],
        constraints: [],
        sources: [{ url: 'https://example.com/a', purpose: 'official docs' }],
      },
    );
    assert.throws(
      () =>
        prepareFusionResearchArguments({
          objective: 'x',
          background: [],
          deliverable: 'x',
          sources: [
            { url: 'https://example.com/a#one', purpose: 'one' },
            { url: 'https://example.com/a#two', purpose: 'two' },
          ],
        }),
      /duplicates canonical URL/,
    );
    assert.throws(
      () =>
        prepareFusionResearchArguments({
          objective: 'x',
          background: [],
          deliverable: 'x',
          sources: [{ url: 'https://token@example.com/', purpose: 'bad' }],
        }),
      /credentials/,
    );
    assert.throws(
      () =>
        prepareFusionResearchArguments({
          objective: 'x',
          background: [],
          deliverable: 'x',
          sources: [{ url: 'http://127.0.0.1/', purpose: 'bad' }],
        }),
      /private|reserved|localhost/,
    );
    assert.throws(
      () =>
        prepareFusionResearchArguments({
          objective: 'x',
          background: [],
          deliverable: 'x',
          sources: [{ url: 'http://[::ffff:127.0.0.1]/', purpose: 'bad' }],
        }),
      /private|reserved/,
    );
    assert.throws(
      () =>
        prepareFusionResearchArguments({
          objective: 'x',
          background: [],
          deliverable: 'x',
          sources: [
            { url: 'https://example.com/a', purpose: 'one' },
            { url: 'https://example.com./a', purpose: 'two' },
          ],
        }),
      /duplicates canonical URL/,
    );

    for (const schema of [
      FusionReasonParams,
      FusionInvestigateParams,
      FusionResearchParams,
      FusionValidateParams,
    ]) {
      assert.equal(Reflect.get(schema, 'additionalProperties'), false);
    }
    const investigateProperties = Reflect.get(FusionInvestigateParams, 'properties');
    assert.equal(
      Reflect.get(Reflect.get(investigateProperties, 'scope'), 'additionalProperties'),
      undefined,
    );
    const researchProperties = Reflect.get(FusionResearchParams, 'properties');
    assert.equal(Reflect.get(Reflect.get(researchProperties, 'sources'), 'minItems'), 1);
    const verification = Reflect.get(
      Reflect.get(FusionValidateParams, 'properties'),
      'verification',
    );
    assert.equal(Reflect.get(verification, 'additionalProperties'), false);
    const status = Reflect.get(Reflect.get(verification, 'properties'), 'status');
    assert.deepEqual(Reflect.get(status, 'enum'), ['provided', 'not_run']);
  });

  void it('Fusion candidate tool policy cannot be weakened', async () => {
    const types = await text('src/core/fusion/types.ts');
    // The read-only allowlist is exactly Pi's read-only built-in subset. Any addition
    // here grants fusion children a new capability and must be a deliberate, reviewed
    // change - not an incidental edit.
    assert.match(
      types,
      /FUSION_INSPECT_TOOLS\s*=\s*Object\.freeze\(\[\s*'read',\s*'grep',\s*'find',\s*'ls',?\s*\]/,
      'fusion inspect allowlist must remain exactly read, grep, find, ls',
    );
    // Every tool that would grant shell access, mutation, recursion, or background
    // spawning must stay denied. Removing even one entry is a security regression.
    for (const forbidden of [
      'bash',
      'edit',
      'write',
      'fusion_brainstorm',
      'fusion_reason',
      'fusion_investigate',
      'fusion_research',
      'fusion_validate',
      'bg_delegate',
      'bg_result',
      'bg_run',
      'bg_kill',
      'bg_status',
      'bg_logs',
      'bg_run_pi_attested',
    ]) {
      assert.match(
        types,
        new RegExp(`FUSION_FORBIDDEN_TOOLS[\\s\\S]*?'${forbidden}'[\\s\\S]*?\\]`),
        `FUSION_FORBIDDEN_TOOLS must continue to deny ${forbidden}`,
      );
    }
    assert.match(
      types,
      /FUSION_PUBLIC_WORKFLOW_NAMES\s*=\s*Object\.freeze\(\[\s*'fusion_reason',\s*'fusion_investigate',\s*'fusion_research',\s*'fusion_validate',?\s*\]/,
      'public Fusion workflow names must remain the four fixed v1 tools',
    );
    assert.match(
      types,
      /FUSION_WEB_FETCH_TOOL_NAME\s*=\s*'fusion_web_fetch'/,
      'fusion_web_fetch must be the package-owned research tool name',
    );
    assert.match(
      types,
      /FUSION_NO_TOOLS_CAPABILITY:\s*FusionCapability\s*=\s*'reason'/,
      'fusion no-tools stage policy must remain reason',
    );
  });

  void it('Fusion research web fetch registers only in research mode', async () => {
    const childExtension = await text('src/fusion-child-extension.ts');
    const registration = childExtension.indexOf('pi.registerTool<typeof FusionWebFetchParams');
    assert.ok(registration > 0, 'fusion_web_fetch registration must exist');
    const prefix = childExtension.slice(Math.max(0, registration - 500), registration);
    assert.match(
      prefix,
      /if \(researchEnabled === '1'\) \{[\s\S]*$/,
      'fusion_web_fetch registration must be guarded by the research env flag',
    );
    assert.doesNotMatch(
      childExtension.slice(0, registration),
      /pi\.registerTool<typeof FusionWebFetchParams/,
      'fusion_web_fetch must not be registered before the research guard',
    );
  });

  void it('Fusion evaluator and merger can never receive caller-selected tools', async () => {
    const orchestrator = await text('src/core/fusion/orchestrator.ts');
    // Stage policy, not caller input. The evaluation and merge child launches must pass
    // the hardcoded no-tools capability; the caller-supplied capability must never
    // appear in runEvaluationAttempt() or the merge launch. Assert on the launch regions
    // rather than a global occurrence count, so legitimate uses (manifest record, budget
    // forecast, candidate launch) can grow without silently disabling this guard.
    const evaluationRegion = orchestrator.slice(
      orchestrator.indexOf('private async runEvaluationAttempt('),
    );
    assert.ok(evaluationRegion.length > 0, 'runEvaluationAttempt must exist');
    assert.doesNotMatch(
      evaluationRegion.slice(0, 2000),
      /input\.candidateCapability/,
      'the evaluation stage must never receive the caller-selected capability',
    );
    assert.match(
      orchestrator,
      /evaluation:\s*FUSION_NO_TOOLS_CAPABILITY,[\s\S]*?merge:\s*FUSION_NO_TOOLS_CAPABILITY/,
      'manifest capabilities must keep evaluator and merger no-tools',
    );
    // Both non-candidate launch sites annotate the invariant and pass the no-tools constant.
    const stagePolicyComments = orchestrator.match(/Stage policy, not caller input/g) ?? [];
    assert.equal(
      stagePolicyComments.length,
      2,
      'evaluation and merge launches must each document the stage-policy invariant',
    );
  });

  void it('Fusion golden byte gate has no fixture generation path', async () => {
    const goldenTest = await text('tests/unit/fusion-golden-bytes.test.ts');
    assert.doesNotMatch(
      goldenTest,
      /writeFile/,
      'fusion golden byte gate must not auto-generate committed fixtures',
    );
    for (const fixture of [
      'tests/fixtures/fusion-golden-bytes.json',
      'tests/fixtures/fusion-validate-golden-bytes.json',
    ]) {
      assert.ok(existsSync(new URL(fixture, root)), `${fixture} must be committed`);
    }
  });

  void it('validates fusion_validate verification contracts and legacy migration loudly', async () => {
    assert.deepEqual(
      prepareFusionValidateArguments({
        objective: 'ship v1',
        background: ['changed fusion facade'],
        changeSummary: 'renamed public tools',
        scope: ['src/fusion-extension.ts'],
        acceptanceCriteria: ['four tools only'],
        verification: { status: 'provided', evidence: [{ check: 'typecheck', outcome: 'passed' }] },
      }),
      {
        objective: 'ship v1',
        background: ['changed fusion facade'],
        changeSummary: 'renamed public tools',
        scope: ['src/fusion-extension.ts'],
        acceptanceCriteria: ['four tools only'],
        verification: { status: 'provided', evidence: [{ check: 'typecheck', outcome: 'passed' }] },
        knownLimitations: [],
        exclusions: [],
      },
    );
    assert.deepEqual(
      prepareFusionValidateArguments({
        objective: 'ship v1',
        background: [],
        changeSummary: 'renamed public tools',
        scope: ['src/fusion-extension.ts'],
        acceptanceCriteria: ['four tools only'],
        verification: { status: 'not_run', reason: 'core branch unavailable' },
      }).verification,
      { status: 'not_run', evidence: [], reason: 'core branch unavailable' },
    );
    assert.throws(
      () => prepareFusionValidateArguments({ prompt: '  review it  ' }),
      /no longer accepts \{prompt\}/,
    );
    assert.throws(
      () =>
        prepareFusionValidateArguments({
          objective: 'x',
          background: [],
          changeSummary: 'x',
          scope: ['x'],
          acceptanceCriteria: ['x'],
          verification: { status: 'provided' },
        }),
      /requires non-empty evidence/,
    );
    assert.throws(
      () =>
        prepareFusionValidateArguments({
          objective: 'x',
          background: [],
          changeSummary: 'x',
          scope: ['x'],
          acceptanceCriteria: ['x'],
          verification: {
            status: 'not_run',
            evidence: [{ check: 'x', outcome: 'x' }],
            reason: 'x',
          },
        }),
      /must not include evidence/,
    );
    assert.throws(
      () =>
        prepareFusionValidateArguments({
          objective: 'x',
          background: [],
          changeSummary: 'x',
          scope: [],
          acceptanceCriteria: ['x'],
          verification: { status: 'not_run', reason: 'x' },
        }),
      /scope must not be empty/,
    );

    const extension = await text('src/fusion-extension.ts');
    assert.match(extension, /FUSION_REASON_TOOL_NAME = 'fusion_reason'/);
    assert.match(extension, /FUSION_INVESTIGATE_TOOL_NAME = 'fusion_investigate'/);
    assert.match(extension, /FUSION_RESEARCH_TOOL_NAME = 'fusion_research'/);
    assert.match(
      extension,
      /RETIRED_FUSION_TOOL_NAMES = new Set<string>\(\['fusion_brainstorm'\]\)/,
    );
  });

  void it('ships global package-owned Anthropic attribution with no exotic dependency', async () => {
    const p = await pkg();
    assert.equal(p.peerDependencies['@earendil-works/pi-ai'], '*');
    assert.equal(
      p.dependencies?.['@earendil-works/pi-ai'],
      undefined,
      'Pi AI must resolve through the host loader rather than a private runtime copy',
    );
    assert.equal(p.dependencies?.['@ravshansbox/pi-anthropic-sps'], undefined);
    for (const [name, specifier] of Object.entries(p.dependencies ?? {})) {
      assert.doesNotMatch(
        specifier,
        /^(?:https?:|git(?:\+|:)|github:|file:)/,
        `production dependency ${name} must use a registry version`,
      );
    }
    const attribution = await text('src/core/anthropic-attribution.ts');
    assert.match(attribution, /X-Claude-Code-Session-Id/);
    assert.match(attribution, /prompt-caching-scope-2026-01-05/);
    assert.match(attribution, /cacheWrite1h/);
    assert.match(attribution, /CLAUDE_CODE_200K_SUBSCRIPTION_CONTEXT_WINDOW/);
    assert.match(attribution, /environment variables \(docs\/environment-variables\.md\)/);
    assert.match(attribution, /ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL/);

    const [compiledCore, compiledAmbientGateway, compiledChildGateway] = await Promise.all([
      text('dist/src/core/anthropic-attribution.js'),
      text('dist/extensions/anthropic-attribution.js'),
      text('dist/extensions/anthropic-attribution-child.js'),
    ]);
    const runtimePiAiImport =
      /from ['"]@earendil-works\/pi-ai(?:\/compat)?['"]/u;
    assert.doesNotMatch(
      compiledCore,
      runtimePiAiImport,
      'the lazy native-import target must not resolve a private Pi AI package',
    );
    assert.match(compiledAmbientGateway, runtimePiAiImport);
    assert.match(compiledChildGateway, runtimePiAiImport);
    assert.match(compiledAmbientGateway, /hostAnthropicMessagesApi: anthropicMessagesApi/u);
    assert.match(compiledChildGateway, /hostAnthropicMessagesApi: anthropicMessagesApi/u);

    const child = await text('src/core/fusion/pi-child.ts');
    assert.match(child, /FUSION_SANITIZED_PROVIDER\s*=\s*'anthropic'/);
    assert.doesNotMatch(child, /pi-anthropic-sps/);
    assert.match(child, /resolveAnthropicAttributionExtensionPath/);
    assert.match(child, /return \[resolveAttribution\(\), childExtensionPath\]/);
    assert.match(
      child,
      /model\.provider !== FUSION_SANITIZED_PROVIDER/,
      'attribution must be provider-gated so other routes keep identical argv',
    );
  });

  void it('keeps Fusion Claude cache normalization before final-payload governance', async () => {
    const cache = await text('src/core/fusion/claude-cache.ts');
    assert.match(cache, /FUSION_CLAUDE_CACHE_DEFAULT_RETENTION\s*=\s*'long'/);
    assert.match(cache, /PI_CACHE_RETENTION/);
    assert.match(cache, /FUSION_CLAUDE_CACHE_BREAKPOINT_LIMIT\s*=\s*4/);
    assert.match(cache, /upstream call-level opt-out/);
    assert.match(cache, /prompt-caching-scope-2026-01-05/);

    const childRunner = await text('src/core/fusion/pi-child.ts');
    assert.match(childRunner, /out\[FUSION_CLAUDE_CACHE_RETENTION_ENV\] = 'long'/);
    const childExtension = await text('src/fusion-child-extension.ts');
    const normalizeAt = childExtension.indexOf('normalizeFusionClaudeCachePayload({');
    const governAt = childExtension.indexOf('prepareFusionRuntimeRequest({', normalizeAt);
    assert.ok(normalizeAt >= 0, 'Claude cache policy must normalize final provider payloads');
    assert.ok(governAt > normalizeAt, 'runtime governor must measure the cache-normalized payload');
    assert.match(childExtension, /model\?\.provider === 'anthropic'/);
    const protocol = await text('src/core/fusion/child-protocol.ts');
    assert.match(protocol, /cache_observation/);
    assert.match(protocol, /cacheWrite1h/);
    assert.match(protocol, /reasoning/);
  });

  void it('ships the markdown extractor as a real dependency without startup import', async () => {
    const p = await pkg();
    assert.equal(
      p.dependencies?.['turndown'],
      '7.2.4',
      'the production markdown extractor dependency must be installed for package users',
    );
    assert.equal(
      p.devDependencies?.['turndown'],
      undefined,
      'runtime markdown extraction must not be hidden in devDependencies',
    );
    const fetchSource = await text('src/core/fusion/web-fetch.ts');
    assert.doesNotMatch(
      fetchSource,
      /import\s+TurndownService\s+from\s+['"]turndown['"]/,
      'turndown must load lazily so a damaged package install does not block Pi startup',
    );
    assert.match(fetchSource, /import\('turndown'\)/);
    const childLauncher = await text('src/core/fusion/pi-child.ts');
    assert.doesNotMatch(childLauncher, /fusion-child-extension/);
    assert.match(childLauncher, /child-protocol/);
  });

  void it('Fusion validate cannot recurse through each child tool policy', async () => {
    const types = await text('src/core/fusion/types.ts');
    const delegateLaunch = await text('src/core/delegate/launch.ts');
    for (const source of [types, delegateLaunch]) {
      assert.match(
        source,
        /'fusion_validate'/,
        'fusion_validate must be denied to every tool-enabled child',
      );
    }
  });

  void it('Fusion facade exposes four fixed-purpose tools and no public capability mode', async () => {
    const extension = await text('src/fusion-extension.ts');
    const registeredNames = [
      ...extension.matchAll(/registerTool\(\{\s*name:\s*(FUSION_[A-Z_]+_TOOL_NAME)/g),
    ].map((match) => match[1]);
    assert.deepEqual(registeredNames, [
      'FUSION_REASON_TOOL_NAME',
      'FUSION_INVESTIGATE_TOOL_NAME',
      'FUSION_RESEARCH_TOOL_NAME',
      'FUSION_VALIDATE_TOOL_NAME',
    ]);
    assert.doesNotMatch(extension, /registerTool[\s\S]*?name:\s*['"]fusion_brainstorm['"]/);
    assert.match(extension, /CURRENT_FUSION_TOOL_NAMES = Object\.freeze\(\[/);
    assert.match(
      extension,
      /pi\.setActiveTools\(next\)/,
      'session_start must rewrite stale active tools deterministically',
    );
    assert.match(extension, /no capability argument/);
    assert.match(extension, /targeted fetches of supplied URLs only/);
    assert.match(extension, /no longer accepts \{prompt\}/);
    const legacyBypass = `${'PI_BG_ALLOW'}_LEGACY_FUSION_CORE_FOR_TESTS`;
    assert.doesNotMatch(extension, new RegExp(legacyBypass));
    assert.doesNotMatch(extension, /legacy canonical input outside tests/);
    assert.doesNotMatch(extension, /core fusion workflow export \$\{primaryName\} is missing/);
  });

  void it('fusion production code avoids direct completion APIs and local adapters', async () => {
    const fusionFiles = [
      'src/fusion-extension.ts',
      'src/core/fusion/config.ts',
      'src/core/fusion/context.ts',
      'src/core/fusion/prompts.ts',
      'src/core/fusion/evaluation.ts',
      'src/core/fusion/pi-child.ts',
      'src/core/fusion/child-protocol.ts',
      'src/core/fusion/artifacts.ts',
      'src/core/fusion/orchestrator.ts',
      'src/core/fusion/budget.ts',
      'src/core/fusion/output-contract.ts',
      'src/core/fusion/web-fetch.ts',
      'src/ui/fusion-model-selector.ts',
      'src/fusion-child-extension.ts',
      'extensions/background-tasks.ts',
      'extensions/fusion-child.ts',
    ];
    for (const file of fusionFiles) {
      const source = await text(file);
      assert.doesNotMatch(source, /@earendil-works\/pi-ai\/compat/);
      assert.doesNotMatch(
        source,
        /import\s*\{[^}]*\b(?:complete|stream|streamSimple)\b[^}]*}\s*from\s*['"]@earendil-works\/pi-ai/,
      );
      assert.doesNotMatch(source, /\.pi\/extensions/);
      assert.doesNotMatch(source, /ai-pipeline/);
    }
    const child = await text('src/core/fusion/pi-child.ts');
    for (const flag of [
      '--no-tools',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-session',
    ])
      assert.match(child, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  void it('BUG-182 keeps Fusion usage on the exact host contract across shipped producers and consumers', async () => {
    const files = [
      'src/fusion-child-extension.ts',
      'src/fusion-extension.ts',
      'src/core/fusion/types.ts',
      'src/core/fusion/pi-child.ts',
      'src/core/fusion/child-protocol.ts',
      'src/core/fusion/orchestrator.ts',
      'src/core/fusion/artifacts.ts',
      'src/core/fusion/result-package.ts',
      'src/delegate-extension.ts',
    ];
    for (const file of files) {
      const source = await text(file);
      assert.doesNotMatch(source, /costTotal/, `${file} must not carry the retired cost shape`);
    }
    const childProtocol = await text('src/core/fusion/child-protocol.ts');
    assert.match(childProtocol, /fusion-child-result\.v4/);
    assert.match(childProtocol, /fusion-child-settlement\.v3/);
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
      assert.match(childProtocol, new RegExp(`cost\\.${key}`));
    }
    const types = await text('src/core/fusion/types.ts');
    assert.match(types, /fusion-result\.v4/);
    assert.match(types, /fusion-manifest\.v3/);
    assert.match(types, /export type FusionUsage = Usage/);
    const extension = await text('src/fusion-extension.ts');
    assert.match(extension, /usageDelivered: false/);
    assert.match(extension, /resultDetails: result\.details/);
    const resultExtension = await text('src/delegate-extension.ts');
    assert.match(resultExtension, /claimFusionUsage/);
    assert.match(resultExtension, /const usage = cloneFusionUsage\(verified\.details\.usage\)/);
    assert.match(resultExtension, /resultWithUsage:[\s\S]*?usage,/);
  });

  void it('keeps background Fusion retrieval durable, verified, and once-accounted', async () => {
    const artifacts = await text('src/core/fusion/artifacts.ts');
    const resultPackage = await text('src/core/fusion/result-package.ts');
    const resultExtension = await text('src/delegate-extension.ts');
    const registry = await text('src/core/registry.ts');
    const fusionFacade = await text('src/fusion-extension.ts');
    assert.match(artifacts, /manifest\.artifacts\['result\.json'\]/);
    assert.match(artifacts, /writeCommittedResult/);
    assert.match(artifacts, /async writeFailureSummary/);
    assert.match(artifacts, /failure summary is already bound in the manifest/);
    assert.match(resultPackage, /FUSION_FAILURE_SUMMARY_MAX_BYTES/);
    assert.match(resultPackage, /failure evidence ref diverges from manifest/);
    assert.match(resultPackage, /failure summary exceeds its bounded artifact size/);
    assert.match(resultPackage, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
    assert.doesNotMatch(resultPackage, /readUtf8\([^\n]*response\.(?:md|txt)/);
    assert.match(resultPackage, /sha256Buffer\(resultFile\.bytes\)/);
    assert.match(resultPackage, /sha256Buffer\(mergedFile\.bytes\)/);
    assert.match(resultPackage, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
    assert.doesNotMatch(resultPackage, /\.slice\(|\.substring\(/);
    assert.match(resultExtension, /loaded\.readFusionFailureResult/);
    assert.match(resultExtension, /delivery: 'none'/);
    assert.match(resultExtension, /loaded\.readFusionCommittedResult/);
    assert.match(resultExtension, /await deps\.claimFusionUsage\(task\)/);
    const orchestrator = await text('src/core/fusion/orchestrator.ts');
    assert.ok(
      orchestrator.indexOf('await store.writeError') <
        orchestrator.indexOf('await store.writeFailureSummary'),
      'terminal error publication must precede the one summary attempt',
    );
    assert.equal(
      (orchestrator.match(/await store\.writeFailureSummary/g) ?? []).length,
      1,
      'summary persistence must have exactly one orchestrator call site',
    );
    assert.ok(
      resultExtension.indexOf('loaded.readFusionFailureResult') <
        resultExtension.indexOf('await deps.claimFusionUsage(task)'),
      'failed retrieval must return before committed-result usage can be claimed',
    );
    assert.ok(
      resultExtension.indexOf('loaded.readFusionCommittedResult') <
        resultExtension.indexOf('await deps.claimFusionUsage(task)'),
      'verification must finish before the once-only usage claim',
    );
    assert.ok(
      resultExtension.indexOf('const usage = cloneFusionUsage(verified.details.usage)') <
        resultExtension.indexOf('await deps.claimFusionUsage(task)'),
      'usage cloning must finish before the durable claim settlement point',
    );
    assert.match(registry, /async claimFusionUsage/);
    assert.match(
      fusionFacade,
      /The workflow passed durable preflight and no longer blocks this tool call/,
    );
    assert.match(fusionFacade, /onReady/);
  });

  void it('BUG-185 keeps post-launch Fusion guards free of token/output reservation admission', async () => {
    const child = await text('src/fusion-child-extension.ts');
    const protocol = await text('src/core/fusion/child-protocol.ts');
    const parent = await text('src/core/fusion/pi-child.ts');
    const types = await text('src/core/fusion/types.ts');

    assert.doesNotMatch(
      child,
      /estimateInputTokens|knownJsonSegment|resolveTokenBudgetFamily|contextWindowTokens|maxOutputTokens|provider_request_budget|estimated_input_tokens|allowed_input_tokens|reserved_output_tokens|safety_reserve_tokens/,
    );
    assert.doesNotMatch(
      protocol,
      /provider_request_budget|estimated_input_tokens|allowed_input_tokens|reserved_output_tokens|safety_reserve_tokens|FUSION_CHILD_MIN_OUTPUT_RESERVE_TOKENS|FUSION_CHILD_SAFETY_RESERVE_TOKENS/,
    );
    assert.doesNotMatch(parent, /child_runtime_budget_exceeded|allowed-input arithmetic/);
    assert.match(protocol, /pi-background-tasks\.fusion-runtime-guard\.v2/);
    assert.match(types, /child_runtime_limit_exceeded/);
    assert.match(types, /child_runtime_payload_invalid/);
  });

  void it('keeps expanded Fusion execution limits enforced at child and parent boundaries', async () => {
    const child = await text('src/fusion-child-extension.ts');
    const protocol = await text('src/core/fusion/child-protocol.ts');
    const parent = await text('src/core/fusion/pi-child.ts');
    const fetcher = await text('src/core/fusion/web-fetch.ts');

    assert.match(protocol, /FUSION_CHILD_MAX_PROVIDER_REQUESTS = 550/);
    assert.match(protocol, /FUSION_CHILD_MAX_TOOL_CALLS = 600/);
    assert.match(protocol, /FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES = 32 \* 1024 \* 1024/);
    assert.match(child, /input\.toolCallCount <= FUSION_CHILD_MAX_TOOL_CALLS/);
    assert.match(child, /totalToolResultBytes > FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES/);
    assert.match(parent, /recordCount > FUSION_CHILD_MAX_TOOL_CALLS/);
    assert.match(parent, /totalResultBytes > FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES/);
    assert.match(fetcher, /Promise\.race\(\[extraction, timeout\]\)/);
    assert.match(fetcher, /assertFetchDeadline\(options, deadlineMs, url, 'content extraction'\)/);
  });

  void it('keeps the Fusion context/budget path free of silent truncation and fallback shapes', async () => {
    const context = await text('src/core/fusion/context.ts');
    const budget = await text('src/core/fusion/budget.ts');
    const outputContract = await text('src/core/fusion/output-contract.ts');
    const orchestratorText = await text('src/core/fusion/orchestrator.ts');
    const orchestratorSource = () => orchestratorText;
    // The projection transform and the size arithmetic are shared with
    // bg_delegate, so the guard follows the real implementation instead of only
    // the Fusion facade. Scanning the facade alone would let a truncation or
    // fallback shape be reintroduced one module away and go unnoticed.
    const transform = await text('src/core/context/visible-conversation-v2.ts');
    const parentSnapshot = await text('src/core/context/parent-snapshot.ts');
    const tokenBudget = await text('src/core/context/token-budget.ts');
    const delegateChild = await text('src/delegate-child-extension.ts');

    // No clipping of retained conversational text. Scan code only: comments
    // legitimately discuss truncation in order to forbid it.
    const codeOnly = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
    for (const [label, source] of [
      ['context', codeOnly(context)],
      ['budget', codeOnly(budget)],
      ['output-contract', codeOnly(outputContract)],
      ['visible-conversation-v2', codeOnly(transform)],
      ['parent-snapshot', codeOnly(parentSnapshot)],
      ['token-budget', codeOnly(tokenBudget)],
    ] as const) {
      assert.doesNotMatch(source, /\.slice\(/, `${label} must not clip retained content`);
      assert.doesNotMatch(source, /\.substring\(/, `${label} must not clip retained content`);
      assert.doesNotMatch(source, /\.trim\(\)\.slice/, `${label} must not clip retained content`);
      assert.doesNotMatch(source, /catch\s*\{\s*\}/, `${label} must not swallow errors`);
    }

    // The projection must never carry a payload preview, however it is spelled.
    assert.match(context, /tool_payload_preview_bytes: 0/);

    // Budget rejection must be a loud typed error, never a clamp or a downgrade.
    assert.match(budget, /prompt_budget_exceeded_forecast/);
    assert.match(budget, /prompt_budget_exceeded_measured/);
    assert.match(budget, /model_capacity_unknown/);
    assert.doesNotMatch(budget, /Math\.min\([^)]*allowed/i, 'budget must not clamp to fit');

    // Output contracts must be enforced, which is what makes per-stage forecasts
    // a guarantee rather than an assumption.
    assert.match(budget, /assertChildOutputWithinContract/);
    assert.match(outputContract, /child_output_cap/);
    assert.match(outputContract, /fusionJsonRenderedTextBytes/);
    assert.match(orchestratorSource(), /assertChildOutputWithinContract\('candidate'/);

    // Forecasts must add contract maxima to real empty-slot prompt renderings.
    assert.match(budget, /buildEvaluationRepairPrompt/);
    assert.match(budget, /upstream_output_contract_bytes/);
    assert.doesNotMatch(budget, /FUSION_DOWNSTREAM_RESERVE_TOKENS/);

    // Route selection must rank byte capacity, not token capacity.
    assert.doesNotMatch(budget, /Math\.max\([^)]*route\.allowed_input_tokens/);
    assert.match(budget, /fusionLimitingRoute/);
    assert.match(budget, /byte_capacity_utf8_bytes/);

    // The shared estimator must stay affine, per-family, additive, and visibly
    // conservative for unbacked routes.
    assert.doesNotMatch(tokenBudget, /BYTES_PER_TOKEN_DIVISOR/);
    assert.match(tokenBudget, /TOKEN_BUDGET_CALIBRATION_VERSION/);
    assert.match(tokenBudget, /rate_bytes_per_token_x100: 173/);
    assert.match(tokenBudget, /rate_bytes_per_token_x100: 289/);
    assert.match(tokenBudget, /rate_bytes_per_token_x100: 100/);
    assert.match(tokenBudget, /backed: false/);
    assert.match(tokenBudget, /estimateInputTokens/);
    assert.match(tokenBudget, /unknown_output_contract/);
    assert.match(tokenBudget, /multibyteBytes/);
    assert.match(tokenBudget, /variableTokenTotal \+ rateSource\.affine_f_tokens/);
    assert.match(tokenBudget, /TOKEN_BUDGET_PROVABLE_RATE_X100 = 100/);
    assert.match(tokenBudget, /TOKEN_BUDGET_CONSERVATIVE_RATE_X100 = 200/);
    assert.match(tokenBudget, /TOKEN_BUDGET_DENSE_ASCII_WHITESPACE_THRESHOLD_X10000/);
    assert.match(
      tokenBudget,
      /TOKEN_BUDGET_DELEGATE_CONSERVATIVE_RATE_X100 = TOKEN_BUDGET_PROVABLE_RATE_X100/,
    );
    assert.doesNotMatch(tokenBudget, /sessions:/);
    assert.doesNotMatch(tokenBudget, /days:/);
    assert.match(tokenBudget, /Math\.min\(configured, TOKEN_BUDGET_CONSERVATIVE_RATE_X100\)/);
    assert.doesNotMatch(tokenBudget, /Math\.ceil\(utf8Bytes \//);
    assert.match(delegateChild, /retainedInputMeasurement/);
    assert.match(delegateChild, /retainedInputMultibyteBytes/);
    assert.match(delegateChild, /retainedInputDenseBytes/);

    // The shared transform must remain knob-free: a consumer must not be able to
    // ask it for a weaker disclosure policy.
    assert.match(transform, /export function projectVisibleConversationV2\(\s*messages/);
    assert.doesNotMatch(
      transform,
      /projectVisibleConversationV2\([^)]*(?:options|policy|flags|config)/,
      'the shared transform must not accept behavioural options',
    );
    assert.match(transform, /throw unsupportedBlock\(/);

    // Every budget stage must be guarded in the orchestrator before spawning.
    const orchestrator = orchestratorSource();
    for (const stage of ['candidate', 'evaluation', 'evaluation_repair', 'merge']) {
      assert.match(
        orchestrator,
        new RegExp(`assertStagePrompt\\(\\s*'${stage}'`),
        `orchestrator must preflight the ${stage} stage`,
      );
    }
    assert.match(orchestrator, /assertPlanFits\(/);
  });

  void it('keeps production durable syncing handle-scoped and loud', async () => {
    const files = await walkSourceTree(fileURLToPath(new URL('src/', root)));
    const violations: SourceViolation[] = [];
    for (const file of files) {
      const source = stripComments(await readFile(file, 'utf8'));
      // file is a native path from walkSourceTree, so the prefix must be native
      // too. Comparing against a URL pathname silently never matches on Windows.
      const rootPath = fileURLToPath(root);
      const label = file.startsWith(rootPath) ? file.slice(rootPath.length) : file;
      addPatternViolations(
        violations,
        label,
        'read-open sync',
        source,
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:nodeOpen|open|fs(?:Promises)?\.open|[A-Za-z_$][\w$]*\.openWritable)\s*\([^;]*,\s*(['"])r\+?\2[^;]*\)\s*;?[\s\S]*?\b\1\s*\.\s*sync\s*\(/g,
      );
      addPatternViolations(
        violations,
        label,
        'read-open sync',
        source,
        /\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:nodeOpen|open|fs(?:Promises)?\.open|[A-Za-z_$][\w$]*\.openWritable)\s*\([^;]*,\s*(['"])r\+?\2[^;]*\)\s*;?[\s\S]*?\b\1\s*\.\s*sync\s*\(/g,
      );
      addPatternViolations(
        violations,
        label,
        'fsyncFile function',
        source,
        /\b(?:async\s+)?function\s+fsyncFile\b|\b(?:const|let|var)\s+fsyncFile\s*=/g,
      );
      addExportedPathSyncViolations(violations, label, source);
      addSwallowedSyncViolations(violations, label, source);
    }
    assert.equal(violations.length, 0, formatSourceViolations(violations));
  });

  void it('file URL pathname guard distinguishes native-path conversions from URL validation', () => {
    const fileUrlAntipatterns = [
      "import { URL as NodeURL, pathToFileURL as toFileUrl } from 'node:url';",
      "const inline = new URL('./child', import.meta.url).pathname;",
      'const meta = import.meta;',
      'const moduleHref = meta.url;',
      "const variable = new NodeURL('../', moduleHref);",
      'const alias = variable;',
      "const variablePath = alias['pathname'];",
      "const { pathname: drivePath } = new URL('file:///C:/Users/Test/repo/file.ts');",
      "const uncPath = new URL('file://server/share/repo/file.ts').pathname;",
      "const fromNative = toFileUrl('C:\\\\repo\\\\file.ts').pathname;",
      'const URLAlias = NodeURL;',
      "const constructorAlias = new URLAlias('file:///D:/work/pkg/index.ts').pathname;",
      'let assigned;',
      "assigned = new URL('./assigned', import.meta.url);",
      'const assignedPath = assigned.pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('file-url-antipatterns.ts', fileUrlAntipatterns).map(
        (violation) => violation.line,
      ),
      [2, 7, 8, 9, 10, 12, 15],
    );

    const legitimateUrlPaths = [
      'function validate(configured: string): string {',
      '  const parsed = new URL(configured);',
      "  if (parsed.origin !== 'https://api.anthropic.com' || parsed.pathname !== '/') throw new Error();",
      '  return parsed.pathname;',
      '}',
      "const inlineHttps = new URL('https://example.com/a/b').pathname;",
      "const basedHttps = new URL('/v1/messages', 'https://api.anthropic.com').pathname;",
      "const absoluteOverride = new URL('https://example.com/a', import.meta.url).pathname;",
      "const nativePath = fileURLToPath(new URL('./module.ts', import.meta.url));",
      'function requestPath(url: URL): string {',
      '  return `${url.pathname}${url.search}`;',
      '}',
      '// Ordinary prose mentions new URL(...).pathname and file:///C:/repo.',
      'const quoted = "new URL(\\"file:///C:/repo\\").pathname";',
      'const pattern = /file:\\/\\/\\/C:\\/repo|\\.pathname/u;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('legitimate-url-paths.ts', legitimateUrlPaths),
      [],
    );
  });

  void it('file URL guard gives absolute first arguments precedence over bases', () => {
    const fileCases = [
      "const absoluteFile = new URL('file:///C:/work/file.ts');",
      "const fromObject = new URL(absoluteFile, 'https://example.com/base').pathname;",
      "const fromMeta = new URL(import.meta.url, 'https://example.com/base').pathname;",
      "const host = 'server';",
      'const fromTemplate = new URL(`file://${host}/share/file.ts`).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('absolute-file-first.ts', fileCases).map(
        (violation) => violation.line,
      ),
      [2, 3, 5],
    );

    const httpsCases = [
      "const absoluteHttps = new URL('https://example.com/request/path');",
      'const fromObject = new URL(absoluteHttps, import.meta.url).pathname;',
      "const host = 'example.com';",
      'const fromTemplate = new URL(`https://${host}/v1`, import.meta.url).pathname;',
    ].join('\n');
    assert.deepEqual(findFileUrlPathnameViolations('absolute-https-first.ts', httpsCases), []);
  });

  void it('file URL guard retains explicit bases for possibly relative first inputs', () => {
    const fileBaseCases = [
      'declare const relativeName: string;',
      'declare const fixtureName: string;',
      'declare const condition: boolean;',
      'const inline = new URL(relativeName, import.meta.url).pathname;',
      "const literalBase = new URL(relativeName, 'file:///C:/pkg/module.ts').pathname;",
      "const fileBaseObject = new URL('file:///C:/pkg/module.ts');",
      'const declared = new URL(relativeName, fileBaseObject);',
      'const declaredPath = declared.pathname;',
      "let assigned = new URL('https://example.com/start');",
      'assigned = new URL(`./fixtures/${fixtureName}.json`, `file:///C:/pkg/module.ts`);',
      'const assignedPath = assigned.pathname;',
      'const parentTemplate = new URL(`../fixtures/${fixtureName}.json`, import.meta.url).pathname;',
      "const mixedFirst = condition ? 'https://example.com/request/path' : relativeName;",
      'const mixedPath = new URL(mixedFirst, import.meta.url).pathname;',
      "const absoluteFileObject = new URL('file:///D:/work/object.ts');",
      "new URL(absoluteFileObject, 'https://example.com/base').pathname;",
      "new URL('file:///E:/work/literal.ts', 'https://example.com/base').pathname;",
      "const fileHost = 'server';",
      'new URL(`file://${fileHost}/share/template.ts`, `https://example.com/base`).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('possible-relative-file-bases.ts', fileBaseCases).map(
        (violation) => violation.line,
      ),
      [4, 5, 8, 11, 12, 14, 16, 17, 19],
    );

    const httpsBaseControls = [
      'declare const relativeName: string;',
      'declare const fixtureName: string;',
      'declare const condition: boolean;',
      "new URL(relativeName, 'https://example.com/base').pathname;",
      'new URL(`./fixtures/${fixtureName}.json`, `https://example.com/base`).pathname;',
      "const httpsBaseObject = new URL('https://example.com/base');",
      'new URL(`../fixtures/${fixtureName}.json`, httpsBaseObject).pathname;',
      "const mixedFirst = condition ? 'https://example.com/request/path' : relativeName;",
      'new URL(mixedFirst, httpsBaseObject).pathname;',
      "const absoluteHttpsObject = new URL('https://example.com/object');",
      'new URL(absoluteHttpsObject, import.meta.url).pathname;',
      "new URL('https://example.com/literal', import.meta.url).pathname;",
      "const httpsHost = 'example.com';",
      'new URL(`https://${httpsHost}/template`, import.meta.url).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('possible-relative-https-bases.ts', httpsBaseControls),
      [],
    );
  });

  void it('file URL guard follows WHATWG preprocessing for static inputs', () => {
    const fileCases = [
      "const host = 'server';",
      "const leadingControls = new URL('\\u0000\\u001f file:///C:/work/file.ts', 'https://example.com/base').pathname;",
      "const normalizedTabs = new URL('fi\\tle:///D:/work/file.ts', 'https://example.com/base').pathname;",
      "const normalizedCarriageReturn = new URL('fi\\rle:///E:/work/file.ts', 'https://example.com/base').pathname;",
      "const normalizedTemplate = new URL(`\\r\\nfi\\tle://${host}/share/file.ts`, 'https://example.com/base').pathname;",
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('whatwg-file-preprocessing.ts', fileCases).map(
        (violation) => violation.line,
      ),
      [2, 3, 4, 5],
    );

    const httpsCases = [
      "const host = 'example.com';",
      "const leadingControls = new URL('\\u0000 \\t\\r\\nhttps://example.com/request/path', import.meta.url).pathname;",
      "const normalizedNewline = new URL('ht\\ntps://example.com/request/path', import.meta.url).pathname;",
      "const normalizedTab = new URL('ht\\ttps://example.com/request/path', import.meta.url).pathname;",
      "const normalizedCarriageReturn = new URL('ht\\rtps://example.com/request/path', import.meta.url).pathname;",
      'const normalizedTemplate = new URL(`\\r\\nht\\ntps://${host}/v1`, import.meta.url).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('whatwg-https-preprocessing.ts', httpsCases),
      [],
    );

    const dynamicCases = [
      'declare const condition: boolean;',
      'declare const dynamicScheme: string;',
      "const maybeFile = condition ? 'file:///C:/work/file.ts' : `${dynamicScheme}://example.com/path`;",
      "new URL(maybeFile, 'https://example.com/base').pathname;",
      'new URL(`${dynamicScheme}://example.com/path`, import.meta.url).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('whatwg-dynamic-boundary.ts', dynamicCases).map(
        (violation) => violation.line,
      ),
      [4, 5],
    );

    const runtimeHost = 'server';
    assert.equal(
      new URL('\u0000\u001f file:///C:/work/file.ts', 'https://example.com/base').protocol,
      'file:',
    );
    assert.equal(
      new URL('fi\tle:///D:/work/file.ts', 'https://example.com/base').protocol,
      'file:',
    );
    assert.equal(
      new URL('fi\rle:///E:/work/file.ts', 'https://example.com/base').protocol,
      'file:',
    );
    assert.equal(
      new URL(`\r\nfi\tle://${runtimeHost}/share/file.ts`, 'https://example.com/base').protocol,
      'file:',
    );
    assert.equal(
      new URL('\u0000 \t\r\nhttps://example.com/request/path', import.meta.url).protocol,
      'https:',
    );
    assert.equal(new URL('ht\ntps://example.com/request/path', import.meta.url).protocol, 'https:');
    assert.equal(new URL('ht\ttps://example.com/request/path', import.meta.url).protocol, 'https:');
    assert.equal(new URL('ht\rtps://example.com/request/path', import.meta.url).protocol, 'https:');
    assert.equal(new URL(`\r\nht\ntps://${runtimeHost}/v1`, import.meta.url).protocol, 'https:');
  });

  void it('file URL guard preserves explicit abrupt completion states', () => {
    const positiveCases: ReadonlyArray<{
      readonly name: string;
      readonly source: string;
      readonly lines: readonly number[];
    }> = [
      {
        name: 'nested ordinary switch break',
        source: [
          'declare const mode: string;',
          "let target = 'https://example.com/request/path';",
          'switch (mode) {',
          "  case 'native': {",
          "    target = 'file:///C:/work/file.ts';",
          '    break;',
          '  }',
          '  default:',
          "    target = 'https://example.com/other';",
          '}',
          'new URL(target).pathname;',
        ].join('\n'),
        lines: [11],
      },
      {
        name: 'labeled break',
        source: [
          'declare const condition: boolean;',
          "let target = 'file:///C:/work/file.ts';",
          'exit: {',
          '  if (condition) break exit;',
          "  target = 'https://example.com/request/path';",
          '}',
          'new URL(target).pathname;',
        ].join('\n'),
        lines: [7],
      },
      {
        name: 'ordinary continue',
        source: [
          'declare const condition: boolean;',
          "let target = 'https://example.com/request/path';",
          'do {',
          '  if (condition) {',
          "    target = 'file:///C:/work/file.ts';",
          '    continue;',
          '  }',
          "  target = 'https://example.com/other';",
          '} while (false);',
          'new URL(target).pathname;',
        ].join('\n'),
        lines: [10],
      },
      {
        name: 'labeled continue',
        source: [
          'declare const condition: boolean;',
          "let target = 'https://example.com/request/path';",
          'outer: do {',
          '  if (condition) {',
          "    target = 'file:///C:/work/file.ts';",
          '    continue outer;',
          '  }',
          "  target = 'https://example.com/other';",
          '} while (false);',
          'new URL(target).pathname;',
        ].join('\n'),
        lines: [10],
      },
      {
        name: 'normal completion runs finally',
        source: [
          'function inspect(): void {',
          "  let target = 'https://example.com/request/path';",
          "  try { target = 'file:///C:/work/file.ts'; }",
          '  finally { new URL(target).pathname; }',
          '}',
        ].join('\n'),
        lines: [4],
      },
      {
        name: 'break runs finally',
        source: [
          'function inspect(): void {',
          "  let target = 'https://example.com/request/path';",
          '  while (true) {',
          "    try { target = 'file:///C:/work/file.ts'; break; }",
          '    finally { new URL(target).pathname; }',
          '  }',
          '}',
        ].join('\n'),
        lines: [5],
      },
      {
        name: 'continue runs finally',
        source: [
          'function inspect(): void {',
          "  let target = 'https://example.com/request/path';",
          '  do {',
          "    try { target = 'file:///C:/work/file.ts'; continue; }",
          '    finally { new URL(target).pathname; }',
          '  } while (false);',
          '}',
        ].join('\n'),
        lines: [5],
      },
      {
        name: 'return into finally with live provenance',
        source: [
          'function inspect(): void {',
          "  let target = 'https://example.com/request/path';",
          '  try {',
          "    target = 'file:///C:/work/file.ts';",
          '    return;',
          '  } finally {',
          '    new URL(target).pathname;',
          '  }',
          '}',
        ].join('\n'),
        lines: [7],
      },
      {
        name: 'direct return finally syntax',
        source: [
          'function inspect(): void {',
          '  try { return; } finally {',
          "    new URL('file:///C:/work/file.ts').pathname;",
          '  }',
          '}',
        ].join('\n'),
        lines: [3],
      },
      {
        name: 'throw state enters catch',
        source: [
          'function inspect(): void {',
          "  let target = 'https://example.com/request/path';",
          '  try {',
          "    target = 'file:///C:/work/file.ts';",
          "    throw new Error('caught');",
          '  } catch {',
          '    new URL(target).pathname;',
          '  }',
          '}',
        ].join('\n'),
        lines: [7],
      },
      {
        name: 'throw into finally',
        source: [
          'function inspect(): void {',
          "  let target = 'https://example.com/request/path';",
          '  try {',
          "    target = 'file:///C:/work/file.ts';",
          "    throw new Error('uncaught');",
          '  } finally {',
          '    new URL(target).pathname;',
          '  }',
          '}',
        ].join('\n'),
        lines: [7],
      },
    ];
    for (const fixture of positiveCases) {
      assert.deepEqual(
        findFileUrlPathnameViolations(`${fixture.name}.ts`, fixture.source).map(
          (violation) => violation.line,
        ),
        fixture.lines,
        fixture.name,
      );
    }

    const httpControls = [
      {
        name: 'nested break HTTP',
        source: [
          'declare const mode: string;',
          "let target = 'https://example.com/request/path';",
          'switch (mode) {',
          "  case 'keep': { break; }",
          "  default: target = 'https://example.com/other';",
          '}',
          'new URL(target).pathname;',
        ].join('\n'),
      },
      {
        name: 'labeled break HTTP',
        source: [
          'declare const condition: boolean;',
          "let target = 'https://example.com/request/path';",
          'exit: {',
          '  if (condition) break exit;',
          "  target = 'https://example.com/other';",
          '}',
          'new URL(target).pathname;',
        ].join('\n'),
      },
      {
        name: 'continue HTTP',
        source: [
          'declare const condition: boolean;',
          "let target = 'https://example.com/request/path';",
          'do {',
          '  if (condition) {',
          "    target = 'https://example.com/continued';",
          '    continue;',
          '  }',
          "  target = 'https://example.com/other';",
          '} while (false);',
          'new URL(target).pathname;',
        ].join('\n'),
      },
      {
        name: 'normal finally HTTP',
        source: [
          'function inspect(): void {',
          "  let target = 'file:///C:/work/file.ts';",
          "  try { target = 'https://example.com/request/path'; }",
          '  finally { new URL(target).pathname; }',
          '}',
        ].join('\n'),
      },
      {
        name: 'return finally HTTP',
        source: [
          'function inspect(): void {',
          "  let target = 'file:///C:/work/file.ts';",
          "  try { target = 'https://example.com/request/path'; return; }",
          '  finally { new URL(target).pathname; }',
          '}',
        ].join('\n'),
      },
      {
        name: 'caught throw HTTP',
        source: [
          'function inspect(): void {',
          "  let target = 'file:///C:/work/file.ts';",
          '  try {',
          "    target = 'https://example.com/request/path';",
          "    throw new Error('caught');",
          '  } catch { new URL(target).pathname; }',
          '}',
        ].join('\n'),
      },
      {
        name: 'throw finally HTTP',
        source: [
          'function inspect(): void {',
          "  let target = 'file:///C:/work/file.ts';",
          '  try {',
          "    target = 'https://example.com/request/path';",
          "    throw new Error('uncaught');",
          '  } finally { new URL(target).pathname; }',
          '}',
        ].join('\n'),
      },
    ];
    for (const fixture of httpControls) {
      assert.deepEqual(
        findFileUrlPathnameViolations(`${fixture.name}.ts`, fixture.source),
        [],
        fixture.name,
      );
    }
  });

  void it('file URL guard prunes statically impossible short-circuit writes', () => {
    const controls = [
      "let target = 'https://example.com/request/path';",
      "false && (target = 'file:///C:/skipped-and.ts');",
      "true || (target = 'file:///C:/skipped-or.ts');",
      "const present = 'present';",
      "present ?? (target = 'file:///C:/skipped-nullish.ts');",
      'new URL(target).pathname;',
    ].join('\n');
    assert.deepEqual(findFileUrlPathnameViolations('short-circuit-controls.ts', controls), []);

    const hazards = [
      "let andTarget = 'https://example.com/request/path';",
      "true && (andTarget = 'file:///C:/evaluated-and.ts');",
      'new URL(andTarget).pathname;',
      "let orTarget = 'https://example.com/request/path';",
      "false || (orTarget = 'file:///C:/evaluated-or.ts');",
      'new URL(orTarget).pathname;',
      "let nullishTarget = 'https://example.com/request/path';",
      'const missing = null;',
      "missing ?? (nullishTarget = 'file:///C:/evaluated-nullish.ts');",
      'new URL(nullishTarget).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('short-circuit-hazards.ts', hazards).map(
        (violation) => violation.line,
      ),
      [3, 6, 10],
    );
  });

  void it('file URL guard checks for-of destructuring and resolves globalThis lexically', () => {
    const hazards = [
      "let pathname = '';",
      "for ({ pathname } of [new URL('file:///C:/work/file.ts')]) break;",
      "for (const { pathname: declaredPath } of [new URL('file://server/share/file.ts')]) { void declaredPath; }",
      "const globalPath = new globalThis.URL('file:///D:/work/file.ts').pathname;",
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('for-of-and-global-url.ts', hazards).map(
        (violation) => violation.line,
      ),
      [2, 3, 4],
    );

    const controls = [
      "let pathname = '';",
      "for ({ pathname } of [new URL('https://example.com/request/path')]) break;",
      "for (const { pathname: requestPath } of [new URL('https://example.com/other')]) { void requestPath; }",
      'function localUrl(URL: new (value: string) => { pathname: string }): string {',
      "  for ({ pathname } of [new URL('file:///C:/not-a-real-url')]) break;",
      '  return pathname;',
      '}',
      "class FakeURL { readonly pathname = 'not-a-native-path'; constructor(_value: string) {} }",
      'function parameterShadow(globalThis: { URL: typeof FakeURL }): string {',
      "  return new globalThis.URL('file:///C:/not-a-real-url').pathname;",
      '}',
      'function localShadow(): string {',
      '  const globalThis = { URL: FakeURL };',
      "  return new globalThis.URL('file:///C:/still-not-a-real-url').pathname;",
      '}',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('for-of-and-global-url-controls.ts', controls),
      [],
    );
  });

  void it('file URL guard distinguishes uppercase constructor and lowercase meta keys', () => {
    const hazards = [
      "new globalThis.URL('file:///C:/work/dot.ts').pathname;",
      "new globalThis['URL']('file:///C:/work/bracket.ts').pathname;",
      "const constructorKey = 'URL' as const;",
      "new globalThis[constructorKey]('file:///C:/work/key.ts').pathname;",
      "const importMetaKey = 'url' as const;",
      "new URL('./child.ts', import.meta[importMetaKey]).pathname;",
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('static-url-keys.ts', hazards).map(
        (violation) => violation.line,
      ),
      [1, 2, 4, 6],
    );

    const controls = [
      "class FakeURL { readonly pathname = 'fake'; constructor(_value: string) {} }",
      'declare global {',
      '  var url: typeof FakeURL;',
      '  interface ImportMeta { readonly URL: string; }',
      '}',
      "const lowercaseConstructorKey = 'url' as const;",
      "new globalThis[lowercaseConstructorKey]('file:///C:/not-native.ts').pathname;",
      "const uppercaseMetaKey = 'URL' as const;",
      "new URL('./child.ts', import.meta[uppercaseMetaKey]).pathname;",
      'function parameterShadow(globalThis: { URL: typeof FakeURL }): string {',
      "  return new globalThis['URL']('file:///C:/parameter.ts').pathname;",
      '}',
      'function localShadow(): string {',
      '  const globalThis = { URL: FakeURL };',
      "  return new globalThis['URL']('file:///C:/local.ts').pathname;",
      '}',
      'export {};',
    ].join('\n');
    assert.deepEqual(findFileUrlPathnameViolations('static-url-key-controls.ts', controls), []);
  });

  void it('file URL guard uses feasible values at each pathname read', () => {
    const readBeforeWrite = [
      "let target = 'file:///C:/work/file.ts';",
      'const nativePath = new URL(target).pathname;',
      "target = 'https://example.com/request/path';",
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('read-before-write.ts', readBeforeWrite).map(
        (violation) => violation.line,
      ),
      [2],
    );

    const mayFileBranch = [
      'let target: string;',
      "if (condition) target = 'https://example.com/request/path';",
      "else target = 'file:///C:/work/file.ts';",
      'const maybeNativePath = new URL(target).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('may-file-branch.ts', mayFileBranch).map(
        (violation) => violation.line,
      ),
      [4],
    );

    const switchMayFile = [
      "let target = 'https://example.com/request/path';",
      'switch (mode) {',
      "  case 'native':",
      "    target = 'file:///C:/work/file.ts';",
      '    break;',
      '  default:',
      "    target = 'https://example.com/other';",
      '}',
      'const maybeNativePath = new URL(target).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('switch-may-file.ts', switchMayFile).map(
        (violation) => violation.line,
      ),
      [9],
    );

    const overwrittenBeforeRead = [
      "let parsed = new URL('./module.ts', import.meta.url);",
      "parsed = new URL('https://example.com/request/path');",
      'const requestPath = parsed.pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('overwritten-before-read.ts', overwrittenBeforeRead),
      [],
    );

    const writeAfterRead = [
      "let target = 'https://example.com/request/path';",
      'const requestPath = new URL(target).pathname;',
      "target = 'file:///C:/work/file.ts';",
    ].join('\n');
    assert.deepEqual(findFileUrlPathnameViolations('write-after-read.ts', writeAfterRead), []);

    const unreachableFileWrite = [
      "let target = 'https://example.com/request/path';",
      "if (false) target = 'file:///C:/work/file.ts';",
      'const requestPath = new URL(target).pathname;',
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('unreachable-file-write.ts', unreachableFileWrite),
      [],
    );
  });

  void it('file URL guard covers destructuring assignments and computed pathname aliases', () => {
    const hazards = [
      'let assignedPath: string;',
      "({ pathname: assignedPath } = new URL('file:///C:/work/file.ts'));",
      "const key = 'pathname' as const;",
      "const computedPath = new URL('file://server/share/file.ts')[key];",
      'let computedAssignment: string;',
      "({ [key]: computedAssignment } = new URL('file:///D:/work/file.ts'));",
    ].join('\n');
    assert.deepEqual(
      findFileUrlPathnameViolations('pathname-aliases.ts', hazards).map(
        (violation) => violation.line,
      ),
      [2, 4, 6],
    );

    const controls = [
      'let requestPath: string;',
      "({ pathname: requestPath } = new URL('https://example.com/request/path'));",
      "const key = 'pathname' as const;",
      "const computedPath = new URL('https://example.com/request/path')[key];",
      'function local(URL: new (value: string) => { pathname: string }): string {',
      '  let pathname: string;',
      "  ({ pathname } = new URL('file:///C:/not-a-real-url-object'));",
      "  return new URL('file:///C:/still-not-a-real-url-object')[key];",
      '}',
    ].join('\n');
    assert.deepEqual(findFileUrlPathnameViolations('pathname-alias-controls.ts', controls), []);
  });

  void it('converts file URLs to native paths instead of using URL.pathname', async () => {
    // A file URL pathname such as `/D:/a/repo/` is not a Windows native path.
    // Follow only compiler-proven file URL provenance so HTTPS path validation
    // remains legitimate while inline, indirect, and aliased conversions fail.
    const roots = ['src', 'extensions', 'scripts', 'tests'];
    const offenders: string[] = [];
    for (const rootDir of roots) {
      const dir = fileURLToPath(new URL(`${rootDir}/`, root));
      if (!existsSync(dir)) continue;
      for (const file of await walkSourceTree(dir)) {
        const source = await readFile(file, 'utf8');
        for (const violation of findFileUrlPathnameViolations(file, source)) {
          offenders.push(`${violation.file}:${String(violation.line)} ${violation.text}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'use fileURLToPath(fileUrl) instead of fileUrl.pathname for native paths',
    );
  });

  void it('typechecks standalone with the full monorepo strictness vendored locally', async () => {
    // The package is published both from this monorepo and as a standalone git
    // repo. A parent `../../tsconfig.base.json` does not exist in the standalone
    // checkout, so `extends` must point at a locally vendored copy. CI proved
    // that a missing base silently drops `skipLibCheck` and makes `tsc` walk
    // node_modules type definitions.
    const tsconfig = parseJsonValue(await text('tsconfig.json'));
    assert.ok(isObject(tsconfig));
    assert.equal(
      field(tsconfig, 'extends'),
      './tsconfig.base.json',
      'tsconfig must extend a locally vendored base so standalone checkouts typecheck',
    );

    const localBase = parseJsonValue(await text('tsconfig.base.json'));
    assert.ok(isObject(localBase));
    const localOptions = field(localBase, 'compilerOptions');
    assert.ok(isObject(localOptions));

    // Every strictness flag from the monorepo base must be present and equal.
    // Weakening the standalone config to make a build pass is not acceptable.
    const required: Record<string, boolean> = {
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      noImplicitReturns: true,
      noPropertyAccessFromIndexSignature: true,
      noFallthroughCasesInSwitch: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      useUnknownInCatchVariables: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      allowUnreachableCode: false,
      allowUnusedLabels: false,
      skipLibCheck: true,
    };
    for (const [flag, expected] of Object.entries(required)) {
      assert.equal(
        field(localOptions, flag),
        expected,
        `vendored tsconfig.base.json must keep ${flag}=${String(expected)}`,
      );
    }
  });

  void it('packs exactly the runtime/docs payload and excludes tests/artifacts', () => {
    const envRoot = makeIsolatedEnvRoot('pi-bg-pack-env-');
    const packCwd = join(envRoot, 'pack-project');
    makeIsolatedNpmProject(packCwd, 'payload-pack-project');
    const r = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json', fileURLToPath(root)], {
      cwd: packCwd,
      env: isolatedNpmEnv(envRoot),
    });
    removeIsolatedEnvRoot(envRoot);
    assert.equal(r.status, 0, r.stderr);
    const firstEntry = parsePackEntries(r.stdout)[0];
    assert.ok(firstEntry, 'npm pack must return one entry');
    const files = firstEntry.files.map((file) => file.path).sort();
    for (const f of [
      'dist/extensions/anthropic-attribution-child.js',
      'dist/extensions/anthropic-attribution.js',
      'dist/extensions/background-tasks.js',
      'dist/extensions/delegate-child.js',
      'dist/extensions/fusion-child.js',
      'dist/src/core/delegate/hook-contract-evidence.json',
      'dist/package.json',
      'extensions/anthropic-attribution-child.ts',
      'extensions/anthropic-attribution.ts',
      'extensions/background-tasks.ts',
      'extensions/fusion-child.ts',
      'src/extension.ts',
      'src/fusion-child-extension.ts',
      'src/core/common.ts',
      'src/core/registry.ts',
      'src/core/anthropic-attribution.ts',
      'src/core/anthropic-attribution-path.ts',
      'src/core/config.ts',
      'src/core/extension-api.ts',
      'src/core/attested-pi-run.ts',
      'src/core/pi-launch.ts',
      'src/ui/background-tasks-manager.ts',
      'src/ui/fusion-model-selector.ts',
      'src/fusion-extension.ts',
      'src/core/fusion/types.ts',
      'src/core/fusion/config.ts',
      'src/core/fusion/context.ts',
      'src/core/fusion/prompts.ts',
      'src/core/fusion/evaluation.ts',
      'src/core/fusion/pi-child.ts',
      'src/core/fusion/child-protocol.ts',
      'src/core/fusion/artifacts.ts',
      'src/core/fusion/orchestrator.ts',
      'src/core/fusion/budget.ts',
      'src/core/fusion/output-contract.ts',
      'src/core/fusion/web-fetch.ts',
      'src/core/fusion/result-package.ts',
      'README.md',
      'BACKGROUND-TASKS-INSTRUCTIONS.md',
      'logo.png',
      'TESTING.md',
      'TEST_PLAN.md',
      'PUBLISHING.md',
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'docs/INDEX.md',
      'docs/read-before-edit.md',
      'docs/manifest.json',
      'docs/attestations.json',
      'docs/assets/architecture.svg',
      'docs/assets/footer-dock.svg',
      'docs/assets/logo.svg',
      'docs/subsystems/docs-freshness-gate.md',
      'package.json',
    ])
      assert.ok(files.includes(f), f);
    assert.ok(
      files.some((f) => f.startsWith('dist/src/') && f.endsWith('.js')),
      'compiled runtime closure must ship',
    );
    assert.ok(!files.some((f) => f.startsWith('tests/')), 'tests must not ship');
    assert.ok(!files.some((f) => f.startsWith('scripts/')), 'release-only scripts must not ship');
    assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules must not ship');
    assert.ok(!files.some((f) => f.endsWith('.tgz')), 'nested tarballs must not ship');
  });

  void it('isolates npm user, global, and project configuration without a hostile request', async () => {
    const envRoot = makeIsolatedEnvRoot('pi-bg-npm-config-env-');
    const probeProject = join(envRoot, 'probe-project');
    const hostileProject = join(envRoot, 'hostile-project');
    const safeUserConfig = join(envRoot, 'config', 'user.npmrc');
    const safeGlobalConfig = join(envRoot, 'config', 'global.npmrc');
    const hostileGlobalConfig = join(envRoot, 'hostile-global.npmrc');
    const hostileRegistry = 'http://127.0.0.1:9/never-contact/';
    const ownedRegistry = 'http://127.0.0.1:43210/';
    try {
      for (const [directory, name] of [
        [probeProject, 'isolated-config-probe'],
        [hostileProject, 'hostile-project-probe'],
      ] as const) {
        mkdirSync(directory, { recursive: true });
        await writeFile(
          join(directory, 'package.json'),
          `${JSON.stringify({ name, private: true, version: '1.0.0' }, null, 2)}\n`,
        );
      }
      await writeFile(join(probeProject, '.npmrc'), '');
      await writeFile(join(hostileProject, '.npmrc'), `@mixmark-io:registry=${hostileRegistry}\n`);
      await writeFile(safeUserConfig, '');
      await writeFile(safeGlobalConfig, '');
      await writeFile(hostileGlobalConfig, `@mixmark-io:registry=${hostileRegistry}\n`);

      const vulnerableEnv = localRegistryNpmEnv(envRoot, ownedRegistry);
      vulnerableEnv['NPM_CONFIG_GLOBALCONFIG'] = hostileGlobalConfig;
      vulnerableEnv['npm_config_globalconfig'] = hostileGlobalConfig;
      const vulnerableGlobal = runNpm(['config', 'get', '@mixmark-io:registry'], {
        cwd: probeProject,
        env: vulnerableEnv,
      });
      assert.equal(vulnerableGlobal.status, 0, vulnerableGlobal.stderr);
      assert.equal(vulnerableGlobal.stdout.trim(), hostileRegistry);

      const isolatedEnv = localRegistryNpmEnv(envRoot, ownedRegistry);
      assert.equal(isolatedEnv['NPM_CONFIG_USERCONFIG'], safeUserConfig);
      assert.equal(isolatedEnv['npm_config_userconfig'], safeUserConfig);
      assert.equal(isolatedEnv['NPM_CONFIG_GLOBALCONFIG'], safeGlobalConfig);
      assert.equal(isolatedEnv['npm_config_globalconfig'], safeGlobalConfig);
      assert.equal(isolatedEnv['GIT_ALLOW_PROTOCOL'], 'file');
      assert.equal(isolatedEnv['TMPDIR'], join(envRoot, 'tmp'));

      const effectiveGlobal = runNpm(['config', 'get', 'globalconfig'], {
        cwd: probeProject,
        env: isolatedEnv,
      });
      assert.equal(effectiveGlobal.status, 0, effectiveGlobal.stderr);
      assert.equal(effectiveGlobal.stdout.trim(), safeGlobalConfig);
      const effectiveUser = runNpm(['config', 'get', 'userconfig'], {
        cwd: probeProject,
        env: isolatedEnv,
      });
      assert.equal(effectiveUser.status, 0, effectiveUser.stderr);
      assert.equal(effectiveUser.stdout.trim(), safeUserConfig);
      const effectiveRegistry = runNpm(['config', 'get', 'registry'], {
        cwd: probeProject,
        env: isolatedEnv,
      });
      assert.equal(effectiveRegistry.status, 0, effectiveRegistry.stderr);
      assert.equal(effectiveRegistry.stdout.trim(), ownedRegistry);
      const effectiveScope = runNpm(['config', 'get', '@mixmark-io:registry'], {
        cwd: probeProject,
        env: isolatedEnv,
      });
      assert.equal(effectiveScope.status, 0, effectiveScope.stderr);
      assert.notEqual(effectiveScope.stdout.trim(), hostileRegistry);

      const vulnerableProject = runNpm(['config', 'get', '@mixmark-io:registry'], {
        cwd: hostileProject,
        env: isolatedEnv,
      });
      assert.equal(vulnerableProject.status, 0, vulnerableProject.stderr);
      assert.equal(vulnerableProject.stdout.trim(), hostileRegistry);
    } finally {
      removeIsolatedEnvRoot(envRoot);
    }
  });

  void it('characterizes npm --ignore-scripts without requiring future npm defects', () => {
    const prepareFailure = 'sentinel lifecycle executed: prepare';
    const accepted: readonly NpmIgnoreScriptsObservation[] = [
      ['10.9.3', 1, prepareFailure, ['prepare']],
      ['11.13.0', 0, '', []],
      ['10.10.0', 0, '', []],
    ];
    for (const observation of accepted) assertNpmIgnoreScriptsObservation(...observation);

    const rejected: readonly NpmIgnoreScriptsObservation[] = [
      ['10.10.0', 1, prepareFailure, ['prepare']],
      ['11.13.0', 0, '', ['prepare']],
      ['10.9.3', 1, prepareFailure, ['prepack', 'prepare']],
      ['10.9.3', 2, prepareFailure, ['prepare']],
      ['10.9.3', 1, 'different failure', ['prepare']],
      ['11.13.0', 1, 'different failure', []],
    ];
    for (const observation of rejected) {
      assert.throws(
        () => assertNpmIgnoreScriptsObservation(...observation),
        /unexpected npm pack --ignore-scripts lifecycle observation/u,
      );
    }
    assert.throws(
      () => assertNpmIgnoreScriptsObservation('not-semver', 0, '', []),
      /expected npm --version to report a semantic version/u,
    );
    assert.throws(
      () => assertNpmIgnoreScriptsObservation('9.9.9', 0, '', []),
      /expected npm >=10/u,
    );
  });

  void it('denies dependency packing lifecycle scripts across supported npm CLIs', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pi-bg-pack-script-denial-'));
    const envRoot = makeIsolatedEnvRoot('pi-bg-pack-script-env-');
    const packageRoot = join(temp, 'fixture-root');
    const sentinelDirectory = join(packageRoot, 'node_modules', 'npm-pack-lifecycle-sentinel');
    const packProject = join(temp, 'pack-project');
    const markerDirectory = join(temp, 'markers');
    const sentinelScripts = {
      prepack: 'node lifecycle.cjs prepack',
      prepare: 'node lifecycle.cjs prepare',
      postpack: 'node lifecycle.cjs postpack',
    };
    let registry: Awaited<ReturnType<typeof startInstalledDependencyRegistry>> | undefined;

    const resetMarkers = (): void => {
      rmSync(markerDirectory, { recursive: true, force: true });
      mkdirSync(markerDirectory, { recursive: true });
    };
    const markerEvents = (): string[] => {
      const markerPath = join(markerDirectory, 'attempts.log');
      if (!existsSync(markerPath)) return [];
      return readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean);
    };
    const sentinelEnv = (failEvent: string): NodeJS.ProcessEnv => ({
      ...isolatedNpmEnv(envRoot),
      NPM_PACK_SENTINEL_MARKERS: markerDirectory,
      NPM_PACK_SENTINEL_FAIL_EVENT: failEvent,
    });

    try {
      makeIsolatedNpmProject(packageRoot, 'lifecycle-sentinel-root');
      makeIsolatedNpmProject(packProject, 'lifecycle-sentinel-pack-project');
      mkdirSync(sentinelDirectory, { recursive: true });
      const sentinelManifest = `${JSON.stringify(
        {
          name: 'npm-pack-lifecycle-sentinel',
          version: '1.0.0',
          scripts: sentinelScripts,
          files: ['lifecycle.cjs', 'payload.txt'],
        },
        null,
        2,
      )}\n`;
      writeFileSync(join(sentinelDirectory, 'package.json'), sentinelManifest);
      writeFileSync(join(sentinelDirectory, 'payload.txt'), 'real sentinel payload\n');
      writeFileSync(
        join(sentinelDirectory, 'lifecycle.cjs'),
        [
          "const { appendFileSync, mkdirSync } = require('node:fs');",
          "const { join } = require('node:path');",
          'const event = process.argv[2];',
          'const markers = process.env.NPM_PACK_SENTINEL_MARKERS;',
          "if (!markers) throw new Error('NPM_PACK_SENTINEL_MARKERS is required');",
          'mkdirSync(markers, { recursive: true });',
          "appendFileSync(join(markers, 'attempts.log'), `${event}\\n`, 'utf8');",
          'if (process.env.NPM_PACK_SENTINEL_FAIL_EVENT === event) {',
          '  throw new Error(`sentinel lifecycle executed: ${event}`);',
          '}',
          '',
        ].join('\n'),
      );

      const npmVersion = runNpm(['--version'], {
        cwd: packProject,
        env: sentinelEnv(''),
      });
      assert.equal(npmVersion.status, 0, npmVersion.stderr);
      const npmVersionText = requireSupportedNpmVersion(npmVersion.stdout);

      resetMarkers();
      const attemptedTarballs = join(temp, 'attempted-tarballs');
      mkdirSync(attemptedTarballs, { recursive: true });
      const lifecycleAttempt = runNpm(
        ['pack', '--json', '--pack-destination', attemptedTarballs, sentinelDirectory],
        { cwd: packProject, env: sentinelEnv('postpack') },
      );
      assert.notEqual(lifecycleAttempt.status, 0, 'the lifecycle control must fail loudly');
      assert.match(
        `${lifecycleAttempt.stderr}\n${lifecycleAttempt.stdout}`,
        /sentinel lifecycle executed: postpack/u,
      );
      assert.deepEqual(markerEvents(), ['prepack', 'prepare', 'postpack']);

      resetMarkers();
      const ignoredTarballs = join(temp, 'ignored-tarballs');
      mkdirSync(ignoredTarballs, { recursive: true });
      const ignoredAttempt = runNpm(
        [
          'pack',
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          ignoredTarballs,
          sentinelDirectory,
        ],
        { cwd: packProject, env: sentinelEnv('prepare') },
      );
      assertNpmIgnoreScriptsObservation(
        npmVersionText,
        ignoredAttempt.status,
        `${ignoredAttempt.stderr}\n${ignoredAttempt.stdout}`,
        markerEvents(),
      );

      resetMarkers();
      await assert.rejects(
        startInstalledDependencyRegistry({
          dependencySpecs: { 'missing-lifecycle-sentinel': '1.0.0' },
          npmCli,
          npmEnv: sentinelEnv('prepare'),
          packageRoot,
          scratchDir: join(temp, 'invalid-registry'),
        }),
        /installed production dependency missing-lifecycle-sentinel is missing/u,
      );
      assert.deepEqual(markerEvents(), []);

      const sourceHashBefore = hashReadOnlyTree(sentinelDirectory);
      registry = await startInstalledDependencyRegistry({
        dependencySpecs: { 'npm-pack-lifecycle-sentinel': '1.0.0' },
        npmCli,
        npmEnv: sentinelEnv('prepare'),
        packageRoot,
        scratchDir: join(temp, 'safe-registry'),
      });
      assert.deepEqual(registry.packageVersions, ['npm-pack-lifecycle-sentinel@1.0.0']);
      assert.deepEqual(markerEvents(), [], 'safe dependency packaging must execute no lifecycle');
      assert.equal(hashReadOnlyTree(sentinelDirectory), sourceHashBefore);

      const consumer = join(temp, 'consumer');
      makeIsolatedNpmProject(consumer, 'lifecycle-sentinel-consumer');
      writeFileSync(
        join(consumer, 'package.json'),
        `${JSON.stringify(
          {
            name: 'lifecycle-sentinel-consumer',
            private: true,
            version: '1.0.0',
            dependencies: { 'npm-pack-lifecycle-sentinel': '1.0.0' },
          },
          null,
          2,
        )}\n`,
      );
      const install = await runNpmAsync(
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
        {
          cwd: consumer,
          env: {
            ...localRegistryNpmEnv(envRoot, registry.origin),
            NPM_PACK_SENTINEL_MARKERS: markerDirectory,
            NPM_PACK_SENTINEL_FAIL_EVENT: 'prepare',
          },
        },
      );
      assert.equal(install.status, 0, install.stderr);
      assert.equal(
        await readFile(
          join(consumer, 'node_modules', 'npm-pack-lifecycle-sentinel', 'package.json'),
          'utf8',
        ),
        sentinelManifest,
        'safe packaging must preserve the real script-bearing manifest bytes',
      );
      assert.deepEqual(markerEvents(), []);
      assert.equal(hashReadOnlyTree(sentinelDirectory), sourceHashBefore);
    } finally {
      if (registry !== undefined) await registry.close();
      await rm(temp, { recursive: true, force: true });
      removeIsolatedEnvRoot(envRoot);
    }
  });

  void it('local tarball installs with the expected package files', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pi-bg-pack-'));
    let registry: Awaited<ReturnType<typeof startInstalledDependencyRegistry>> | undefined;
    const packEnvRoot = makeIsolatedEnvRoot('pi-bg-pack-env-');
    const missingEnvRoot = makeIsolatedEnvRoot('pi-bg-missing-env-');
    const installEnvRoot = makeIsolatedEnvRoot('pi-bg-install-env-');
    try {
      const packageJson = await pkg();
      assert.deepEqual(packageJson.dependencies, { turndown: '7.2.4' });
      const realDependencyDirectories = [
        fileURLToPath(new URL('node_modules/turndown/', root)),
        fileURLToPath(new URL('node_modules/@mixmark-io/domino/', root)),
      ];
      const realDependencyHashesBefore = realDependencyDirectories.map(hashReadOnlyTree);
      const sourceTurndownManifest = await readFile(
        new URL('node_modules/turndown/package.json', root),
        'utf8',
      );
      const packCwd = join(temp, 'package-pack-project');
      const packageTarballs = join(temp, 'package-tarballs');
      makeIsolatedNpmProject(packCwd, 'package-pack-project');
      mkdirSync(packageTarballs, { recursive: true });
      const pack = runNpm(
        [
          'pack',
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          packageTarballs,
          fileURLToPath(root),
        ],
        {
          cwd: packCwd,
          env: isolatedNpmEnv(packEnvRoot),
        },
      );
      assert.equal(pack.status, 0, pack.stderr);
      const firstEntry = parsePackEntries(pack.stdout)[0];
      assert.ok(firstEntry, 'npm pack must return one entry');
      const tarballPath = join(packageTarballs, firstEntry.filename);
      assert.ok(existsSync(tarballPath), 'npm pack must write into the isolated destination');

      const missingConsumer = join(temp, 'missing-consumer');
      const seedConsumer = join(temp, 'dependency-seed');
      const installedConsumer = join(temp, 'installed-consumer');
      makeIsolatedNpmProject(missingConsumer, 'missing-input-control');
      makeIsolatedNpmProject(seedConsumer, 'offline-cache-seed');
      makeIsolatedNpmProject(installedConsumer, 'offline-packed-consumer');
      const emptyConsumerManifest = (name: string): string =>
        `${JSON.stringify({ name, private: true, version: '1.0.0' }, null, 2)}\n`;
      await writeFile(
        join(missingConsumer, 'package.json'),
        emptyConsumerManifest('missing-input-control'),
      );
      await writeFile(
        join(installedConsumer, 'package.json'),
        emptyConsumerManifest('offline-packed-consumer'),
      );

      assert.deepEqual(await readdir(join(missingEnvRoot, 'cache')), []);
      const missingInstall = runNpm(
        [
          'install',
          '--legacy-peer-deps',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          tarballPath,
        ],
        { cwd: missingConsumer, env: isolatedNpmEnv(missingEnvRoot) },
      );
      assert.notEqual(missingInstall.status, 0, 'an empty cache must not fake offline success');
      assert.match(`${missingInstall.stderr}\n${missingInstall.stdout}`, /ENOTCACHED/u);
      assert.match(`${missingInstall.stderr}\n${missingInstall.stdout}`, /turndown/u);
      assert.equal(existsSync(join(missingConsumer, 'node_modules', 'turndown')), false);

      assert.deepEqual(await readdir(join(installEnvRoot, 'cache')), []);
      registry = await startInstalledDependencyRegistry({
        dependencySpecs: packageJson.dependencies,
        npmCli,
        npmEnv: isolatedNpmEnv(packEnvRoot),
        packageRoot: fileURLToPath(root),
        scratchDir: join(temp, 'dependency-registry'),
      });
      assert.deepEqual(registry.packageVersions, ['@mixmark-io/domino@2.2.0', 'turndown@7.2.4']);
      assert.deepEqual(
        realDependencyDirectories.map(hashReadOnlyTree),
        realDependencyHashesBefore,
        'dependency archive preparation must leave shared source bytes and modes unchanged',
      );
      await writeFile(
        join(seedConsumer, 'package.json'),
        `${JSON.stringify(
          {
            name: 'offline-cache-seed',
            private: true,
            version: '1.0.0',
            dependencies: packageJson.dependencies,
          },
          null,
          2,
        )}\n`,
      );
      const registryOrigin = registry.origin;
      const preparation = await runNpmAsync(
        [
          'install',
          '--legacy-peer-deps',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
        ],
        {
          cwd: seedConsumer,
          env: localRegistryNpmEnv(installEnvRoot, registryOrigin),
        },
      );
      assert.equal(preparation.status, 0, preparation.stderr);
      assert.ok(existsSync(join(seedConsumer, 'node_modules', 'turndown', 'package.json')));
      assert.ok(
        existsSync(join(seedConsumer, 'node_modules', '@mixmark-io', 'domino', 'package.json')),
      );
      assert.ok(registry.requests.length >= 4, 'cache preparation must read registry inputs');
      assert.deepEqual(
        registry.requests.filter((request) => request.status !== 200),
        [],
        'the deterministic registry must contain the complete production closure',
      );
      for (const requestPath of [
        '/turndown',
        '/@mixmark-io/domino',
        '/tarballs/turndown@7.2.4',
        '/tarballs/@mixmark-io/domino@2.2.0',
      ]) {
        assert.ok(
          registry.requests.some((request) => request.path === requestPath),
          `cache preparation did not request ${requestPath}`,
        );
      }
      await registry.close();
      registry = undefined;
      assert.notDeepEqual(await readdir(join(installEnvRoot, 'cache')), []);

      const install = runNpm(
        [
          'install',
          '--legacy-peer-deps',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          tarballPath,
        ],
        {
          cwd: installedConsumer,
          // The loopback registry is closed. `--offline` must satisfy every
          // registry/tarball read from the explicitly prepared isolated cache.
          env: localRegistryNpmEnv(installEnvRoot, registryOrigin),
        },
      );
      assert.equal(install.status, 0, install.stderr);
      assert.equal(
        existsSync(join(installedConsumer, 'node_modules', '@ravshansbox', 'pi-anthropic-sps')),
        false,
        'packed consumers must not install the retired URL-based sanitizer dependency',
      );

      const installedTurndownManifest = await readFile(
        join(installedConsumer, 'node_modules', 'turndown', 'package.json'),
        'utf8',
      );
      assert.equal(
        installedTurndownManifest,
        sourceTurndownManifest,
        'offline preparation must preserve the real Turndown manifest bytes',
      );
      const turndownManifest = parseJsonValue(installedTurndownManifest);
      const dominoManifest = parseJsonValue(
        await readFile(
          join(installedConsumer, 'node_modules', '@mixmark-io', 'domino', 'package.json'),
          'utf8',
        ),
      );
      assert.ok(isObject(turndownManifest));
      assert.ok(isObject(dominoManifest));
      assert.equal(field(turndownManifest, 'version'), '7.2.4');
      assert.equal(field(dominoManifest, 'version'), '2.2.0');
      const turndownDependencies = field(turndownManifest, 'dependencies');
      assert.ok(isObject(turndownDependencies));
      assert.equal(field(turndownDependencies, '@mixmark-io/domino'), '^2.2.0');
      const turndownScripts = field(turndownManifest, 'scripts');
      assert.ok(isObject(turndownScripts));
      assert.equal(field(turndownScripts, 'prepare'), 'npm run build');

      const load = spawnSync(
        process.execPath,
        [
          '-e',
          [
            "const TurndownService = require('turndown');",
            "const domino = require('@mixmark-io/domino');",
            "if (typeof domino.createWindow !== 'function') throw new Error('domino did not load');",
            "const markdown = new TurndownService().turndown('<h1>Offline</h1><p>closure loaded</p>');",
            "if (!markdown.includes('Offline') || !markdown.includes('closure loaded')) throw new Error(markdown);",
            'process.stdout.write(markdown);',
          ].join('\n'),
        ],
        { cwd: installedConsumer, encoding: 'utf8', env: isolatedNpmEnv(installEnvRoot) },
      );
      assert.equal(load.status, 0, load.stderr);
      assert.match(load.stdout, /Offline/u);
      assert.match(load.stdout, /closure loaded/u);

      assert.deepEqual(
        realDependencyDirectories.map(hashReadOnlyTree),
        realDependencyHashesBefore,
        'offline installation must leave shared dependency source bytes and modes unchanged',
      );

      for (const f of [
        'package.json',
        'BACKGROUND-TASKS-INSTRUCTIONS.md',
        'THIRD_PARTY_NOTICES.md',
        'logo.png',
        'docs/INDEX.md',
        'docs/read-before-edit.md',
        'docs/manifest.json',
        'docs/attestations.json',
        'docs/assets/architecture.svg',
        'docs/assets/footer-dock.svg',
        'docs/assets/logo.svg',
        'extensions/anthropic-attribution-child.ts',
        'extensions/anthropic-attribution.ts',
        'extensions/background-tasks.ts',
        'extensions/fusion-child.ts',
        'src/extension.ts',
        'src/fusion-extension.ts',
        'src/fusion-child-extension.ts',
        'src/core/registry.ts',
        'src/core/anthropic-attribution.ts',
        'src/core/anthropic-attribution-path.ts',
        'src/core/config.ts',
        'src/core/extension-api.ts',
        'src/core/attested-pi-run.ts',
        'src/core/pi-launch.ts',
        'src/core/fusion/orchestrator.ts',
        'src/core/fusion/pi-child.ts',
        'src/core/fusion/child-protocol.ts',
        'src/core/fusion/output-contract.ts',
        'src/core/fusion/result-package.ts',
        'src/ui/background-tasks-manager.ts',
        'src/ui/fusion-model-selector.ts',
      ]) {
        assert.ok(existsSync(join(installedConsumer, 'node_modules', 'pi-background-tasks', f)), f);
      }
    } finally {
      if (registry !== undefined) await registry.close();
      await rm(temp, { recursive: true, force: true });
      removeIsolatedEnvRoot(packEnvRoot);
      removeIsolatedEnvRoot(missingEnvRoot);
      removeIsolatedEnvRoot(installEnvRoot);
    }
  });
});
