import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseJsonText } from '../src/core/common.js';
import { isolatedTestEnv } from '../tests/helpers/normalize.js';
import { installFusionFakePi, resolveRealPiCli } from '../tests/helpers/fusion-fake-pi.js';

const requiredVersions = ['0.81.1', '0.82.1', '0.83.0', '0.84.0'] as const;
type RequiredPiVersion = (typeof requiredVersions)[number];
// `URL.pathname` yields `/D:/...` on Windows, which then joins into `D:\D:\...`.
const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * TypeBox APIs removed in the 1.3.x line bundled by Pi 0.83.0 and 0.84.0. The
 * package must not reference these in source or in the packed tarball bytes.
 */
const REMOVED_TYPEBOX_APIS = [
  'Type.Base',
  'Type.Awaited',
  'Type.Promise',
  'Type.AsyncIterator',
  'Type.Iterator',
  'Type.Options',
  'Value.Mutate',
] as const;

/** Pi bundles typebox, so it must be a peer dependency with the documented "*" range. */
function verifyTypeBoxPeerPosture(): void {
  const manifest = parseJsonText(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!isRecord(manifest)) throw new Error('package.json must be an object');
  const peers = manifest['peerDependencies'];
  if (!isRecord(peers)) throw new Error('package.json peerDependencies must be an object');
  if (peers['typebox'] !== '*') {
    throw new Error(
      `typebox must be declared as a "*" peer dependency per Pi package rules, saw ${String(peers['typebox'])}`,
    );
  }
  if (peers['@earendil-works/pi-ai'] !== '*') {
    throw new Error(
      `@earendil-works/pi-ai must be declared as a host-provided "*" peer, saw ${String(peers['@earendil-works/pi-ai'])}`,
    );
  }
  for (const key of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
    const range = peers[key];
    if (typeof range !== 'string') {
      throw new Error(`${key} peer range must be a string, saw ${String(range)}`);
    }
    for (const version of requiredVersions) {
      if (!range.includes(version)) {
        throw new Error(`${key} peer range must declare Pi ${version} support, saw ${range}`);
      }
    }
  }
  const deps = manifest['dependencies'];
  if (isRecord(deps) && deps['typebox'] !== undefined)
    throw new Error('typebox must not be a runtime dependency; Pi bundles it');
  if (isRecord(deps) && deps['@earendil-works/pi-ai'] !== undefined)
    throw new Error('@earendil-works/pi-ai must not be a private runtime dependency');
  const bundled = manifest['bundledDependencies'];
  if (Array.isArray(bundled) && bundled.includes('typebox'))
    throw new Error('typebox must never be bundled');
  if (Array.isArray(bundled) && bundled.includes('@earendil-works/pi-ai'))
    throw new Error('@earendil-works/pi-ai must never be bundled');
}

interface PackFileEntry {
  filename: string;
}

