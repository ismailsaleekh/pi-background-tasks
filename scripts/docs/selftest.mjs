#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DocsGateError,
  assertCoverage,
  assertRegistrationFixture,
  buildCodeFacts,
  checkPayloadFiles,
  checkReleaseVersion,
  extractGeneratedRegions,
  generateDocTexts,
  loadDocsModel,
  parseFrontmatter,
  parseNpmPackFiles,
  resolveNpmCli,
  sha256,
  splitFrontmatter,
  verifyAttestations,
  verifyLinksAndReachability,
} from './lib.mjs';

function mustThrow(name, fn, pattern) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof Error, name);
    assert.match(error.message, pattern, name);
    return;
  }
  assert.fail(`${name} did not throw`);
}

const codeFacts = buildCodeFacts();
const docsModel = loadDocsModel();

assert.equal(docsModel.docs.length, 42, 'all docs/**/*.md are governed');
assert.equal(codeFacts.public_surface_ids.length, 32, 'all command/tool/shortcut/renderer/EventBus/workflow surfaces are extracted');
assert.equal(codeFacts.default_public_surface_ids.length, 31, 'alternate dock shortcut is the only non-default surface');
assert.ok(codeFacts.public_surface_ids.includes('eventbus:background-task-v1'));
assert.ok(codeFacts.public_surface_ids.includes('workflow:research'));
const surfaceById = new Map(
  Object.values(codeFacts.public_surfaces).flat().map((surface) => [surface.id, surface]),
);
assert.equal(surfaceById.get('tool:bg_delegate').availability, 'feature:delegate');
assert.equal(surfaceById.get('tool:fusion_reason').availability, 'feature:fusion');
assert.equal(
  surfaceById.get('tool:bg_result').availability,
  'any(feature:delegate,feature:fusion)',
);
assert.equal(surfaceById.get('tool:bg_run_pi_attested').availability, 'feature:attested');
assert.equal(surfaceById.get('command:claude-cache').availability, 'feature:attribution');
assert.equal(surfaceById.get('shortcut:shift+down').availability, 'dock:shift+down');
assert.equal(surfaceById.get('shortcut:ctrl+alt+b').availability, 'dock:ctrl+alt+b');
assert.equal(surfaceById.get('shortcut:ctrl+alt+b').default_available, false);
assert.equal(docsModel.docs.find((doc) => doc.doc_id === 'INDEX').frontmatter.covers_surfaces.length, 0, 'INDEX must not own public surfaces');
assert.equal(docsModel.docs.find((doc) => doc.doc_id === 'read-before-edit').frontmatter.covers_sources.length, 0, 'read-before-edit must not own sources');
const envNames = new Set(codeFacts.environment_variables.map((entry) => entry.name));
for (const expectedEnv of ['PI_BG_FEATURES', 'PI_BG_DOCK_SHORTCUT', 'PI_BG_SHELL', 'PI_BG_SHELL_PATH', 'PI_BG_DISABLE_PI_TELEMETRY', 'ComSpec', 'SystemRoot', 'WINDIR']) assert.ok(envNames.has(expectedEnv), `missing env extraction for ${expectedEnv}`);
assert.ok(!envNames.has('FUSION_CHILD_IDLE_TIMEOUT_MS'), 'fixed timeout constant must not be classified as env');
const runtimeArtifacts = new Set(codeFacts.runtime_paths_and_artifacts.map((entry) => entry.value));
for (const expectedArtifact of [
  '<attempt-prefix> = candidate-<slot>.attempt-<n> | evaluation.attempt-<n> | merge.attempt-<n>',
  'candidate-<slot>.attempt-<n>.response.md | candidate-<slot>.attempt-<n>.response.partial.md',
  'evaluation.attempt-<n>.response.txt | evaluation.attempt-<n>.response.partial.txt',
  'merge.attempt-<n>.response.md | merge.attempt-<n>.response.partial.md',
  'candidate-<slot>.attempt-<n>.tool-calls.jsonl.seal.json',
]) assert.ok(runtimeArtifacts.has(expectedArtifact), `missing runtime artifact ${expectedArtifact}`);
assert.ok(
  ![...runtimeArtifacts].some((artifact) => artifact.includes('<stage>[.<slot>]')),
  'stale generic Fusion attempt artifact pattern must not return',
);

mustThrow('malformed frontmatter', () => parseFrontmatter('doc_id INDEX.md', 'fixture.md'), /malformed frontmatter/);
mustThrow('unknown frontmatter key', () => {
  const text = '---\ndoc_id: x\naudience: agent\nmode: generated\nreview_policy: contract\nstability: stable\ncovers_surfaces: []\ncovers_sources: []\nextra: nope\n---\n';
  const { frontmatterText } = splitFrontmatter(text, 'docs/x.md');
  const fm = parseFrontmatter(frontmatterText, 'docs/x.md');
  if ('extra' in fm) throw new DocsGateError('unknown frontmatter key extra');
}, /unknown frontmatter/);

