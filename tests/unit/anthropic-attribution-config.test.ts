import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ANTHROPIC_ACCOUNT_CONFIG_PATH_ENV,
  loadClaudeAttributionAccount,
} from '../../src/core/anthropic-attribution.js';
import { attestedPiChildEnv } from '../../src/core/attested-pi-run.js';
import { delegateChildEnv } from '../../src/core/delegate/launch.js';
import { fusionPiChildEnv } from '../../src/core/fusion/pi-child.js';

const ACCOUNT_CONFIG_PATH_ENV = ANTHROPIC_ACCOUNT_CONFIG_PATH_ENV;

async function writeAccount(path: string, deviceId: string, accountUuid: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({ userID: deviceId, oauthAccount: { accountUuid } })}\n`,
    'utf8',
  );
}

async function withAccountEnvironment<T>(
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-attribution-config-'));
  const priorHome = process.env['HOME'];
  const priorSelectedPath = process.env[ACCOUNT_CONFIG_PATH_ENV];
  process.env['HOME'] = join(root, 'home');
  Reflect.deleteProperty(process.env, ACCOUNT_CONFIG_PATH_ENV);
  await mkdir(process.env['HOME'], { recursive: true });
  try {
    return await run(root);
  } finally {
    if (priorHome === undefined) Reflect.deleteProperty(process.env, 'HOME');
    else process.env['HOME'] = priorHome;
    if (priorSelectedPath === undefined)
      Reflect.deleteProperty(process.env, ACCOUNT_CONFIG_PATH_ENV);
    else process.env[ACCOUNT_CONFIG_PATH_ENV] = priorSelectedPath;
    await rm(root, { recursive: true, force: true });
  }
}

void describe('Anthropic attribution account config path (#13)', () => {
  void it('retains the home file as the default when no override is selected', async () => {
    await withAccountEnvironment(async () => {
      await writeAccount(
        join(process.env['HOME'] ?? '', '.claude.json'),
        'home-device',
        'home-account',
      );
      assert.deepEqual(loadClaudeAttributionAccount(), {
        deviceId: 'home-device',
        accountUuid: 'home-account',
      });
    });
  });

  void it('selects the absolute operator path ahead of the home default', async () => {
    await withAccountEnvironment(async (root) => {
      const selected = join(root, 'operator', 'claude-account.json');
      await mkdir(join(root, 'operator'), { recursive: true });
      await writeAccount(selected, 'operator-device', 'operator-account');
      await writeAccount(join(process.env['HOME'] ?? '', '.claude.json'), 'home-device', 'home-account');
      process.env[ACCOUNT_CONFIG_PATH_ENV] = selected;

      assert.deepEqual(loadClaudeAttributionAccount(), {
        deviceId: 'operator-device',
        accountUuid: 'operator-account',
      });
    });
  });

  void it('gives a direct absolute loader path precedence over the operator environment', async () => {
    await withAccountEnvironment(async (root) => {
      const selected = join(root, 'selected.json');
      const direct = join(root, 'direct.json');
      await writeAccount(selected, 'selected-device', 'selected-account');
      await writeAccount(direct, 'direct-device', 'direct-account');
      process.env[ACCOUNT_CONFIG_PATH_ENV] = selected;

      assert.deepEqual(loadClaudeAttributionAccount(direct), {
        deviceId: 'direct-device',
        accountUuid: 'direct-account',
      });
    });
  });

  void it('rejects a relative direct loader path even when the environment is absolute', async () => {
    await withAccountEnvironment(async (root) => {
      const selected = join(root, 'selected.json');
      await writeAccount(selected, 'selected-device', 'selected-account');
      process.env[ACCOUNT_CONFIG_PATH_ENV] = selected;
      assert.throws(
        () => loadClaudeAttributionAccount('relative/direct.json'),
        /explicit configPath.*absolute/u,
      );
    });
  });

  for (const selected of ['', 'relative/claude.json']) {
    void it(`rejects ${selected.length === 0 ? 'an empty' : 'a relative'} operator path`, async () => {
      await withAccountEnvironment(async () => {
        await writeAccount(
          join(process.env['HOME'] ?? '', '.claude.json'),
          'home-device',
          'home-account',
        );
        process.env[ACCOUNT_CONFIG_PATH_ENV] = selected;
        assert.throws(
          () => loadClaudeAttributionAccount(),
          new RegExp(`${ACCOUNT_CONFIG_PATH_ENV}.*absolute`, 'u'),
        );
      });
    });
  }

  void it('reports the selected file for malformed JSON and required-field failures', async () => {
    await withAccountEnvironment(async (root) => {
      const selected = join(root, 'broken.json');
      process.env[ACCOUNT_CONFIG_PATH_ENV] = selected;
      assert.throws(
        () => loadClaudeAttributionAccount(),
        (error: unknown) =>
          error instanceof Error && error.message.includes(selected) && /could not be read/u.test(error.message),
      );

      await writeFile(selected, '{', 'utf8');
      assert.throws(
        () => loadClaudeAttributionAccount(),
        (error: unknown) =>
          error instanceof Error && error.message.includes(selected) && /invalid JSON/u.test(error.message),
      );

      await writeFile(selected, `${JSON.stringify({ userID: 'device', oauthAccount: {} })}\n`, 'utf8');
      assert.throws(
        () => loadClaudeAttributionAccount(),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(selected) &&
          error.message.includes('oauthAccount.accountUuid'),
      );
    });
  });

  void it('preserves the selected path in package-owned child environments', () => {
    const selected = '/operator/config/claude-account.json';
    const parent = {
      [ACCOUNT_CONFIG_PATH_ENV]: selected,
      ANTHROPIC_API_KEY: 'metered-key-must-be-removed-where-required',
    };
    const delegate = delegateChildEnv(
      {
        artifactDirAbs: '/tmp/artifacts',
        seedPathAbs: '/tmp/seed.json',
        seedSha256: 'a'.repeat(64),
        taskId: 'b123',
        launchNonce: 'nonce',
      },
      parent,
    );
    const fusion = fusionPiChildEnv(parent, 'anthropic');
    const attested = attestedPiChildEnv(parent);

    for (const child of [delegate, fusion, attested]) {
      assert.equal(child[ACCOUNT_CONFIG_PATH_ENV], selected);
      assert.equal(JSON.stringify(child).includes('operator-device-secret'), false);
    }
    assert.equal(fusion['ANTHROPIC_API_KEY'], undefined);
    assert.equal(attested['ANTHROPIC_API_KEY'], undefined);
  });
});