interface RpcSessionStats {
  sessionFile: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number`);
  return value;
}

function parseRpcSessionStats(value: unknown): RpcSessionStats {
  if (!isRecord(value)) throw new Error('RPC session stats must be an object');
  const tokens = value['tokens'];
  if (!isRecord(tokens)) throw new Error('RPC session stats.tokens must be an object');
  return {
    sessionFile: requireString(value['sessionFile'], 'RPC session stats.sessionFile'),
    tokens: {
      input: requireNumber(tokens['input'], 'RPC session stats.tokens.input'),
      output: requireNumber(tokens['output'], 'RPC session stats.tokens.output'),
      cacheRead: requireNumber(tokens['cacheRead'], 'RPC session stats.tokens.cacheRead'),
      cacheWrite: requireNumber(tokens['cacheWrite'], 'RPC session stats.tokens.cacheWrite'),
      total: requireNumber(tokens['total'], 'RPC session stats.tokens.total'),
    },
    cost: requireNumber(value['cost'], 'RPC session stats.cost'),
  };
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, NPM_CONFIG_CACHE: env['NPM_CONFIG_CACHE'] ?? '/tmp/pi-npm-cache' },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

async function runRpcSessionStats(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  prompt?: string,
): Promise<RpcSessionStats> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stdoutDiagnostic = '';
    let stderrDiagnostic = '';
    let stats: RpcSessionStats | undefined;
    let statsRequested = false;
    let agentEndCount = 0;
    let settled = false;
    const appendDiagnostic = (current: string, chunk: string): string =>
      `${current}${chunk}`.slice(-64 * 1024);
    const finish = (error: Error | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill('SIGTERM');
      if (error !== undefined) reject(error);
      else if (stats === undefined) reject(new Error('RPC process closed without session stats'));
      else resolve(stats);
    };
    const requestStats = () => {
      if (statsRequested) return;
      statsRequested = true;
      child.stdin.write(`${JSON.stringify({ type: 'get_session_stats', id: 'compat-stats' })}\n`);
    };
    const processLine = (line: string) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = parseJsonText(line);
      } catch (error) {
        finish(
          new Error(
            `RPC emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}\n${line.slice(0, 1000)}`,
          ),
        );
        return;
      }
      if (!isRecord(parsed)) {
        finish(new Error(`RPC emitted a non-object frame: ${line.slice(0, 1000)}`));
        return;
      }
      if (prompt !== undefined && parsed['type'] === 'agent_end') {
        agentEndCount += 1;
        if (agentEndCount >= 2) requestStats();
      }
      if (
        parsed['type'] === 'response' &&
        parsed['command'] === 'get_session_stats' &&
        parsed['id'] === 'compat-stats'
      ) {
        if (parsed['success'] !== true) {
          finish(new Error(`get_session_stats failed: ${line.slice(0, 1000)}`));
          return;
        }
        try {
          stats = parseRpcSessionStats(parsed['data']);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        child.kill('SIGTERM');
      }
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          `RPC session stats timed out\nstdout:\n${stdoutDiagnostic}\nstderr:\n${stderrDiagnostic}`,
        ),
      );
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdoutDiagnostic = appendDiagnostic(stdoutDiagnostic, text);
      stdoutBuffer += text;
      if (stdoutBuffer.length > 2 * 1024 * 1024) {
        finish(new Error('RPC emitted a line larger than 2 MiB'));
        return;
      }
      for (;;) {
        const newline = stdoutBuffer.indexOf('\n');
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        processLine(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrDiagnostic = appendDiagnostic(stderrDiagnostic, chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      finish(error);
    });
    child.on('close', (code, signal) => {
      if (stats !== undefined) {
        finish(undefined);
        return;
      }
      finish(
        new Error(
          `RPC process exited ${code === null ? 'null' : String(code)} (${signal ?? 'no signal'}) before stats\nstdout:\n${stdoutDiagnostic}\nstderr:\n${stderrDiagnostic}`,
        ),
      );
    });
    if (prompt === undefined) requestStats();
    else
      child.stdin.write(
        `${JSON.stringify({ type: 'prompt', message: prompt, id: 'compat-fusion-prompt' })}\n`,
      );
  });
}

async function runRpcPromptUntil(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  prompt: string,
  expected: RegExp,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error: Error | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      if (error === undefined) resolve(stdout);
      else reject(error);
    };
    const timer = setTimeout(() => {
      finish(new Error(`RPC prompt timed out\n${stdout}\n${stderr}`));
    }, 20_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (expected.test(stdout)) finish(undefined);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish(error);
    });
    child.on('close', (code) => {
      if (!settled && code !== 0)
        finish(
          new Error(
            `RPC prompt exited ${code === null ? 'null' : String(code)}\n${stdout}\n${stderr}`,
          ),
        );
    });
    child.stdin.write(
      `${JSON.stringify({ type: 'prompt', message: prompt, id: 'compat-rpc-prompt' })}\n`,
    );
  });
}

async function readPersistedFusionToolResult(
  sessionFile: string,
): Promise<Record<string, unknown>> {
  const lines = (await readFile(sessionFile, 'utf8')).split('\n').filter(Boolean);
  for (const line of lines) {
    const entry = parseJsonText(line);
    if (!isRecord(entry) || entry['type'] !== 'message') continue;
    const message = entry['message'];
    if (
      isRecord(message) &&
      message['role'] === 'toolResult' &&
      message['toolName'] === 'bg_result'
    ) {
      return message;
    }
  }
  throw new Error('persisted session is missing the bg_result Fusion tool result');
}

function parsePack(text: string): PackFileEntry {
  const trimmed = text.trim();
  const arrayStart = trimmed.startsWith('[') ? 0 : text.lastIndexOf('\n[') + 1;
  if (arrayStart <= 0 && !trimmed.startsWith('[')) {
    throw new Error(
      `npm pack output must end with a JSON array; received ${JSON.stringify(text.slice(0, 160))}`,
    );
  }
  const parsed = parseJsonText(arrayStart === 0 ? trimmed : text.slice(arrayStart).trim());
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('npm pack JSON output must contain exactly one package entry');
  }
  const first = parsed[0];
  if (!isRecord(first)) throw new Error('npm pack JSON entry must be an object');
  return { filename: requireString(first['filename'], 'pack filename') };
}

/**
 * Recursively scan installed package source for TypeBox APIs removed in 1.3.x.
 * This runs against the *installed* (packed) bytes, not the working tree, so a
 * removed API cannot reach users through the tarball.
 */
async function assertNoRemovedTypeBoxApis(packageDir: string, label: string): Promise<void> {
  const stack = [packageDir];
  let scanned = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') stack.push(path);
        continue;
      }
      if (!/\.(?:ts|js|mjs|cjs|json|md)$/.test(entry.name)) continue;
      const text = await readFile(path, 'utf8');
      scanned += 1;
      for (const api of REMOVED_TYPEBOX_APIS) {
        // Match real member access, not prose mentioning the identifier.
        if (new RegExp(`\\b${api.replace('.', '\\.')}\\s*\\(`).test(text)) {
          throw new Error(`${label}: packed file ${path} uses removed TypeBox API ${api}`);
        }
      }
    }
  }
  if (scanned === 0) throw new Error(`${label}: scanned no packed files`);
}

function assertBundledTypeBox(temp: string, version: string, expectedRange: string): void {
  // The package must resolve Pi's bundled typebox, never a private copy.
  const nested = join(temp, 'node_modules', 'pi-background-tasks', 'node_modules', 'typebox');
  if (existsSync(nested))
    throw new Error(
      `Pi ${version}: package must not ship or install a private typebox at ${nested}`,
    );
  const hoisted = join(temp, 'node_modules', 'typebox', 'package.json');
  if (!existsSync(hoisted)) throw new Error(`Pi ${version}: typebox peer was not installed`);
  const parsed = parseJsonText(readFileSync(hoisted, 'utf8'));
  if (!isRecord(parsed)) throw new Error('typebox package.json must be an object');
  const installed = requireString(parsed['version'], 'typebox version');
  if (!installed.startsWith(expectedRange))
    throw new Error(`Pi ${version}: expected typebox ${expectedRange}x, resolved ${installed}`);
  console.log(`  Pi ${version}: typebox ${installed} (peer, not bundled)`);
}

/** Fusion requires both terminal settlement and final provider-payload interception. */
function assertFusionLifecycleHookSupport(temp: string, version: string): void {
  const typesPath = join(
    temp,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'core',
    'extensions',
    'types.d.ts',
  );
  if (!existsSync(typesPath)) {
    throw new Error(`Pi ${version}: extension event declarations are missing at ${typesPath}`);
  }
  const declarations = readFileSync(typesPath, 'utf8');
  if (!declarations.includes('agent_settled')) {
    throw new Error(`Pi ${version}: agent_settled is required for terminal Fusion audit sealing`);
  }
  if (!declarations.includes('before_provider_request')) {
    throw new Error(
      `Pi ${version}: before_provider_request is required for Fusion runtime context governance`,
    );
  }
}

/** Every supported Pi line must expose native Anthropic breakpoints for Fusion to normalize. */
function assertAnthropicCacheAdapterSupport(temp: string, version: string): void {
  const candidates = [
    join(temp, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'api', 'anthropic-messages.js'),
    join(
      temp,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'node_modules',
      '@earendil-works',
      'pi-ai',
      'dist',
      'api',
      'anthropic-messages.js',
    ),
  ];
  const adapterPath = candidates.find((path) => existsSync(path));
  if (adapterPath === undefined) {
    throw new Error(`Pi ${version}: installed Anthropic adapter source is missing`);
  }
  const source = readFileSync(adapterPath, 'utf8');
  for (const required of [
    'cache_control',
    'supportsLongCacheRetention',
    'supportsCacheControlOnTools',
    'PI_CACHE_RETENTION',
  ]) {
    if (!source.includes(required)) {
      throw new Error(`Pi ${version}: Anthropic adapter lacks required cache contract ${required}`);
    }
  }
}

/** Exact TypeBox line bundled by each supported Pi release. */
const TYPEBOX_BY_PI_VERSION: Record<
  RequiredPiVersion,
  { readonly spec: string; readonly prefix: string }
> = {
  '0.81.1': { spec: 'typebox@~1.1.38', prefix: '1.1.' },
  '0.82.1': { spec: 'typebox@~1.1.38', prefix: '1.1.' },
  '0.83.0': { spec: 'typebox@1.3.7', prefix: '1.3.' },
  '0.84.0': { spec: 'typebox@1.3.7', prefix: '1.3.' },
};

function expectedTypeBoxLine(
  version: RequiredPiVersion,
): (typeof TYPEBOX_BY_PI_VERSION)[RequiredPiVersion] {
  return TYPEBOX_BY_PI_VERSION[version];
}

const HOOK_CONTRACT_PROBE_FILES = [
  'hook-contract-provider.ts',
  'hook-probe-extension.ts',
  'hook-probe-a.ts',
  'hook-probe-b.ts',
] as const;

type ContextAbortMode = 'stream_skipped' | 'aborted_signal';

interface ProviderCallProbeRecord {
  readonly hook: 'provider_call';
  readonly signalAborted?: unknown;
}

function isProviderCallProbeRecord(value: unknown): value is ProviderCallProbeRecord {
  return isRecord(value) && value['hook'] === 'provider_call';
}

/** Pin the transport-blocking context-abort behavior of every supported Pi line. */
async function assertDelegateContextAbortSupport(
  temp: string,
  cli: string,
  version: RequiredPiVersion,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const probeDir = join(temp, 'hook-contract-probe');
  await mkdir(probeDir, { recursive: true });
  await Promise.all(
    HOOK_CONTRACT_PROBE_FILES.map((file) =>
      copyFile(join(root, 'tests', 'scripted-provider', file), join(probeDir, file)),
    ),
  );
  const logPath = join(temp, 'hook-contract-probe.jsonl');
  const args = [
    cli,
    '--mode',
    'text',
    '--no-extensions',
    '-e',
    join(probeDir, 'hook-contract-provider.ts'),
    '-e',
    join(probeDir, 'hook-probe-a.ts'),
    '-e',
    join(probeDir, 'hook-probe-b.ts'),
    '--offline',
    '--no-tools',
    '--no-session',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--provider',
    'pi-bg-hook-contract',
    '--model',
    'hook-contract-model',
    '-p',
    'probe the context abort path',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: temp,
    encoding: 'utf8',
    env: {
      ...env,
      PI_BG_HOOK_PROBE_MODE: 'context-abort',
      PI_BG_HOOK_PROBE_LOG: logPath,
      PI_BG_HOOK_PROBE_TOOL: '0',
      PI_BG_HOOK_CONTRACT_API_KEY: 'hook-contract-api-key',
    },
  });
  if (result.error !== undefined) {
    throw new Error(`Pi ${version}: context-abort probe failed to spawn`, { cause: result.error });
  }
  const records = (await readFile(logPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => parseJsonText(line));
  if (
    records.filter((record) => isRecord(record) && record['hook'] === 'context_aborting').length !==
    1
  ) {
    throw new Error(`Pi ${version}: context-abort probe did not execute exactly once`);
  }
  const providerCalls = records.filter(isProviderCallProbeRecord);
  let mode: ContextAbortMode;
  if (providerCalls.length === 0) {
    mode = 'stream_skipped';
  } else if (providerCalls.length === 1 && providerCalls[0]?.signalAborted === true) {
    mode = 'aborted_signal';
  } else {
    throw new Error(
      `Pi ${version}: ctx.abort() neither skipped stream invocation nor produced exactly one already-aborted provider call`,
    );
  }
  const expected: ContextAbortMode = version === '0.84.0' ? 'stream_skipped' : 'aborted_signal';
  if (mode !== expected) {
    throw new Error(`Pi ${version}: expected context-abort mode ${expected}, observed ${mode}`);
  }
  const expectedStatus = mode === 'stream_skipped' ? 1 : 0;
  if (result.status !== expectedStatus) {
    throw new Error(
      `Pi ${version}: context-abort probe exited ${String(result.status)} instead of ${String(expectedStatus)} for ${mode}\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (
    mode === 'stream_skipped' &&
    !`${result.stdout}\n${result.stderr}`.toLowerCase().includes('aborted')
  ) {
    throw new Error(`Pi ${version}: skipped context-abort probe lacked an abort diagnostic`);
  }
  console.log(
    `  Pi ${version}: context abort blocks transport via ${mode} (exit ${String(result.status)})`,
  );
}