mustThrow('broken duplicate markers', () => extractGeneratedRegions({ docs: [{ rel: 'docs/x.md', doc_id: 'x', text: '<!-- pi-docs:begin name="a" generator="scripts/docs/generate.mjs" -->\n<!-- pi-docs:begin name="b" generator="scripts/docs/generate.mjs" -->\n<!-- pi-docs:end name="b" -->\n<!-- pi-docs:end name="a" -->' }] }), /nested/);

mustThrow('stale/unknown surface', () => assertCoverage(codeFacts, { docs: [{ rel: 'docs/x.md', doc_id: 'x', frontmatter: { covers_surfaces: ['tool:not_real'], covers_sources: [] } }] }), /unknown public surface/);

mustThrow('new uncovered source', () => assertCoverage({ ...codeFacts, governed_sources: [...codeFacts.governed_sources, 'src/new-source.ts'] }, docsModel), /src\/new-source\.ts has no primary doc/);

mustThrow('duplicate owner', () => assertCoverage(codeFacts, { docs: [docsModel.docs[0], { ...docsModel.docs[0], rel: 'docs/dup.md', doc_id: 'dup' }] }), /duplicate primary docs/);
const behavioralOwner = docsModel.docs.find((doc) => doc.frontmatter.covers_sources.length > 0);
assert.ok(behavioralOwner, 'fixture requires one source-owning doc');
mustThrow('non-behavioral source owner', () => assertCoverage(codeFacts, {
  docs: docsModel.docs.map((doc) => doc.doc_id === behavioralOwner.doc_id
    ? { ...doc, frontmatter: { ...doc.frontmatter, review_policy: 'contract' } }
    : doc),
}), /source owners must use review_policy behavioral/);

mustThrow('broken link/anchor', () => verifyLinksAndReachability(process.cwd(), { docs: [{ rel: 'docs/INDEX.md', doc_id: 'INDEX', body: '# Hi\n[bad](./missing.md)', text: '---\n---\n# Hi\n[bad](./missing.md)', frontmatter: { covers_surfaces: [], covers_sources: [] } }] }), /broken link/);
mustThrow('broken reference-style link', () => verifyLinksAndReachability(process.cwd(), { docs: [{ rel: 'docs/INDEX.md', doc_id: 'INDEX', body: '# Hi\n[bad][missing-doc]\n\n[missing-doc]: ./missing.md', text: '---\n---\n# Hi\n[bad][missing-doc]\n\n[missing-doc]: ./missing.md', frontmatter: { covers_surfaces: [], covers_sources: [] } }] }), /broken link/);
mustThrow('undefined reference-style link', () => verifyLinksAndReachability(process.cwd(), { docs: [{ rel: 'docs/INDEX.md', doc_id: 'INDEX', body: '# Hi\n[bad][not-defined]', text: '---\n---\n# Hi\n[bad][not-defined]', frontmatter: { covers_surfaces: [], covers_sources: [] } }] }), /undefined Markdown reference/);

const linkRoot = mkdtempSync(join(tmpdir(), 'pi-bg-doc-links-'));
try {
  mkdirSync(join(linkRoot, 'docs'), { recursive: true });
  writeFileSync(join(linkRoot, 'docs', 'INDEX.md'), '# Index\n[Guide][guide-ref]\n\n[guide-ref]: ./guide.md\n\n<https://example.com/>\n```md\n[ignored][undefined-in-code]\n```\n');
  writeFileSync(join(linkRoot, 'docs', 'guide.md'), '# Guide\n');
  verifyLinksAndReachability(linkRoot, {
    docs: [
      { rel: 'docs/INDEX.md', doc_id: 'INDEX', body: '# Index\n[Guide][guide-ref]\n\n[guide-ref]: ./guide.md\n\n<https://example.com/>\n```md\n[ignored][undefined-in-code]\n```\n', text: '', frontmatter: { covers_surfaces: [], covers_sources: [] } },
      { rel: 'docs/guide.md', doc_id: 'guide', body: '# Guide\n', text: '', frontmatter: { covers_surfaces: [], covers_sources: [] } },
    ],
  });
} finally {
  rmSync(linkRoot, { recursive: true, force: true });
}

const attestationFixtureDoc = { rel: 'docs/behavior.md', doc_id: 'behavior', body: 'body', frontmatter: { review_policy: 'behavioral', covers_sources: ['package.json'] } };
const attestationFixtureReceipt = { schema_version: 'pi-background-tasks.docs-attestation.v1', doc_id: 'behavior', verdict: 'PASS', reviewer: 'fixture-reviewer', notes: 'fixture stale receipt notes', authored_body_sha256: sha256('other'), covers_sources: ['package.json'], source_sha256: {} };
mustThrow('stale receipt', () => verifyAttestations(process.cwd(), { docs: [attestationFixtureDoc] }, { schema_version: 'pi-background-tasks.docs-attestations.v1', receipts: [attestationFixtureReceipt] }), /stale attestation authored prose hash/);
mustThrow('duplicate receipt', () => verifyAttestations(process.cwd(), { docs: [attestationFixtureDoc] }, { schema_version: 'pi-background-tasks.docs-attestations.v1', receipts: [attestationFixtureReceipt, { ...attestationFixtureReceipt }] }), /duplicate receipt/);
mustThrow('orphan receipt', () => verifyAttestations(process.cwd(), { docs: [attestationFixtureDoc] }, { schema_version: 'pi-background-tasks.docs-attestations.v1', receipts: [{ ...attestationFixtureReceipt, doc_id: 'removed-owner' }] }), /orphan receipt/);

