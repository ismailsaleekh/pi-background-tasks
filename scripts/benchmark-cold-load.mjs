#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform, release, type } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKER = join(here, 'benchmark-cold-load-worker.mjs');
const SCENARIOS = Object.freeze([
  'delegate-facade-import',
  'fusion-facade-import',
  'sdk-no-extension-load',
  'sdk-process-only-load',
  'sdk-default-load',
  'delegate-first',
  'fusion-first',
  'model-selector-first',
]);

function parseArgs(argv) {
  const out = { samples: 30, warmups: 1, worker: DEFAULT_WORKER, runtime: 'source' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--root' && value) out.root = resolve(value);
    else if (key === '--output' && value) out.output = resolve(value);
    else if (key === '--label' && value) out.label = value;
    else if (key === '--samples' && value) out.samples = Number(value);
    else if (key === '--warmups' && value) out.warmups = Number(value);
    else if (key === '--worker' && value) out.worker = resolve(value);
    else if (key === '--node' && value) out.node = resolve(value);
    else if (key === '--scratch' && value) out.scratch = resolve(value);
    else if (key === '--runtime' && value) out.runtime = value;
    else if (key === '--scenarios' && value) out.scenarios = value.split(',').filter(Boolean);
    else if (key === '--help') out.help = true;
    else throw new Error(`unknown or incomplete argument: ${key ?? '(missing)'}`);
    if (key !== '--help') index += 1;
  }
  if (out.help) return out;
  if (!out.root || !out.output || !out.label) {
    throw new Error('required: --root <package> --output <json> --label <baseline|candidate>');
  }
  if (!Number.isSafeInteger(out.samples) || out.samples < 1) throw new Error('--samples must be a positive integer');
  if (!Number.isSafeInteger(out.warmups) || out.warmups < 0) throw new Error('--warmups must be a non-negative integer');
  if (out.runtime !== 'source' && out.runtime !== 'compiled') throw new Error('--runtime must be source or compiled');
  out.node ??= process.execPath;
  out.scratch ??= join(dirname(out.output), `benchmark-${out.label}-scratch`);
  out.scenarios ??= [...SCENARIOS];
  for (const scenario of out.scenarios) {
    if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  }
  return out;
}

