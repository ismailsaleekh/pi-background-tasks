import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertWindowsCommandLineWithinLimit,
  piLaunchArgv,
  resolvePiLaunch,
  resolvePiManifestFromHostScript,
  type PiLaunchDependencies,
  type PiLaunchSpec,
} from '../../src/core/pi-launch.js';

interface PackageFixture {
  readonly root: string;
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly deps: PiLaunchDependencies;
}

async function writeNestedFile(path: string, content = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function depsFor(manifestPath: string): PiLaunchDependencies {
  return {
    platform: 'win32',
    execPath: process.execPath,
    resolvePackageJson: () => manifestPath,
    readFile: (path) => readFileSync(path),
    realpath: (path) => realpathSync(path),
    stat: (path) => statSync(path),
  };
}

async function createPackageFixture(
  manifest: unknown,
  files: readonly string[],
): Promise<PackageFixture> {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-launch-'));
  const packageRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
  const manifestPath = join(packageRoot, 'package.json');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  for (const file of files) await writeNestedFile(join(packageRoot, file));
  return { root, packageRoot, manifestPath, deps: depsFor(manifestPath) };
}

async function removeFixture(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

void describe('Pi launch resolution', () => {
  void it('returns the bare path form on POSIX without package lookup', () => {
    let resolved = false;
    const spec = resolvePiLaunch({
      platform: 'darwin',
      resolvePackageJson: () => {
        resolved = true;
        throw new Error('should not run');
      },
    });
    assert.deepEqual(spec, { executable: 'pi', argvPrefix: [], kind: 'path' });
    assert.equal(resolved, false);
  });

  void it('resolves a Windows string bin JavaScript CLI through Node', async () => {
    const fixture = await createPackageFixture({ bin: 'dist/cli.js' }, ['dist/cli.js']);
    try {
      const spec = resolvePiLaunch(fixture.deps);
      assert.equal(spec.executable, process.execPath);
      assert.equal(spec.kind, 'package-node-cli');
      assert.equal(spec.argvPrefix.length, 1);
      const cli = spec.argvPrefix[0];
      assert.ok(cli);
      assert.equal(cli, realpathSync(join(fixture.packageRoot, 'dist', 'cli.js')));
      assert.deepEqual(piLaunchArgv(spec, ['--mode', 'json']), [cli, '--mode', 'json']);
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('resolves a Windows object bin JavaScript CLI through Node', async () => {
    const fixture = await createPackageFixture({ bin: { pi: 'dist/cli.cjs' } }, ['dist/cli.cjs']);
    try {
      const spec = resolvePiLaunch(fixture.deps);
      assert.equal(spec.executable, process.execPath);
      assert.equal(spec.argvPrefix.length, 1);
      assert.equal(spec.argvPrefix[0], realpathSync(join(fixture.packageRoot, 'dist', 'cli.cjs')));
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('permits direct Windows native executable package bins', async () => {
    for (const extension of ['.exe', '.com']) {
      const file = `dist/pi${extension}`;
      const fixture = await createPackageFixture({ bin: { pi: file } }, [file]);
      try {
        const spec = resolvePiLaunch(fixture.deps);
        assert.equal(spec.executable, realpathSync(join(fixture.packageRoot, file)));
        assert.deepEqual(spec.argvPrefix, []);
      } finally {
        await removeFixture(fixture.root);
      }
    }
  });

  void it('rejects command shims, scripts, extensionless targets, and unknown extensions', async () => {
    for (const extension of ['.cmd', '.bat', '.ps1', '', '.txt']) {
      const file = `dist/pi${extension}`;
      const fixture = await createPackageFixture({ bin: { pi: file } }, [file]);
      try {
        assert.throws(
          () => resolvePiLaunch(fixture.deps),
          /pi_executable_resolution_failed: Pi package bin target extension is unsupported/,
        );
      } finally {
        await removeFixture(fixture.root);
      }
    }
  });

  void it('rejects package bin targets that escape the package root', async () => {
    const fixture = await createPackageFixture({ bin: '../outside/cli.js' }, []);
    try {
      await writeNestedFile(join(fixture.packageRoot, '..', 'outside', 'cli.js'));
      assert.throws(
        () => resolvePiLaunch(fixture.deps),
        /pi_executable_resolution_failed: Pi package bin target resolves outside the package root/,
      );
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('rejects malformed manifests, missing manifests, missing bins, and non-file targets', async () => {
    const malformed = await createPackageFixture({ bin: 'dist/cli.js' }, ['dist/cli.js']);
    try {
      await writeFile(malformed.manifestPath, '{', 'utf8');
      assert.throws(() => resolvePiLaunch(malformed.deps), /pi_executable_resolution_failed/);
    } finally {
      await removeFixture(malformed.root);
    }

    const missingRoot = await mkdtemp(join(tmpdir(), 'pi-bg-launch-missing-'));
    try {
      const missingManifest = join(missingRoot, 'package.json');
      assert.throws(() => resolvePiLaunch(depsFor(missingManifest)), /pi_executable_resolution_failed/);
    } finally {
      await rm(missingRoot, { recursive: true, force: true });
    }

    const missingBin = await createPackageFixture({}, []);
    try {
      assert.throws(() => resolvePiLaunch(missingBin.deps), /pi_executable_resolution_failed/);
    } finally {
      await removeFixture(missingBin.root);
    }

    const directoryTarget = await createPackageFixture({ bin: 'dist/cli.js' }, []);
    try {
      await mkdir(join(directoryTarget.packageRoot, 'dist', 'cli.js'), { recursive: true });
      assert.throws(() => resolvePiLaunch(directoryTarget.deps), /regular file/);
    } finally {
      await removeFixture(directoryTarget.root);
    }
  });

  void it('falls through to the running host script when both module lookups fail on Windows', async () => {
    const fixture = await createPackageFixture(
      { name: '@earendil-works/pi-coding-agent', bin: { pi: 'dist/cli.js' } },
      ['dist/cli.js'],
    );
    try {
      const attempted: string[] = [];
      const { resolvePackageJson: _ignored, ...io } = fixture.deps;
      const spec = resolvePiLaunch({
        ...io,
        resolveModule: (specifier) => {
          attempted.push(specifier);
          throw new Error(`Cannot find module '${specifier}'`);
        },
        hostScript: join(fixture.packageRoot, 'dist', 'cli.js'),
      });
      assert.deepEqual(attempted, [
        '@earendil-works/pi-coding-agent/package.json',
        '@earendil-works/pi-coding-agent',
      ]);
      assert.equal(spec.executable, process.execPath);
      assert.equal(spec.kind, 'package-node-cli');
      assert.equal(spec.argvPrefix[0], realpathSync(join(fixture.packageRoot, 'dist', 'cli.js')));
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('walks past a nameless sub-manifest to reach the Pi manifest', async () => {
    const fixture = await createPackageFixture(
      { name: '@earendil-works/pi-coding-agent', bin: { pi: 'dist/cli.js' } },
      ['dist/cli.js'],
    );
    try {
      await writeFile(join(fixture.packageRoot, 'dist', 'package.json'), '{"type":"module"}\n', 'utf8');
      const manifest = resolvePiManifestFromHostScript(join(fixture.packageRoot, 'dist', 'cli.js'));
      assert.equal(manifest, realpathSync(fixture.manifestPath));
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('fails closed with every attempt named when the host script belongs to another package', async () => {
    const foreign = await createPackageFixture({ name: 'some-other-cli', bin: 'dist/cli.js' }, [
      'dist/cli.js',
    ]);
    try {
      const { resolvePackageJson: _ignored, ...io } = foreign.deps;
      assert.throws(
        () =>
          resolvePiLaunch({
            ...io,
            resolveModule: (specifier) => {
              throw new Error(`Cannot find module '${specifier}'`);
            },
            hostScript: join(foreign.packageRoot, 'dist', 'cli.js'),
          }),
        /pi_executable_resolution_failed: package manifest resolve failed .*Cannot find module '@earendil-works\/pi-coding-agent\/package.json'; package entry resolve failed: .*; host script resolve failed: nearest named manifest above host script is some-other-cli/,
      );
    } finally {
      await removeFixture(foreign.root);
    }

    assert.throws(() => resolvePiManifestFromHostScript(undefined), /host script path is unavailable/);
  });

  void it('rejects oversized Windows command lines without leaking argument text', () => {
    const launch: PiLaunchSpec = {
      executable: 'C:\\Node\\node.exe',
      argvPrefix: ['C:\\pkg\\cli.js'],
      kind: 'package-node-cli',
    };
    assert.doesNotThrow(() =>
      assertWindowsCommandLineWithinLimit(launch, ['--model', 'gpt-5.5'], 'win32', 'unit-stage'),
    );
    const secret = 'SECRET_TOKEN_VALUE';
    assert.throws(
      () =>
        assertWindowsCommandLineWithinLimit(
          launch,
          [secret.repeat(3000)],
          'win32',
          'oversized-stage',
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /oversized-stage/);
        assert.match(error.message, /32767/);
        assert.doesNotMatch(error.message, /SECRET_TOKEN_VALUE/);
        return true;
      },
    );
    assert.doesNotThrow(() =>
      assertWindowsCommandLineWithinLimit(launch, [secret.repeat(3000)], 'linux', 'posix-stage'),
    );
  });
});