mustThrow('unsupported extraction', () => assertRegistrationFixture('export default function x(pi){ pi.registerCommand(makeName(), {}); }'), /unsupported expression for docs extraction/);
mustThrow('duplicate public registration', () => assertRegistrationFixture("export default function x(pi){ pi.registerCommand('same', {}); pi.registerCommand('same', {}); }"), /duplicate public registration/);
mustThrow('invalid tool string metadata', () => assertRegistrationFixture("export default function x(pi){ pi.registerTool({ name: 'fixture', description: 42 }); }"), /description must resolve to a string/);
mustThrow('invalid tool guidelines metadata', () => assertRegistrationFixture("export default function x(pi){ pi.registerTool({ name: 'fixture', promptGuidelines: ['valid', 42] }); }"), /promptGuidelines must resolve to an array of strings/);
mustThrow('shorthand tool metadata', () => assertRegistrationFixture("export default function x(pi){ const description = 'hidden'; pi.registerTool({ name: 'fixture', description }); }"), /public field description must be an explicit property assignment/);
mustThrow('spread tool metadata', () => assertRegistrationFixture("export default function x(pi){ const metadata = { description: 'hidden' }; pi.registerTool({ name: 'fixture', ...metadata }); }"), /must not use object spread/);
mustThrow('aliased registration method', () => assertRegistrationFixture("export default function x(pi){ const register = pi.registerCommand; register('hidden', {}); }"), /aliasing the Pi registration host|must be called directly/);
mustThrow('bound registration method', () => assertRegistrationFixture("export default function x(pi){ const register = pi.registerTool.bind(pi); register({ name: 'hidden' }); }"), /aliasing the Pi registration host|unsupported (?:non-identifier )?helper invocation|must be called directly/);
mustThrow('literal element-access registration', () => assertRegistrationFixture("export default function x(pi){ pi['registerCommand']('hidden', {}); }"), /element access on the Pi registration host|unsupported derived Pi registration invocation/);
mustThrow('computed element-access registration', () => assertRegistrationFixture("export default function x(pi){ const key = 'register' + 'Command'; pi[key]('hidden', {}); }"), /element access on the Pi registration host|unsupported derived Pi registration invocation/);
mustThrow('derived registration callee', () => assertRegistrationFixture("export default function x(pi){ ({ call: pi.registerCommand }).call('hidden', {}); }"), /unsupported derived Pi registration invocation/);
mustThrow('nested returned host alias', () => assertRegistrationFixture("export default function x(pi){ function hidden(){ return pi; } hidden().registerCommand('hidden', {}); }"), /unsupported nested registration helper or invocation/);
mustThrow('nested default host alias', () => assertRegistrationFixture("export default function x(pi){ function hidden(host = pi){ host.registerCommand('hidden', {}); } hidden(); }"), /unsupported nested registration helper or invocation/);
mustThrow('aliased registration host', () => assertRegistrationFixture("export default function x(pi){ const host = (pi as any); host.registerCommand('hidden', {}); }"), /aliasing the Pi registration host or registration wrapper/);
mustThrow('assigned registration host alias', () => assertRegistrationFixture("export default function x(pi){ let host; host = (pi satisfies unknown); host.registerCommand('hidden', {}); }"), /assigning a Pi registration host/);
mustThrow('compound registration host alias', () => assertRegistrationFixture("export default function x(pi){ let host; host ??= pi; host.registerCommand('hidden', {}); }"), /assigning a Pi registration host/);
mustThrow('iterated registration host alias', () => assertRegistrationFixture("export default function x(pi){ for (const host of [pi]) { host.registerCommand('hidden', {}); } }"), /Pi registration host escapes the supported direct-use grammar/);
mustThrow('destructured Pi parameter', () => assertRegistrationFixture("export default function x({ registerCommand }){ registerCommand('hidden', {}); }"), /default export must have an identifier Pi parameter/);
mustThrow('constructor receives Pi', () => assertRegistrationFixture("class Hidden { constructor(host: any) { host.registerCommand('hidden', {}); } } export default function x(pi){ new Hidden(pi); }"), /constructors must not receive or derive Pi registration hosts/);
mustThrow('derived registration host alias', () => assertRegistrationFixture("export default function x(pi){ const host = { ...pi }; host.registerCommand('hidden', {}); }"), /aliasing the Pi registration host or registration wrapper/);
mustThrow('unknown registration helper', () => assertRegistrationFixture("function hidden(host){} export default function x(pi){ hidden((pi as any)); }"), /unsupported helper invocation receives the Pi registration host/);
assert.deepEqual(assertRegistrationFixture("export default function x(pi){ pi.registerProvider('internal', {}); pi.registerCommand('public', {}); }"), ['command:public'], 'non-public provider registration must be accepted without becoming a public surface');
assert.deepEqual(
  assertRegistrationFixture("export default function x(pi){ (pi as any).registerCommand('normalized', {}); }"),
  ['command:normalized'],
  'normalized Pi host expressions must still be extracted',
);

