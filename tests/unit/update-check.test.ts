import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_NPM_REGISTRY_URL,
  fetchLatestVersion,
  parseLatestVersionPayload,
  parsePackageInfo,
  readPackageInfo,
  type FetchLike,
  type FetchResponseLike,
} from '../../src/core/update-check.js';

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): FetchResponseLike {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  };
}

void describe('update-check', () => {
  void it('narrows npm latest payloads to a version string', () => {
    assert.equal(parseLatestVersionPayload({ version: '1.2.3' }), '1.2.3');
    assert.equal(parseLatestVersionPayload({ version: ' 1.2.3 ' }), '1.2.3');
    assert.equal(parseLatestVersionPayload({ name: 'pkg', version: '0.4.0' }), '0.4.0');
    assert.equal(parseLatestVersionPayload({ version: '' }), undefined);
    assert.equal(parseLatestVersionPayload({ version: 5 }), undefined);
    assert.equal(parseLatestVersionPayload({}), undefined);
    assert.equal(parseLatestVersionPayload(null), undefined);
    assert.equal(parseLatestVersionPayload('0.4.0'), undefined);
    assert.equal(parseLatestVersionPayload(undefined), undefined);
  });

  void it('narrows package.json payloads to name/version', () => {
    assert.deepEqual(
      parsePackageInfo({ name: 'pi-background-tasks', version: '0.4.0', extra: 1 }),
      { name: 'pi-background-tasks', version: '0.4.0' },
    );
    assert.deepEqual(parsePackageInfo({ version: '0.4.0' }), { version: '0.4.0' });
    assert.deepEqual(parsePackageInfo({ name: '  ' }), {});
    assert.deepEqual(parsePackageInfo(42), {});
    assert.deepEqual(parsePackageInfo(null), {});
  });

  void it('fetches and parses the latest version through an injected fetch', async () => {
    let requestedUrl = '';
    const fetchImpl: FetchLike = (url) => {
      requestedUrl = url;
      return Promise.resolve(jsonResponse({ name: 'pi-background-tasks', version: '9.9.9' }));
    };
    const latest = await fetchLatestVersion({
      packageName: 'pi-background-tasks',
      registryUrl: 'https://example.test/',
      fetchImpl,
    });
    assert.equal(latest, '9.9.9');
    assert.equal(requestedUrl, 'https://example.test/pi-background-tasks/latest');
    assert.match(DEFAULT_NPM_REGISTRY_URL, /^https:\/\/registry\.npmjs\.org$/);
  });

  void it('returns undefined for non-ok status without throwing', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(jsonResponse({ version: '9.9.9' }, { ok: false, status: 404 }));
    assert.equal(
      await fetchLatestVersion({ packageName: 'pi-background-tasks', fetchImpl }),
      undefined,
    );
  });

  void it('returns undefined and reports the error when fetch throws', async () => {
    const errors: string[] = [];
    const fetchImpl: FetchLike = () => Promise.reject(new Error('network down'));
    const latest = await fetchLatestVersion({
      packageName: 'pi-background-tasks',
      fetchImpl,
      onError: (error) => {
        errors.push(error.message);
      },
    });
    assert.equal(latest, undefined);
    assert.deepEqual(errors, ['network down']);
  });

  void it('silently skips only the AbortError owned by the internal timeout', async () => {
    const errors: string[] = [];
    // Reject with the same AbortError DOMException the runtime fetch throws on
    // abort, so the test exercises the exact production timeout path.
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<FetchResponseLike>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    const start = Date.now();
    const latest = await fetchLatestVersion({
      packageName: 'pi-background-tasks',
      timeoutMs: 10,
      fetchImpl,
      onError: (error) => {
        errors.push(error.message);
      },
    });
    assert.equal(latest, undefined);
    assert.ok(Date.now() - start < 2000, 'timeout must fire well before the default window');
    // The timer owns this abort, so expected registry slowness stays silent.
    assert.deepEqual(errors, []);
  });

  void it('reports an AbortError not initiated by the internal timeout', async () => {
    const errors: string[] = [];
    const latest = await fetchLatestVersion({
      packageName: 'pi-background-tasks',
      timeoutMs: 1000,
      fetchImpl: () =>
        Promise.reject(new DOMException('transport aborted independently', 'AbortError')),
      onError: (error) => {
        errors.push(error.message);
      },
    });
    assert.equal(latest, undefined);
    assert.deepEqual(errors, ['transport aborted independently']);
  });

  void it('reads name/version from a local package.json and degrades on failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-bg-pkg-'));
    try {
      const good = join(dir, 'good.json');
      await writeFile(good, JSON.stringify({ name: 'pi-background-tasks', version: '0.4.0' }));
      assert.deepEqual(readPackageInfo(good), { name: 'pi-background-tasks', version: '0.4.0' });

      const broken = join(dir, 'broken.json');
      await writeFile(broken, '{ not json');
      const errors: string[] = [];
      assert.deepEqual(
        readPackageInfo(broken, (error) => {
          errors.push(error.message);
        }),
        {},
      );
      assert.equal(errors.length, 1);

      assert.deepEqual(readPackageInfo(join(dir, 'missing.json')), {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