function help() {
  console.log(`Usage: node scripts/benchmark-cold-load.mjs \\
  --root <package-root> --label <baseline|candidate> --output <receipt.json> \\
  [--samples 30] [--warmups 1] [--node /path/to/node] [--scratch /owned/path] \\
  [--runtime source|compiled] [--scenarios sdk-process-only-load,...]

Cold means a fresh Node process with an empty JS/Jiti module cache. It does not
flush the host filesystem cache. Timing is evidence only; there is no CI threshold.`);
}

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out: ${command} ${args.join(' ')}`));
    }, options.timeoutMs ?? 120_000);
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString('utf8');
      const diagnostic = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new Error(`command failed (${String(code)}/${String(signal)}): ${command} ${args.join(' ')}\n${diagnostic.slice(-4000)}\n${output.slice(-2000)}`));
        return;
      }
      resolvePromise({ stdout: output, stderr: diagnostic });
    });
  });
}

async function textCommand(command, args, cwd, env) {
  return (await run(command, args, { cwd, env, timeoutMs: 30_000 })).stdout.trim();
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const med = median(sorted);
  const deviations = sorted.map((value) => Math.abs(value - med)).sort((left, right) => left - right);
  const p90Index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);
  return {
    count: sorted.length,
    median_ms: med,
    p90_ms: sorted[p90Index],
    mad_ms: median(deviations),
    min_ms: sorted[0],
    max_ms: sorted[sorted.length - 1],
  };
}

function metricSummaries(samples) {
  const names = new Set();
  for (const sample of samples) for (const name of Object.keys(sample.metrics)) names.add(name);
  return Object.fromEntries(
    [...names].sort().map((name) => [
      name,
      summarize(samples.map((sample) => sample.metrics[name]).filter((value) => typeof value === 'number')),
    ]),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  const packageJson = JSON.parse(await readFile(join(args.root, 'package.json'), 'utf8'));
  await rm(args.scratch, { recursive: true, force: true });
  await mkdir(args.scratch, { recursive: true });
  await mkdir(dirname(args.output), { recursive: true });
  const home = join(args.scratch, 'home');
  const agentRoot = join(args.scratch, 'agent');
  const tmpRoot = join(args.scratch, 'tmp');
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(agentRoot, { recursive: true }),
    mkdir(tmpRoot, { recursive: true }),
  ]);
  const env = {
    ...process.env,
    HOME: home,
    TMPDIR: tmpRoot,
    PI_CODING_AGENT_DIR: agentRoot,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    CI: '1',
  };
  const gitStatus = await textCommand('git', ['status', '--short'], args.root, env);
  const provenance = {
    label: args.label,
    recorded_at: new Date().toISOString(),
    package_root: args.root,
    package_name: packageJson.name,
    package_version: packageJson.version,
    source_commit: await textCommand('git', ['rev-parse', 'HEAD^{commit}'], args.root, env),
    source_tree: await textCommand('git', ['rev-parse', 'HEAD^{tree}'], args.root, env),
    source_status: gitStatus === '' ? 'clean' : gitStatus,
    runtime: args.runtime,
    source_format: args.runtime === 'compiled'
      ? 'precompiled JavaScript distribution loaded through Pi/Jiti'
      : 'authoritative TypeScript source loaded through Pi/Jiti',
    package_entrypoints: args.runtime === 'compiled'
      ? packageJson.pi?.extensions ?? []
      : ['./extensions/anthropic-attribution.ts', './extensions/background-tasks.ts'],
    features: {
      'sdk-no-extension-load': '(no package entrypoint)',
      'sdk-process-only-load': 'process',
      'sdk-default-load': 'process,delegate,fusion,attested,attribution',
      'delegate-first': 'process,delegate',
      'fusion-first': 'process,fusion',
      'model-selector-first': 'process,fusion',
    },
    cold_definition: 'fresh Node process and empty JS/Jiti module cache; host filesystem cache not flushed',
    node: await textCommand(args.node, ['--version'], args.root, env),
    npm: await textCommand('npm', ['--version'], args.root, env),
    package_pi: JSON.parse(await readFile(join(args.root, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8')).version,
    host_pi: await textCommand('/usr/local/bin/pi', ['--version'], args.root, env).catch(() => 'unavailable'),
    os: { type: type(), platform: platform(), release: release(), arch: arch() },
    sample_count: args.samples,
    excluded_warmups: args.warmups,
    ordering: 'scenario order reverses every round; baseline and candidate are sequential, not simultaneous AB/BA',
    limitations: [
      'No filesystem-cache flush; this is process/module-cache cold only.',
      'Baseline and candidate are sequential because no third worktree/copy is permitted; host drift remains possible.',
      'No native Windows result and no compiled-Bun executable result.',
      'Compiled measurements still use Pi/Jiti to load JavaScript and do not represent a vendor Bun binary.',
    ],
  };
  const scenarios = args.scenarios;
  const samples = Object.fromEntries(scenarios.map((scenario) => [scenario, []]));
  let sequence = 0;
  const execute = async (scenario, warmup, round) => {
    const sampleRoot = join(args.scratch, 'samples', `${String(sequence).padStart(4, '0')}-${scenario}`);
    sequence += 1;
    await mkdir(sampleRoot, { recursive: true });
    const result = await run(
      args.node,
      ['--import', 'tsx', args.worker, '--root', args.root, '--scenario', scenario, '--sample-root', sampleRoot, '--runtime', args.runtime],
      { cwd: args.root, env, timeoutMs: scenario === 'fusion-first' ? 180_000 : 120_000 },
    );
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const parsed = JSON.parse(lines.at(-1) ?? '{}');
    if (!warmup) samples[scenario].push({ round, metrics: parsed.metrics, facts: parsed.facts });
    await rm(sampleRoot, { recursive: true, force: true });
  };
  for (let warmup = 0; warmup < args.warmups; warmup += 1) {
    for (const scenario of scenarios) await execute(scenario, true, warmup);
  }
  for (let round = 0; round < args.samples; round += 1) {
    const order = round % 2 === 0 ? scenarios : [...scenarios].reverse();
    for (const scenario of order) {
      process.stderr.write(`[benchmark ${args.label}] round ${String(round + 1)}/${String(args.samples)} ${scenario}\n`);
      await execute(scenario, false, round);
    }
  }
  const receipt = {
    schema_version: 'pi-background-tasks.cold-load-benchmark.v1',
    provenance,
    scenarios: Object.fromEntries(
      scenarios.map((scenario) => [scenario, {
        statistics: metricSummaries(samples[scenario]),
        raw: samples[scenario],
      }]),
    ),
  };
  await writeFile(args.output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  await rm(args.scratch, { recursive: true, force: true });
  console.log(JSON.stringify({ output: args.output, scenarios: Object.fromEntries(scenarios.map((scenario) => [scenario, receipt.scenarios[scenario].statistics])) }, null, 2));
}

await main();