const validToolFields = "name: 'fixture', label: 'Fixture', description: 'fixture', promptSnippet: 'fixture', promptGuidelines: ['fixture'], parameters: Type.Object({})";
const wrapperDefinition = "function registerTool(options: any): void { pi.registerTool({ name: options.name, label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); }";
assert.deepEqual(
  assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} (registerTool as typeof registerTool)({ ${validToolFields} }); }`),
  ['tool:fixture'],
  'cast wrapper calls must be normalized and extracted',
);
mustThrow(
  'returned wrapper escape',
  () => assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} function hidden(){ return registerTool; } hidden()({ ${validToolFields} }); }`),
  /unsupported nested registration helper or invocation/,
);
mustThrow(
  'higher-order wrapper argument',
  () => assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} invoke(registerTool, { ${validToolFields} }); }`),
  /registration wrappers must not be passed as arguments/,
);
mustThrow(
  'constructor receives wrapper',
  () => assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} new Hidden(registerTool); }`),
  /constructors must not receive or derive Pi registration hosts or wrappers/,
);
mustThrow(
  'wrapper computed public path',
  () => assertRegistrationFixture(`export default function x(pi){ function registerTool(options: any): void { pi.registerTool({ name: options['name'], label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); } registerTool({ ${validToolFields} }); }`),
  /public field name must map directly from options\.name/,
);
mustThrow(
  'wrapper spread hides public fields',
  () => assertRegistrationFixture(`export default function x(pi){ function registerTool(options: any): void { pi.registerTool({ ...options }); } registerTool({ ${validToolFields} }); }`),
  /must not use object spread/,
);
const finiteVariantConfig = readFileSync(resolve('src/core/config.ts'), 'utf8');
assert.deepEqual(
  assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.delegate) { pi.registerCommand('delegate-only', {}); } if (config.features.delegate || config.features.fusion) { registerFeature(pi); } if (config.dockShortcut === 'ctrl+alt+b') { pi.registerShortcut('ctrl+alt+b', {}); } }`,
      'config.ts': finiteVariantConfig,
      'feature.ts': "export function registerFeature(pi){ pi.registerCommand('shared-result', {}); }",
    },
  }),
  ['command:delegate-only', 'command:shared-result', 'shortcut:ctrl+alt+b'],
  'closed feature, derived-result, and shortcut variants must be extracted',
);
mustThrow(
  'finite variant enum drift',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.delegate) { pi.registerCommand('hidden', {}); } }",
      'config.ts': finiteVariantConfig.replace("'attribution'", "'attribution', 'invented'"),
    },
  }),
  /variant enum drift|unsupported feature enum/,
);
mustThrow(
  'finite shortcut enum drift',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.dockShortcut === 'ctrl+alt+b') { pi.registerShortcut('ctrl+alt+b', {}); } }",
      'config.ts': finiteVariantConfig.replace("  'off',\n] as const", "  'off',\n  'super+x',\n] as const"),
    },
  }),
  /variant enum drift/,
);
mustThrow(
  'unknown finite feature condition',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.invented) { pi.registerCommand('hidden', {}); } }",
      'config.ts': finiteVariantConfig,
    },
  }),
  /unsupported feature availability condition|unrecognized finite variant condition/,
);
mustThrow(
  'dock off cannot register a shortcut',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.dockShortcut === 'off') { pi.registerShortcut('shift+down', {}); } }",
      'config.ts': finiteVariantConfig,
    },
  }),
  /dock.*off|unrecognized finite variant condition/,
);
mustThrow(
  'mutated derived availability expression',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.delegate && config.features.fusion) { pi.registerCommand('hidden', {}); } }",
      'config.ts': finiteVariantConfig,
    },
  }),
  /derived availability|unrecognized finite variant condition/,
);
mustThrow(
  'aliased finite config binding',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); const selected = config; if (selected.features.delegate) { pi.registerCommand('hidden', {}); } }",
      'config.ts': finiteVariantConfig,
    },
  }),
  /unrecognized finite variant condition|immediate top-level statement|finite config binding/,
);

const hiddenAliasRuntime = [];
function hiddenAliasRegistrar(pi, host = pi) {
  host.registerCommand('hidden-default-alias', {});
}
hiddenAliasRegistrar({
  registerCommand: (name) => hiddenAliasRuntime.push(`command:${name}`),
});
assert.deepEqual(hiddenAliasRuntime, ['command:hidden-default-alias']);
mustThrow(
  'imported registrar parameter default host alias',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.delegate) { registerFeature(pi); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': "export function registerFeature(pi, host = pi){ host.registerCommand('hidden-default-alias', {}); }",
    },
  }),
  /parameter initializer|registration host|Pi registration host/,
);

const earlyReturnRuntime = [];
function earlyReturnRegistrar(pi, enabled) {
  if (!enabled) return;
  pi.registerCommand('never-registered', {});
}
earlyReturnRegistrar(
  { registerCommand: (name) => earlyReturnRuntime.push(`command:${name}`) },
  false,
);
assert.deepEqual(earlyReturnRuntime, []);
assert.deepEqual(
  assertRegistrationFixture(
    "export default function x(pi){ pi.registerCommand('handler-return', { handler(){ if (Math.random() > 2) return; return Promise.resolve(); } }); }",
  ),
  ['command:handler-return'],
  'returns inside non-registration handlers remain outside the finite registration grammar',
);
assert.deepEqual(
  assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.attribution) { pi.on('session_start', (_event, _ctx) => { registerFeature(pi); }); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': `const ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL = 'pi-anthropic-attribution:claim:v1';
      const ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA = 'pi-anthropic-attribution.claim.v1';
      export function registerFeature(pi){
        const acknowledgements = [];
        const probe = {
          schema_version: ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA,
          acknowledge: () => { acknowledgements.push(true); },
        };
        pi.events.emit(ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL, probe);
        if (acknowledgements.length > 0) return;
        pi.registerCommand('claimed-owner', {});
      }`,
    },
  }),
  ['command:claimed-owner'],
  'the exact synchronous duplicate-owner claim guard remains supported in a session activation scope',
);
mustThrow(
  'mutated duplicate-owner guard is not a general early-return waiver',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.attribution) { pi.on('session_start', (_event, _ctx) => { registerFeature(pi); }); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': `export function registerFeature(pi){
        const acknowledgements = [true];
        const probe = { acknowledge: () => { acknowledgements.push(true); } };
        pi.events.emit('fixture:claim', probe);
        if (acknowledgements.length > 0) return;
        pi.registerCommand('invented-owner', {});
      }`,
    },
  }),
  /early return|control flow|return/,
);
mustThrow(
  'imported registrar early return before registration',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.delegate) { registerFeature(pi, false); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': "export function registerFeature(pi, enabled){ if (!enabled) return; pi.registerCommand('never-registered', {}); }",
    },
  }),
  /early return|control flow|return/,
);

const mutatedConfigRuntime = [];
let mutatedConfigRuntimeError;
try {
  const runtimeConfig = Object.freeze({ features: Object.freeze({ delegate: true }) });
  Object.defineProperty(runtimeConfig.features, 'delegate', { value: false });
  if (runtimeConfig.features.delegate) {
    mutatedConfigRuntime.push('command:startup-never-reaches-registration');
  }
} catch (error) {
  mutatedConfigRuntimeError = error instanceof Error ? error.name : String(error);
}
assert.deepEqual(mutatedConfigRuntime, []);
assert.equal(mutatedConfigRuntimeError, 'TypeError');
mustThrow(
  'finite config mutation attempt before registration',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); Object.defineProperty(config.features, 'delegate', { value: false }); if (config.features.delegate) { pi.registerCommand('startup-never-reaches-registration', {}); } }",
      'config.ts': finiteVariantConfig,
    },
  }),
  /finite config binding|mutation|escape/,
);

mustThrow(
  'mutable parser cannot authorize finite config binding',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function x(pi){ const config = parseBackgroundTasksConfig(); if (config.features.delegate) { pi.registerCommand('mutable-parser-surface', {}); } }",
      'config.ts': `