async function smokeVersion(version: RequiredPiVersion, tarballPath: string): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), `pi-bg-compat-${version}-`));
  const typebox = expectedTypeBoxLine(version);
  try {
    run('npm', ['init', '-y'], temp);
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        tarballPath,
        `@earendil-works/pi-coding-agent@${version}`,
        `@earendil-works/pi-tui@${version}`,
        typebox.spec,
      ],
      temp,
    );
    assertBundledTypeBox(temp, version, typebox.prefix);
    assertFusionLifecycleHookSupport(temp, version);
    assertAnthropicCacheAdapterSupport(temp, version);
    await assertNoRemovedTypeBoxApis(
      join(temp, 'node_modules', 'pi-background-tasks'),
      `Pi ${version}`,
    );
    const cli = join(temp, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js');
    const extension = join(
      temp,
      'node_modules',
      'pi-background-tasks',
      'extensions',
      'background-tasks.ts',
    );
    if (!existsSync(cli)) throw new Error(`Pi CLI not installed for ${version}: ${cli}`);
    if (!existsSync(extension))
      throw new Error(`package extension missing for ${version}: ${extension}`);
    const agentDir = join(temp, 'agent');
    await mkdir(agentDir, { recursive: true });
    const fake = await installFusionFakePi(temp, { mergedText: `compat fusion ${version}` });
    const scriptedProviderPath = join(
      root,
      'tests',
      'scripted-provider',
      'scripted-provider-extension.ts',
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...isolatedTestEnv,
      PATH: `${fake.binDir}:${process.env['PATH'] ?? ''}`,
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: join(temp, 'sessions'),
      PI_BG_SCRIPTED_API_KEY: 'scripted-api-key',
      PI_BG_SCRIPTED_SCENARIO: 'display-only-bg',
    };
    await assertDelegateContextAbortSupport(temp, cli, version, env);
    run(
      process.execPath,
      [
        cli,
        '--no-extensions',
        '-e',
        extension,
        '--offline',
        '--no-tools',
        '--no-session',
        '-p',
        '/jobs',
      ],
      temp,
      env,
    );
    await runRpcPromptUntil(
      process.execPath,
      [
        cli,
        '--mode',
        'rpc',
        '--no-extensions',
        '-e',
        scriptedProviderPath,
        '-e',
        extension,
        '--offline',
        '--no-tools',
        '--no-session',
        '--model',
        'pi-bg-scripted/scripted-model',
      ],
      temp,
      env,
      '/fusion compatibility prompt',
      /background-task-notification.*completed/s,
    );
    const childCalls = await readFile(fake.logPath, 'utf8');
    const childCallRecords =
      childCalls.trim().length === 0
        ? []
        : childCalls
            .trim()
            .split('\n')
            .map((line) => parseJsonText(line));
    if (childCallRecords.length !== 5)
      throw new Error(
        `Fusion compatibility expected five child calls for ${version}, saw ${String(childCallRecords.length)}`,
      );
    const candidates = childCallRecords.filter(
      (record) => isRecord(record) && record['stage'] === 'candidate',
    );
    const adjudicators = childCallRecords.filter(
      (record) => isRecord(record) && record['stage'] !== 'candidate',
    );
    if (candidates.length !== 3 || adjudicators.length !== 2)
      throw new Error(`Fusion compatibility stage split drifted for ${version}`);
    for (const record of candidates) {
      if (!isRecord(record) || !Array.isArray(record['args']))
        throw new Error(`Fusion compatibility candidate argv missing for ${version}`);
      const args = record['args'];
      if (!args.includes('--no-tools') || args.includes('--no-builtin-tools'))
        throw new Error(
          `Fusion compatibility /fusion candidate is not reason/no-tools for ${version}`,
        );
    }
    for (const record of adjudicators) {
      if (
        !isRecord(record) ||
        !Array.isArray(record['args']) ||
        !record['args'].includes('--no-tools')
      )
        throw new Error(`Fusion compatibility adjudicator is not no-tools for ${version}`);
    }
    await runRpcPromptUntil(
      process.execPath,
      [
        cli,
        '--mode',
        'rpc',
        '--no-extensions',
        '-e',
        extension,
        '--offline',
        '--no-tools',
        '--no-session',
        '--no-skills',
        '--no-prompt-templates',
        '--no-context-files',
      ],
      temp,
      env,
      '/fusion-models',
      /requires Pi TUI mode/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function verifyCurrentHostFusionUsage(): Promise<string> {
  const realPi = resolveRealPiCli();
  if (realPi === undefined)
    throw new Error('BUG-182 current-host Fusion usage test requires pi on PATH');
  const version = run(realPi, ['--version'], root).trim();
  const temp = await mkdtemp(join(tmpdir(), 'pi-bg-current-host-usage-'));
  try {
    const agentDir = join(temp, 'agent');
    const sessionDir = join(temp, 'sessions');
    await Promise.all([
      mkdir(agentDir, { recursive: true }),
      mkdir(sessionDir, { recursive: true }),
    ]);
    const fake = await installFusionFakePi(temp, { mergedText: 'host usage fused answer' });
    const scriptedProviderPath = join(
      root,
      'tests',
      'scripted-provider',
      'scripted-provider-extension.ts',
    );
    const extension = join(root, 'extensions', 'background-tasks.ts');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...isolatedTestEnv,
      PATH: `${fake.binDir}:${process.env['PATH'] ?? ''}`,
      PI_CODING_AGENT_DIR: agentDir,
      PI_BG_SCRIPTED_API_KEY: 'scripted-api-key',
      PI_BG_SCRIPTED_SCENARIO: 'fusion-reason',
      PI_BG_SCRIPTED_EVENTS: join(temp, 'provider-events.jsonl'),
    };
    const rpcArgs = [
      '--mode',
      'rpc',
      '--no-extensions',
      '-e',
      scriptedProviderPath,
      '-e',
      extension,
      '--offline',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--session-dir',
      sessionDir,
      '--model',
      'pi-bg-scripted/scripted-model',
    ];
    const stats = await runRpcSessionStats(
      realPi,
      rpcArgs,
      temp,
      env,
      'Use fusion for the current-host usage contract test.',
    );
    const expectedTokens = {
      input: 95,
      output: 55,
      cacheRead: 10,
      cacheWrite: 15,
      total: 175,
    };
    const persistedToolResult = await readPersistedFusionToolResult(stats.sessionFile);
    const persistedUsage = persistedToolResult['usage'];
    const expectedUsage = {
      input: 55,
      output: 35,
      cacheRead: 10,
      cacheWrite: 15,
      totalTokens: 115,
      cost: {
        input: 0.005,
        output: 0.01,
        cacheRead: 0.015,
        cacheWrite: 0.02,
        total: 0.05,
      },
    };
    if (!isDeepStrictEqual(persistedUsage, expectedUsage)) {
      throw new Error(
        `Current Pi ${version} persisted invalid Fusion usage: ${JSON.stringify(persistedUsage)}; toolResult=${JSON.stringify(persistedToolResult).slice(0, 4000)}`,
      );
    }
    if (!isDeepStrictEqual(stats.tokens, expectedTokens)) {
      throw new Error(
        `Current Pi ${version} Fusion stats tokens mismatch: ${JSON.stringify(stats.tokens)}`,
      );
    }
    if (Math.abs(stats.cost - 0.05) > 1e-12) {
      throw new Error(`Current Pi ${version} Fusion stats cost mismatch: ${String(stats.cost)}`);
    }
    const replay = await runRpcSessionStats(
      realPi,
      [...rpcArgs, '--session', stats.sessionFile],
      temp,
      env,
    );
    if (
      !isDeepStrictEqual(replay.tokens, stats.tokens) ||
      Math.abs(replay.cost - stats.cost) > 1e-12
    ) {
      throw new Error(`Current Pi ${version} replayed Fusion session stats do not match`);
    }
    return version;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

verifyTypeBoxPeerPosture();
const pack = parsePack(run('npm', ['pack', '--json'], root));
const tarballPath = join(root, pack.filename);
try {
  for (const version of requiredVersions) await smokeVersion(version, tarballPath);
  const currentHostVersion = await verifyCurrentHostFusionUsage();
  console.log(
    `Smoke-loaded pi-background-tasks against Pi ${requiredVersions.join(', ')}; current host ${currentHostVersion} persisted and replayed full Fusion usage`,
  );
} finally {
  await rm(tarballPath, { force: true });
}
