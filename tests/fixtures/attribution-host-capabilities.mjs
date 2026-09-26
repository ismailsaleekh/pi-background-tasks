// Run by the packed-package test with an external deadline. This models an ESM
// host shim missing the compat export, not a claim of native OMP qualification.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const [packedRoot] = process.argv.slice(2);
assert.ok(packedRoot);
const corePath = resolve(packedRoot, 'dist/src/core/anthropic-attribution.js');

async function fixture({ child = false, features = 'process', compat = {}, root = {} } = {}) {
  const realm = createContext({
    process: { env: { PI_BG_FEATURES: features, PI_BG_DOCK_SHORTCUT: 'off' } },
    Buffer,
    URL,
    Headers,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    fetch: () => {
      throw new Error('no network allowed');
    },
  });
  const modules = new Map();
  const loadedPaths = new Set();
  const synthetic = (key, exports) => {
    const module = new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context: realm, identifier: key },
    );
    modules.set(key, module);
    return module;
  };
  async function load(specifier, parent) {
    if (modules.has(specifier)) return modules.get(specifier);
    if (specifier === '@earendil-works/pi-ai') return synthetic(specifier, root);
    if (specifier === '@earendil-works/pi-ai/compat') return synthetic(specifier, compat);
    if (specifier.startsWith('node:')) return synthetic(specifier, await import(specifier));
    const url = new URL(specifier, parent.identifier).href;
    if (modules.has(url)) return modules.get(url);
    const path = fileURLToPath(url);
    const local = relative(resolve(packedRoot), path);
    assert.ok(
      !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`),
      `unowned import ${path}`,
    );
    loadedPaths.add(path);
    const module = new SourceTextModule(await readFile(path, 'utf8'), {
      context: realm,
      identifier: url,
      importModuleDynamically: async (name, owner) => {
        const target = await load(name, owner);
        if (target.status === 'unlinked') await target.link(load);
        if (target.status === 'linked') await target.evaluate();
        return target;
      },
    });
    modules.set(url, module);
    return module;
  }
  const entry = pathToFileURL(
    resolve(packedRoot, `dist/extensions/anthropic-attribution${child ? '-child' : ''}.js`),
  ).href;
  const module = await load(entry, { identifier: entry });
  await module.link(load); // A named import of a missing export fails here, even when disabled.
  await module.evaluate();
  const registrations = [];
  const handlers = new Map();
  let registered;
  let effective = { original: true };
  const pi = {
    events: {
      emit: () => registrations.push('claim'),
      on: () => registrations.push('claim-owner'),
    },
    on(name, handler) {
      registrations.push(name);
      handlers.set(name, handler);
    },
    registerCommand: () => registrations.push('command'),
    appendEntry: () => assert.fail('no account/session writes'),
    registerProvider(_name, config) {
      registrations.push('provider');
      registered = config;
      effective = {};
    },
  };
  const activate = () => module.namespace.default(pi);
  const start = () =>
    handlers.get('session_start')?.(
      {},
      {
        modelRegistry: {
          getProvider: () => effective,
          getRegisteredProviderConfig: () => registered,
          getRegisteredNativeProvider: () => undefined,
        },
        sessionManager: { getBranch: () => [] },
      },
    );
  return { activate, start, registrations, loadedPaths, transport: () => registered?.streamSimple };
}

for (const compat of [{}, { anthropicMessagesApi: null }, { anthropicMessagesApi: false }]) {
  const disabled = await fixture({ compat });
  await disabled.activate();
  assert.deepEqual(disabled.registrations, []);
  assert.equal(
    disabled.loadedPaths.has(corePath),
    false,
    'disabled path must not import transport',
  );
  for (const child of [false, true]) {
    const enabled = await fixture({
      child,
      features: child ? 'process' : 'process,attribution',
      compat,
    });
    await assert.rejects(
      async () => enabled.activate(),
      /pi_anthropic_attribution_host_adapter_(missing|invalid)/u,
    );
    assert.deepEqual(
      enabled.registrations,
      [],
      'failed activation must publish no hooks/provider/claim',
    );
  }
}

for (const child of [false, true]) {
  const sentinel = { hostStream: true };
  const model = { provider: 'foreign-provider', api: 'anthropic-messages', id: 'foreign' };
  const context = { messages: [] };
  const options = { sessionId: 'unaltered', maxRetries: 0 };
  let calls = 0;
  const valid = await fixture({
    child,
    features: child ? 'process' : 'process,attribution',
    compat: {
      anthropicMessagesApi: () => ({
        streamSimple: (...args) => {
          calls += 1;
          assert.strictEqual(args[0], model);
          assert.strictEqual(args[1], context);
          assert.strictEqual(args[2], options);
          return sentinel;
        },
      }),
    },
  });
  await valid.activate();
  if (!child) valid.start();
  assert.equal(valid.registrations.filter((s) => s === 'provider').length, 1);
  // Even the registered wrapper must leave foreign-provider options by identity.
  const stream = valid.transport()(model, context, options);
  assert.strictEqual(stream, sentinel);
  assert.equal(calls, 1);
}

const malformed = await fixture({
  features: 'process,attribution',
  compat: { anthropicMessagesApi: () => ({}) },
});
await malformed.activate();
malformed.start();
assert.throws(
  () => malformed.transport()({ provider: 'foreign' }, { messages: [] }),
  /host_adapter_invalid/u,
);
console.log('packed attribution host capabilities PASS (missing-export shim, not native OMP)');