export const PI_BG_FEATURE_VALUES = Object.freeze(['process', 'delegate', 'fusion', 'attested', 'attribution'] as const);
export const PI_BG_DEFAULT_FEATURES = PI_BG_FEATURE_VALUES;
export const PI_BG_DOCK_SHORTCUT_VALUES = Object.freeze(['shift+down', 'ctrl+alt+b', 'off'] as const);
export const PI_BG_DEFAULT_DOCK_SHORTCUT = 'shift+down';
export function parseBackgroundTasksConfig(){ return { features: { process: true, delegate: true, fusion: true, attested: true, attribution: true }, dockShortcut: 'shift+down' }; }
`,
    },
  }),
  /immutable|Object\.freeze|parser/,
);

// Keep the seven final-review controls independent. Six use the byte-for-byte
// production parser; the seventh mutates only the parser return-path seam it tests.
let parameterInitializerError;
try {
  ((pi, fail = (() => { throw new Error('initializer stops activation'); })()) => {
    void fail;
    pi.registerCommand('initializer-never-registers', {});
  })({ registerCommand: () => assert.fail('throwing initializer reached registration') });
} catch (error) {
  parameterInitializerError = error instanceof Error ? error.message : String(error);
}
assert.equal(parameterInitializerError, 'initializer stops activation');
mustThrow(
  'registration-owner parameter initializer control flow',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `export default function entry(
        pi: unknown,
        fail: never = (() => { throw new Error('initializer stops activation'); })(),
      ) {
        void fail;
        pi.registerCommand('initializer-never-registers', {});
      }`,
    },
  }),
  /parameter initializer.*(?:throw|control flow)/i,
);

let capturedConfigError;
try {
  const runtimeConfig = Object.freeze({ features: Object.freeze({ attribution: true }) });
  (() => {
    Object.defineProperty(runtimeConfig.features, 'attribution', { value: false });
  })();
} catch (error) {
  capturedConfigError = error instanceof Error ? error.name : String(error);
}
assert.equal(capturedConfigError, 'TypeError');
mustThrow(
  'captured finite config mutation in session_start',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `import { parseBackgroundTasksConfig } from './config.js';
      export default function entry(pi) {
        const config = parseBackgroundTasksConfig();
        if (config.features.attribution) {
          pi.on('session_start', () => {
            Object.defineProperty(config.features, 'attribution', { value: false });
            pi.registerCommand('captured-config-never-registers', {});
          });
        }
      }`,
      'config.ts': finiteVariantConfig,
    },
  }),
  /finite config binding config escapes its validated availability condition/,
);
mustThrow(
  'captured finite config cannot escape through a nested closure',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `import { parseBackgroundTasksConfig } from './config.js';
      export default function entry(pi) {
        const config = parseBackgroundTasksConfig();
        if (config.features.attribution) {
          pi.on('session_start', () => {
            const mutate = () => Object.defineProperty(config.features, 'attribution', { value: false });
            mutate();
            pi.registerCommand('closure-config-never-registers', {});
          });
        }
      }`,
      'config.ts': finiteVariantConfig,
    },
  }),
  /unsupported nested registration helper or invocation/,
);
mustThrow(
  'captured finite config mutation stays authoritative through imported registrars',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `import { parseBackgroundTasksConfig } from './config.js';
      import { registerFeature } from './feature.js';
      export default function entry(pi) {
        const config = parseBackgroundTasksConfig();
        if (config.features.attribution) { registerFeature(pi); }
      }`,
      'config.ts': finiteVariantConfig,
      'feature.ts': `import { parseBackgroundTasksConfig } from './config.js';
      export function registerFeature(pi) {
        const config = parseBackgroundTasksConfig();
        pi.on('session_start', () => {
          Reflect.set(config.features, 'attribution', false);
          pi.registerCommand('imported-captured-config-never-registers', {});
        });
      }`,
    },
  }),
  /finite config binding config escapes its validated availability condition/,
);

const fakeClaimRegistrations = [];
const fakeClaimListeners = new Map();
const fakeClaimHost = {
  events: {
    on: (channel, listener) => fakeClaimListeners.set(channel, listener),
    emit: (channel, value) => fakeClaimListeners.get(channel)?.(value),
  },
  registerCommand: (name) => fakeClaimRegistrations.push(name),
};
((pi) => {
  pi.events.on('unrelated:claim', (value) => value.acknowledge());
  const acknowledgements = [];
  const probe = { acknowledge: () => acknowledgements.push(true) };
  pi.events.emit('unrelated:claim', probe);
  if (acknowledgements.length > 0) return;
  pi.registerCommand('fake-owner-suppressed', {});
})(fakeClaimHost);
assert.deepEqual(fakeClaimRegistrations, []);
mustThrow(
  'fake duplicate-owner channel and schema',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function entry(pi) { const config = parseBackgroundTasksConfig(); if (config.features.attribution) { registerFeature(pi); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': `export function registerFeature(pi) {
        pi.events.on('unrelated:claim', (value) => { value.acknowledge(); });
        const acknowledgements = [];
        const probe = { acknowledge: () => { acknowledgements.push(true); } };
        pi.events.emit('unrelated:claim', probe);
        if (acknowledgements.length > 0) return;
        pi.registerCommand('fake-owner-suppressed', {});
      }`,
    },
  }),
  /duplicate-owner claim guard.*(?:channel|schema|probe)|early return/i,
);
mustThrow(
  'duplicate-owner claim requires the production schema',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function entry(pi) { const config = parseBackgroundTasksConfig(); if (config.features.attribution) { registerFeature(pi); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': `export function registerFeature(pi) {
        const acknowledgements = [];
        const probe = {
          schema_version: 'fixture.claim.v1',
          acknowledge: () => { acknowledgements.push(true); },
        };
        pi.events.emit('pi-anthropic-attribution:claim:v1', probe);
        if (acknowledgements.length > 0) return;
        pi.registerCommand('wrong-schema-owner', {});
      }`,
    },
  }),
  /duplicate-owner claim guard must use exact schema pi-anthropic-attribution\.claim\.v1/i,
);
mustThrow(
  'duplicate-owner claim cannot acknowledge its own pre-probe listener',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; import { registerFeature } from './feature.js'; export default function entry(pi) { const config = parseBackgroundTasksConfig(); if (config.features.attribution) { registerFeature(pi); } }",
      'config.ts': finiteVariantConfig,
      'feature.ts': `export function registerFeature(pi) {
        pi.events.on('pi-anthropic-attribution:claim:v1', (value) => value.acknowledge());
        const acknowledgements = [];
        const probe = {
          schema_version: 'pi-anthropic-attribution.claim.v1',
          acknowledge: () => { acknowledgements.push(true); },
        };
        pi.events.emit('pi-anthropic-attribution:claim:v1', probe);
        if (acknowledgements.length > 0) return;
        pi.registerCommand('self-claimed-owner', {});
      }`,
    },
  }),
  /must not install a local claim listener before its probe/i,
);

assert.deepEqual(
  (() => {
    const registrations = [];
    const pi = { registerCommand: (name) => registrations.push(name) };
    const otherHost = pi;
    otherHost['registerCommand']('hidden-unknown-host', {});
    pi.registerCommand('visible', {});
    return registrations;
  })(),
  ['hidden-unknown-host', 'visible'],
);
mustThrow(
  'unknown computed registration host',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `import { otherHost } from './other.js';
      export default function entry(pi) {
        otherHost['registerCommand']('hidden-unknown-host', {});
        pi.registerCommand('visible', {});
      }`,
      'other.ts': 'export const otherHost = globalThis.fixtureRegistrationHost;',
    },
  }),
  /computed registration method registerCommand uses an unsupported registration host/i,
);

const destructuredHostRegistrations = [];
const destructuredRuntimeHost = {
  registerCommand: (name) => destructuredHostRegistrations.push(name),
};
((pi, { registerCommand } = destructuredRuntimeHost) => {
  registerCommand('hidden-destructured-host', {});
  pi.registerCommand('visible', {});
})(destructuredRuntimeHost);
assert.deepEqual(destructuredHostRegistrations, ['hidden-destructured-host', 'visible']);
mustThrow(
  'destructured default unknown registration host',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `function getRegistrationHost() { return globalThis.fixtureRegistrationHost; }
      export default function entry(pi, { registerCommand } = getRegistrationHost()) {
        registerCommand('hidden-destructured-host', {});
        pi.registerCommand('visible', {});
      }`,
    },
  }),
  /destructured registration binding registerCommand is unsupported/i,
);

const shadowedParserRuntime = [];
((pi, parseBackgroundTasksConfig = () => ({ features: { delegate: false } })) => {
  const config = parseBackgroundTasksConfig();
  if (config.features.delegate) pi.registerCommand('shadowed-parser-never-registers', {});
})({ registerCommand: (name) => shadowedParserRuntime.push(name) });
assert.deepEqual(shadowedParserRuntime, []);
mustThrow(
  'shadowed imported config parser',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': `import { parseBackgroundTasksConfig } from './config.js';
      export default function entry(
        pi,
        parseBackgroundTasksConfig = () => ({ features: { delegate: false } }),
      ) {
        const config = parseBackgroundTasksConfig();
        if (config.features.delegate) { pi.registerCommand('shadowed-parser-never-registers', {}); }
      }`,
      'config.ts': finiteVariantConfig,
    },
  }),
  /config parser call must resolve to the unshadowed imported parseBackgroundTasksConfig/i,
);

const parserWithHiddenEarlyReturn = finiteVariantConfig.replace(
  `): PiBackgroundConfig {\n  const features = parseFeatures(env['PI_BG_FEATURES']);`,
  `): PiBackgroundConfig {\n  if (env['PI_BG_FEATURES'] === undefined) {\n    return {\n      features: { process: true, delegate: false, fusion: false, attested: false, attribution: false },\n      dockShortcut: 'off',\n    } as PiBackgroundConfig;\n  }\n  const features = parseFeatures(env['PI_BG_FEATURES']);`,
);
assert.notEqual(parserWithHiddenEarlyReturn, finiteVariantConfig, 'hidden parser return seam');
mustThrow(
  'hidden early return in config parser',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { parseBackgroundTasksConfig } from './config.js'; export default function entry(pi) { const config = parseBackgroundTasksConfig(); if (config.features.delegate) { pi.registerCommand('parser-early-return-never-registers', {}); } }",
      'config.ts': parserWithHiddenEarlyReturn,
    },
  }),
  /variant parser must have exactly one reachable direct immutable return/i,
);

mustThrow(
  'conditional registerTool inside wrapper',
  () => assertRegistrationFixture(`export default function x(pi){ function registerTool(options: any): void { if (enabled) { pi.registerTool({ name: options.name, label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); } } registerTool({ ${validToolFields} }); }`),
  /tool wrapper registerTool call must be an immediate top-level statement/,
);
mustThrow(
  'conditional wrapper definition',
  () => assertRegistrationFixture(`export default function x(pi){ if (enabled) { function registerTool(options: any): void { pi.registerTool({ name: options.name, label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); } registerTool({ ${validToolFields} }); } }`),
  /tool wrapper definition must be top-level/,
);
mustThrow(
  'conditional wrapper invocation',
  () => assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} if (enabled) { registerTool({ ${validToolFields} }); } }`),
  /local registration-wrapper call must be an immediate top-level statement/,
);
mustThrow(
  'conditional direct registration',
  () => assertRegistrationFixture("export default function x(pi){ if (enabled) { pi.registerCommand('hidden', {}); } }"),
  /public registration call must be an immediate top-level statement/,
);
mustThrow(
  'wrapper secondary registration',
  () => assertRegistrationFixture(`export default function x(pi){ function registerTool(options: any): void { pi.registerTool({ name: options.name, label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); pi.registerCommand('hidden', {}); } registerTool({ ${validToolFields} }); }`),
  /exactly one direct registerTool call and no secondary registrations/,
);
mustThrow(
  'nested wrapper invocation',
  () => assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} pi.on('event', () => { (registerTool as typeof registerTool)({ ${validToolFields} }); }); }`),
  /unsupported nested registration helper or invocation|registration wrappers must not be passed as arguments/,
);
mustThrow(
  'wrapper invokes second wrapper',
  () => assertRegistrationFixture(`export default function x(pi){ function registerFirst(options: any): void { pi.registerTool({ name: options.name, label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); registerSecond(options); } function registerSecond(options: any): void { pi.registerTool({ name: options.name, label: options.label, description: options.description, promptSnippet: options.promptSnippet, promptGuidelines: options.promptGuidelines, parameters: options.parameters }); } registerFirst({ ${validToolFields} }); }`),
  /wrapper must not invoke another registration helper/,
);
mustThrow(
  'aliased local wrapper',
  () => assertRegistrationFixture(`export default function x(pi){ ${wrapperDefinition} const hidden = registerTool; hidden({ ${validToolFields} }); }`),
  /aliasing the Pi registration host or registration wrapper/,
);
assert.deepEqual(
  assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { registerFeature } from './feature.js'; export default function x(pi){ (registerFeature as typeof registerFeature)((pi)); }",
      'feature.ts': "export function registerFeature(pi){ pi.registerCommand('imported', {}); }",
    },
  }),
  ['command:imported'],
  'normalized imported registrar calls must be extracted',
);
mustThrow(
  'repeated imported registrar',
  () => assertRegistrationFixture({
    entry: 'entry.ts',
    files: {
      'entry.ts': "import { registerFeature } from './feature.js'; export default function x(pi){ registerFeature(pi); registerFeature(pi); }",
      'feature.ts': "export function registerFeature(pi){ pi.registerCommand('imported', {}); }",
    },
  }),
  /imported registration function .* is invoked more than once/,
);

mustThrow('mandatory gateway missing', () => checkPayloadFiles(['dist/extensions/anthropic-attribution.js', 'dist/extensions/background-tasks.js', 'dist/extensions/anthropic-attribution-child.js', 'dist/extensions/delegate-child.js', 'dist/extensions/fusion-child.js', 'dist/package.json', 'package.json', 'README.md', 'TESTING.md', 'TEST_PLAN.md', 'PUBLISHING.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'logo.png', 'extensions/anthropic-attribution.ts', 'extensions/background-tasks.ts', 'extensions/delegate-child.ts', 'extensions/fusion-child.ts']), /packed payload missing BACKGROUND-TASKS-INSTRUCTIONS\.md/);
mustThrow('missing packed doc', () => checkPayloadFiles(['dist/extensions/anthropic-attribution.js', 'dist/extensions/background-tasks.js', 'dist/extensions/anthropic-attribution-child.js', 'dist/extensions/delegate-child.js', 'dist/extensions/fusion-child.js', 'dist/package.json', 'package.json', 'README.md', 'TESTING.md', 'TEST_PLAN.md', 'PUBLISHING.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'BACKGROUND-TASKS-INSTRUCTIONS.md', 'logo.png', 'extensions/anthropic-attribution.ts', 'extensions/background-tasks.ts', 'extensions/delegate-child.ts', 'extensions/fusion-child.ts']), /packed payload missing/);

mustThrow('release check requires explicit tag ref', () => checkReleaseVersion(process.cwd(), undefined, undefined), /requires an explicit tag ref/);

const fakeNode = join(tmpdir(), 'pi-bg-node-home', process.platform === 'win32' ? 'node.exe' : 'node');
const adjacentNpmCli = resolve(dirname(fakeNode), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const globalNpmCli = resolve(dirname(fakeNode), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const envNpmCli = join(tmpdir(), 'pi-bg-env-npm-cli.js');
assert.equal(resolveNpmCli(fakeNode, {}, (candidate) => candidate === adjacentNpmCli), adjacentNpmCli, 'adjacent Windows-style npm layout');
assert.equal(resolveNpmCli(fakeNode, {}, (candidate) => candidate === globalNpmCli), globalNpmCli, 'Unix global npm layout');
assert.equal(resolveNpmCli(fakeNode, { npm_execpath: envNpmCli }, (candidate) => candidate === envNpmCli), envNpmCli, 'npm_execpath takes precedence');
mustThrow('missing npm CLI', () => resolveNpmCli(fakeNode, {}, () => false), /cannot resolve npm-cli\.js/);
assert.deepEqual(parseNpmPackFiles('[{"files":[{"path":"z"},{"path":"a"}]}]'), ['a', 'z']);
mustThrow('malformed npm pack JSON', () => parseNpmPackFiles('{'), /did not return valid JSON/);
mustThrow('multiple npm pack entries', () => parseNpmPackFiles('[{"files":[]},{"files":[]}]'), /exactly one package entry/);
mustThrow('malformed npm pack file row', () => parseNpmPackFiles('[{"files":[{}]}]'), /files\[0\]\.path must be a string/);

const tmpRoot = mkdtempSync(join(tmpdir(), 'pi-bg-doc-fixture-'));
try {
  mkdirSync(join(tmpRoot, 'docs'), { recursive: true });
  writeFileSync(join(tmpRoot, 'docs', 'bad.md'), '# Missing frontmatter\n');
  mustThrow('new malformed doc discovered', () => loadDocsModel({ packageRoot: tmpRoot }), /missing frontmatter/);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

const first = generateDocTexts(codeFacts, docsModel);
const second = generateDocTexts(codeFacts, docsModel);
assert.equal(JSON.stringify(first), JSON.stringify(second), 'nondeterminism fixture');

console.log('docs-selftest: mutation fixtures passed');
