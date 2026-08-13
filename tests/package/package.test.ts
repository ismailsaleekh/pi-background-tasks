import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseJsonText } from '../../src/core/common.js';
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

function runNpm(
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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
  return rootDir;
}

function removeIsolatedEnvRoot(rootDir: string): void {
  rmSync(rootDir, { recursive: true, force: true });
}

function isolatedNpmEnv(rootDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: join(rootDir, 'home'),
    USERPROFILE: join(rootDir, 'home'),
    XDG_CONFIG_HOME: join(rootDir, 'config'),
    NPM_CONFIG_CACHE: join(rootDir, 'cache'),
    NPM_CONFIG_USERCONFIG: join(rootDir, 'npmrc'),
    NPM_CONFIG_REGISTRY: 'http://127.0.0.1.invalid/',
    npm_config_cache: join(rootDir, 'cache'),
    npm_config_userconfig: join(rootDir, 'npmrc'),
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    CI: '1',
  };
}

function offlineNpmEnv(rootDir: string): NodeJS.ProcessEnv {
  const env = isolatedNpmEnv(rootDir);
  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  const cache =
    process.env['NPM_CONFIG_CACHE'] ?? (home === undefined ? undefined : join(home, '.npm'));
  if (cache === undefined)
    throw new Error('npm cache path is required for offline package install');
  env['NPM_CONFIG_CACHE'] = cache;
  env['npm_config_cache'] = cache;
  env['NPM_CONFIG_REGISTRY'] = 'https://registry.npmjs.org/';
  return env;
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
      './extensions/anthropic-attribution.ts',
      './extensions/background-tasks.ts',
    ]);
    assert.equal(
      p.pi.image,
      'https://raw.githubusercontent.com/ismailsaleekh/pi-background-tasks/main/logo.png',
    );
    assert.match(p.scripts['test:agent-loop'] ?? '', /scripted-provider/);
    assert.match(p.scripts['test:full'] ?? '', /test:agent-loop/);
    assert.match(p.scripts['test:compat'] ?? '', /test-compat/);
    assert.match(p.scripts['test:pnpm-pack'] ?? '', /test-pnpm-pack-install/);
    assert.ok(p.files.includes('extensions/'));
    assert.ok(p.files.includes('src/'));
    assert.ok(p.files.includes('docs/'));
    assert.ok(p.files.includes('BACKGROUND-TASKS-INSTRUCTIONS.md'));
    assert.ok(p.files.includes('THIRD_PARTY_NOTICES.md'));
    assert.ok(p.files.includes('logo.png'));
    assert.ok(!p.files.includes('scripts/'));
    assert.equal(p.scripts['docs:generate'], 'node scripts/docs/generate.mjs');
    assert.equal(p.scripts['docs:verify'], 'node scripts/docs/verify.mjs');
    assert.match(p.scripts['prepack'] ?? '', /docs:verify/);
    assert.match(p.scripts['prepack'] ?? '', /payload:check/);
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
      'src/core/attested-pi-run.ts',
      'src/core/anthropic-attribution.ts',
      'src/core/anthropic-attribution-path.ts',
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
      'extensions/anthropic-attribution.ts',
      'extensions/background-tasks.ts',
      'extensions/fusion-child.ts',
      'extensions/delegate-child.ts',
    ])
      assert.ok(existsSync(new URL(f, root)), f);

    const extensionSource = await text('src/extension.ts');
    assert.match(extensionSource, /registerFusionExtension\(pi, \{/);
    assert.match(extensionSource, /registerDelegateExtension\(pi, \{/);
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
    assert.match(resultExtension, /usage: cloneFusionUsage\(verified\.details\.usage\)/);
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
    assert.match(resultExtension, /await readFusionFailureResult/);
    assert.match(resultExtension, /delivery: 'none'/);
    assert.match(resultExtension, /await readFusionCommittedResult/);
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
      resultExtension.indexOf('await readFusionFailureResult') <
        resultExtension.indexOf('await deps.claimFusionUsage(task)'),
      'failed retrieval must return before committed-result usage can be claimed',
    );
    assert.ok(
      resultExtension.indexOf('await readFusionCommittedResult') <
        resultExtension.indexOf('await deps.claimFusionUsage(task)'),
      'verification must finish before the once-only usage claim',
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

  void it('converts file URLs to native paths instead of using URL.pathname', async () => {
    // On Windows `new URL(...).pathname` yields `/D:/a/repo/`, and joining that
    // produces `D:\D:\a\repo\...`, which fails with ENOENT. CI proved this.
    // `fileURLToPath` is the only correct conversion.
    const roots = ['src', 'extensions', 'scripts', 'tests'];
    const offenders: string[] = [];
    for (const rootDir of roots) {
      const dir = fileURLToPath(new URL(`${rootDir}/`, root));
      if (!existsSync(dir)) continue;
      for (const file of await walkSourceTree(dir)) {
        const source = await readFile(file, 'utf8');
        const stripped = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter((line) => !line.trim().startsWith('//'))
          .join('\n');
        // Matches both the inline form new URL(...).pathname and the indirect
        // form where the URL is bound to a variable and read later. The indirect
        // form previously escaped this guard and reached Windows CI.
        const inlinePathname = /new URL\([^)]*\)\s*\.pathname/.test(stripped);
        const urlBindings = [...stripped.matchAll(/\b(\w+)\s*=\s*new URL\(/g)].map(
          (match) => match[1],
        );
        const indirectPathname = urlBindings.some(
          (binding) =>
            binding !== undefined && new RegExp(`\\b${binding}\\s*\\.pathname\\b`).test(stripped),
        );
        if (inlinePathname || indirectPathname) offenders.push(file);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'use fileURLToPath(new URL(...)) so Windows paths resolve correctly',
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
    const r = runNpm(['pack', '--dry-run', '--json'], {
      cwd: fileURLToPath(root),
      env: isolatedNpmEnv(envRoot),
    });
    removeIsolatedEnvRoot(envRoot);
    assert.equal(r.status, 0, r.stderr);
    const firstEntry = parsePackEntries(r.stdout)[0];
    assert.ok(firstEntry, 'npm pack must return one entry');
    const files = firstEntry.files.map((file) => file.path).sort();
    for (const f of [
      'extensions/anthropic-attribution.ts',
      'extensions/background-tasks.ts',
      'extensions/fusion-child.ts',
      'src/extension.ts',
      'src/fusion-child-extension.ts',
      'src/core/common.ts',
      'src/core/registry.ts',
      'src/core/anthropic-attribution.ts',
      'src/core/anthropic-attribution-path.ts',
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
    assert.ok(!files.some((f) => f.startsWith('tests/')), 'tests must not ship');
    assert.ok(!files.some((f) => f.startsWith('scripts/')), 'release-only scripts must not ship');
    assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules must not ship');
    assert.ok(!files.some((f) => f.endsWith('.tgz')), 'nested tarballs must not ship');
  });

  void it('local tarball installs with the expected package files', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pi-bg-pack-'));
    let tarball: URL | undefined;
    const packEnvRoot = makeIsolatedEnvRoot('pi-bg-pack-env-');
    const installEnvRoot = makeIsolatedEnvRoot('pi-bg-install-env-');
    try {
      const pack = runNpm(['pack', '--json'], {
        cwd: fileURLToPath(root),
        env: isolatedNpmEnv(packEnvRoot),
      });
      assert.equal(pack.status, 0, pack.stderr);
      const firstEntry = parsePackEntries(pack.stdout)[0];
      assert.ok(firstEntry, 'npm pack must return one entry');
      tarball = new URL(firstEntry.filename, root);
      // fileURLToPath, never pathname: on Windows pathname yields a leading-slash
      // form such as /D:/... which is not a usable native path.
      const tarballPath = fileURLToPath(tarball);
      const init = runNpm(['init', '-y'], {
        cwd: temp,
        env: isolatedNpmEnv(installEnvRoot),
      });
      assert.equal(init.status, 0, init.stderr);
      const install = runNpm(
        [
          'install',
          '--legacy-peer-deps',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          tarballPath,
        ],
        {
          cwd: temp,
          env: offlineNpmEnv(installEnvRoot),
        },
      );
      assert.equal(install.status, 0, install.stderr);
      assert.equal(
        existsSync(join(temp, 'node_modules', '@ravshansbox', 'pi-anthropic-sps')),
        false,
        'packed consumers must not install the retired URL-based sanitizer dependency',
      );
      assert.ok(
        existsSync(join(temp, 'node_modules', 'turndown', 'package.json')),
        'packed consumers must install the markdown extraction production dependency',
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
        'extensions/anthropic-attribution.ts',
        'extensions/background-tasks.ts',
        'extensions/fusion-child.ts',
        'src/extension.ts',
        'src/fusion-extension.ts',
        'src/fusion-child-extension.ts',
        'src/core/registry.ts',
        'src/core/anthropic-attribution.ts',
        'src/core/anthropic-attribution-path.ts',
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
        assert.ok(existsSync(join(temp, 'node_modules', 'pi-background-tasks', f)), f);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
      removeIsolatedEnvRoot(packEnvRoot);
      removeIsolatedEnvRoot(installEnvRoot);
      if (tarball) await rm(tarball, { force: true });
    }
  });
});
