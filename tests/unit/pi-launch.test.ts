import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertWindowsCommandLineWithinLimit,
  piLaunchArgv,
  resolvePiLaunch,
  type PiLaunchDependencies,
  type PiLaunchSpec,
} from '../../src/core/pi-launch.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const PI_PACKAGE_MANIFEST = `${PI_PACKAGE_NAME}/package.json`;

interface PackageFixture {
  readonly root: string;
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly cliPath?: string | undefined;
  readonly deps: PiLaunchDependencies;
}

interface FixtureFile {
  readonly path: string;
  readonly content?: string | undefined;
  readonly mode?: number | undefined;
}

async function writeNestedFile(path: string, content = '', mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  if (mode !== undefined) await chmod(path, mode);
}

function depsFor(manifestPath: string): PiLaunchDependencies {
  return {
    platform: 'win32',
    execPath: process.execPath,
    hostScript: '',
    resolvePackageJson: (specifier) => {
      assert.equal(specifier, PI_PACKAGE_MANIFEST);
      return manifestPath;
    },
    readFile: (path) => readFileSync(path),
    realpath: (path) => realpathSync(path),
    stat: (path) => statSync(path),
  };
}

async function createPackageFixture(
  manifest: unknown,
  files: readonly (string | FixtureFile)[],
  prefix = 'pi-bg-launch-',
): Promise<PackageFixture> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const packageRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
  const manifestPath = join(packageRoot, 'package.json');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  for (const entry of files) {
    const file = typeof entry === 'string' ? { path: entry } : entry;
    await writeNestedFile(
      join(packageRoot, file.path),
      file.content ?? '',
      file.mode,
    );
  }
  const bin =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'bin')
      : undefined;
  const relativeCli =
    typeof bin === 'string'
      ? bin
      : typeof bin === 'object' && bin !== null && typeof Reflect.get(bin, 'pi') === 'string'
        ? String(Reflect.get(bin, 'pi'))
        : undefined;
  return {
    root,
    packageRoot,
    manifestPath,
    cliPath: relativeCli === undefined ? undefined : join(packageRoot, relativeCli),
    deps: depsFor(manifestPath),
  };
}

async function createPiPackage(
  bin = 'dist/cli.js',
  prefix = 'pi-bg-launch-',
): Promise<PackageFixture> {
  return createPackageFixture(
    { name: PI_PACKAGE_NAME, bin: { pi: bin } },
    [{ path: bin, content: '#!/usr/bin/env node\n', mode: 0o755 }],
    prefix,
  );
}

async function removeFixture(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

function noModuleResolution(): (specifier: string) => string {
  return (specifier) => {
    throw new Error(`Cannot resolve ${specifier}`);
  };
}

void describe('Pi launch resolution', () => {
  void it('returns the canonical executable admitted from POSIX PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-launch-path-'));
    try {
      const executable = join(root, 'pi');
      await writeNestedFile(executable, '#!/bin/sh\n', 0o755);
      let resolved = false;
      const spec = resolvePiLaunch({
        platform: 'darwin',
        path: root,
        hostScript: join(root, 'unused-host.js'),
        resolvePackageJson: () => {
          resolved = true;
          throw new Error('should not run');
        },
      });
      assert.deepEqual(spec, {
        executable: realpathSync(executable),
        argvPrefix: [],
        kind: 'path',
      });
      assert.equal(resolved, false);
    } finally {
      await removeFixture(root);
    }
  });

  void it('skips non-executable and non-file PATH entries before a later valid candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-launch-path-order-'));
    try {
      const first = join(root, 'first');
      const second = join(root, 'second');
      const third = join(root, 'third');
      await writeNestedFile(join(first, 'pi'), '#!/bin/sh\n', 0o644);
      await mkdir(join(second, 'pi'), { recursive: true });
      await writeNestedFile(join(third, 'pi'), '#!/bin/sh\n', 0o755);
      const accessAttempts: string[] = [];
      const firstReal = realpathSync(join(first, 'pi'));
      const thirdReal = realpathSync(join(third, 'pi'));
      const spec = resolvePiLaunch({
        platform: 'linux',
        path: [first, second, third].join(delimiter),
        hostScript: '',
        access: (path) => {
          accessAttempts.push(path);
          if (path === firstReal) {
            const error = new Error('fixture is not executable');
            Object.assign(error, { code: 'EACCES' });
            throw error;
          }
        },
      });
      assert.deepEqual(spec, { executable: thirdReal, argvPrefix: [], kind: 'path' });
      assert.deepEqual(accessAttempts, [firstReal, thirdReal]);
    } finally {
      await removeFixture(root);
    }
  });

  void it('canonicalizes a symlinked executable PATH candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-launch-path-link-'));
    try {
      const target = join(root, 'real', 'pi-cli');
      const bin = join(root, 'bin');
      await writeNestedFile(target, '#!/bin/sh\n', 0o755);
      await mkdir(bin, { recursive: true });
      await symlink(target, join(bin, 'pi'), 'file');
      let accessed: string | undefined;
      const spec = resolvePiLaunch({
        platform: 'linux',
        path: bin,
        hostScript: '',
        access: (path) => {
          accessed = path;
        },
      });
      assert.deepEqual(spec, {
        executable: realpathSync(target),
        argvPrefix: [],
        kind: 'path',
      });
      assert.equal(accessed, realpathSync(target));
    } finally {
      await removeFixture(root);
    }
  });

  void it('cannot reselect PATH after admission when child cwd or environment changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-launch-path-binding-'));
    const originalCwd = process.cwd();
    try {
      const admittedCwd = join(root, 'admitted');
      const childCwd = join(root, 'child');
      const changedBin = join(root, 'changed-bin');
      const admitted = join(admittedCwd, 'bin', 'pi');
      const childCandidate = join(childCwd, 'bin', 'pi');
      const changedCandidate = join(changedBin, 'pi');
      const script = (identity: string) =>
        `#!/bin/sh\nprintf '${identity}:%s:%s' "$1" "$2"\n`;
      await writeNestedFile(admitted, script('ADMITTED'), 0o755);
      await writeNestedFile(childCandidate, script('CHILD_CWD'), 0o755);
      await writeNestedFile(changedCandidate, script('CHANGED_PATH'), 0o755);

      process.chdir(admittedCwd);
      const launch = resolvePiLaunch({ platform: 'darwin', path: 'bin', hostScript: '' });
      const args = ['argument with spaces', '$(printf not-executed)'];
      const relativeSpawn = spawnSync(launch.executable, piLaunchArgv(launch, args), {
        cwd: childCwd,
        env: { ...process.env, PATH: 'bin' },
        encoding: 'utf8',
        shell: false,
      });
      const changedEnvSpawn = spawnSync(launch.executable, piLaunchArgv(launch, args), {
        cwd: childCwd,
        env: { ...process.env, PATH: changedBin },
        encoding: 'utf8',
        shell: false,
      });

      const expectedExecutable = realpathSync(admitted);
      const expectedOutput = 'ADMITTED:argument with spaces:$(printf not-executed)';
      assert.equal(launch.executable, expectedExecutable);
      assert.equal(relativeSpawn.status, 0, relativeSpawn.error?.message ?? relativeSpawn.stderr);
      assert.equal(relativeSpawn.stdout, expectedOutput);
      assert.equal(changedEnvSpawn.status, 0, changedEnvSpawn.error?.message ?? changedEnvSpawn.stderr);
      assert.equal(changedEnvSpawn.stdout, expectedOutput);
    } finally {
      process.chdir(originalCwd);
      await removeFixture(root);
    }
  });

  void it('falls back to the exact named host package bin on POSIX when PATH has no pi', async () => {
    const fixture = await createPiPackage();
    try {
      const hostLink = join(fixture.root, 'host-bin', 'pi-renamed');
      await mkdir(dirname(hostLink), { recursive: true });
      assert.ok(fixture.cliPath);
      await symlink(fixture.cliPath, hostLink, 'file');
      const spec = resolvePiLaunch({
        platform: 'darwin',
        path: join(fixture.root, 'empty-bin'),
        hostScript: hostLink,
        execPath: process.execPath,
        resolvePackageJson: noModuleResolution(),
      });
      assert.deepEqual(spec, {
        executable: process.execPath,
        argvPrefix: [realpathSync(fixture.cliPath)],
        kind: 'package-node-cli',
      });
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('rejects arbitrary JavaScript hosts and a host file other than declared bin.pi', async () => {
    const arbitraryRoot = await mkdtemp(join(tmpdir(), 'pi-launch-arbitrary-host-'));
    try {
      const arbitrary = join(arbitraryRoot, 'host.js');
      await writeNestedFile(arbitrary, 'console.log("not pi")\n', 0o755);
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'linux',
            path: join(arbitraryRoot, 'empty-bin'),
            hostScript: arbitrary,
            resolvePackageJson: noModuleResolution(),
          }),
        /pi_executable_resolution_failed/,
      );
    } finally {
      await removeFixture(arbitraryRoot);
    }

    const fixture = await createPiPackage();
    try {
      const other = join(fixture.packageRoot, 'dist', 'other.js');
      await writeNestedFile(other, 'console.log("other")\n', 0o755);
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'darwin',
            path: join(fixture.root, 'empty-bin'),
            hostScript: other,
          }),
        /host script.*bin|bin.*host script/i,
      );
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('walks past a valid nameless sub-manifest but stops at named package boundaries', async () => {
    const fixture = await createPiPackage();
    try {
      const cliPath = fixture.cliPath;
      assert.ok(cliPath);
      const nestedManifest = join(fixture.packageRoot, 'dist', 'package.json');
      await writeFile(nestedManifest, '{"type":"commonjs"}\n', 'utf8');
      const spec = resolvePiLaunch({
        platform: 'linux',
        path: join(fixture.root, 'empty-bin'),
        hostScript: cliPath,
      });
      assert.equal(spec.argvPrefix[0], realpathSync(cliPath));

      await writeFile(nestedManifest, '{"name":"foreign-host"}\n', 'utf8');
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'linux',
            path: join(fixture.root, 'empty-bin'),
            hostScript: cliPath,
            resolvePackageJson: noModuleResolution(),
          }),
        /foreign-host|nearest named manifest/,
      );
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('fails closed at malformed, non-object, malformed-name, and unreadable host manifests', async () => {
    const fixture = await createPiPackage();
    try {
      const cliPath = fixture.cliPath;
      assert.ok(cliPath);
      const nestedManifest = join(fixture.packageRoot, 'dist', 'package.json');
      for (const raw of ['{', '[]\n', '{"name":42}\n']) {
        await writeFile(nestedManifest, raw, 'utf8');
        assert.throws(
          () =>
            resolvePiLaunch({
              platform: 'linux',
              path: join(fixture.root, 'empty-bin'),
              hostScript: cliPath,
            }),
          /pi_executable_resolution_failed/,
        );
      }

      await writeFile(nestedManifest, '{"name":"ignored-by-throw"}\n', 'utf8');
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'linux',
            path: join(fixture.root, 'empty-bin'),
            hostScript: cliPath,
            readFile: (path) => {
              if (path === nestedManifest) throw new Error('fixture permission denied');
              return readFileSync(path);
            },
          }),
        /fixture permission denied/,
      );
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('uses an exact installed Pi module from a foreign POSIX SDK host', async () => {
    const foreign = await createPackageFixture(
      { name: 'foreign-sdk-application', bin: 'dist/app.js' },
      ['dist/app.js'],
    );
    const moduleInstall = await createPiPackage();
    try {
      assert.ok(foreign.cliPath);
      assert.ok(moduleInstall.cliPath);
      let moduleLookups = 0;
      const spec = resolvePiLaunch({
        platform: 'linux',
        path: join(foreign.root, 'empty-bin'),
        hostScript: foreign.cliPath,
        execPath: process.execPath,
        resolvePackageJson: (specifier) => {
          assert.equal(specifier, PI_PACKAGE_MANIFEST);
          moduleLookups += 1;
          return moduleInstall.manifestPath;
        },
      });
      assert.equal(moduleLookups, 1);
      assert.deepEqual(spec, {
        executable: process.execPath,
        argvPrefix: [realpathSync(moduleInstall.cliPath)],
        kind: 'package-node-cli',
      });
    } finally {
      await removeFixture(foreign.root);
      await removeFixture(moduleInstall.root);
    }
  });

  void it('rejects a foreign package returned by the POSIX SDK module route', async () => {
    const foreignHost = await createPackageFixture(
      { name: 'foreign-sdk-application', bin: 'dist/app.js' },
      ['dist/app.js'],
    );
    const lookalike = await createPackageFixture(
      { name: 'lookalike-pi', bin: { pi: 'dist/cli.js' } },
      ['dist/cli.js'],
    );
    try {
      const foreignHostCli = foreignHost.cliPath;
      assert.ok(foreignHostCli);
      let moduleLookups = 0;
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'darwin',
            path: join(foreignHost.root, 'empty-bin'),
            hostScript: foreignHostCli,
            execPath: process.execPath,
            resolvePackageJson: () => {
              moduleLookups += 1;
              return lookalike.manifestPath;
            },
          }),
        /lookalike-pi|package name/i,
      );
      assert.equal(moduleLookups, 1);
    } finally {
      await removeFixture(foreignHost.root);
      await removeFixture(lookalike.root);
    }
  });

  void it('uses the named running host package before a different Windows module installation', async () => {
    const host = await createPiPackage('dist/host cli.js', 'pi-bg-host spaces-');
    const moduleInstall = await createPiPackage('dist/module.js');
    try {
      assert.ok(host.cliPath);
      assert.ok(moduleInstall.cliPath);
      const spec = resolvePiLaunch({
        platform: 'win32',
        hostScript: host.cliPath,
        execPath: process.execPath,
        resolvePackageJson: () => moduleInstall.manifestPath,
      });
      assert.deepEqual(spec, {
        executable: process.execPath,
        argvPrefix: [realpathSync(host.cliPath)],
        kind: 'package-node-cli',
      });
    } finally {
      await removeFixture(host.root);
      await removeFixture(moduleInstall.root);
    }
  });

  void it('falls through from a foreign Windows host to an exact named module package', async () => {
    const foreign = await createPackageFixture(
      { name: 'foreign-sdk-host', bin: { pi: 'dist/host.js' } },
      ['dist/host.js'],
    );
    const moduleInstall = await createPiPackage();
    try {
      assert.ok(foreign.cliPath);
      assert.ok(moduleInstall.cliPath);
      const spec = resolvePiLaunch({
        platform: 'win32',
        hostScript: foreign.cliPath,
        execPath: process.execPath,
        resolvePackageJson: () => moduleInstall.manifestPath,
      });
      assert.equal(spec.argvPrefix[0], realpathSync(moduleInstall.cliPath));
    } finally {
      await removeFixture(foreign.root);
      await removeFixture(moduleInstall.root);
    }
  });

  void it('does not substitute a module when Windows host source realpath has an I/O failure', async () => {
    const host = await createPiPackage();
    const moduleInstall = await createPiPackage();
    try {
      const hostCli = host.cliPath;
      assert.ok(hostCli);
      for (const code of ['EACCES', 'EIO']) {
        let moduleLookups = 0;
        assert.throws(
          () =>
            resolvePiLaunch({
              platform: 'win32',
              hostScript: hostCli,
              execPath: process.execPath,
              resolvePackageJson: () => {
                moduleLookups += 1;
                return moduleInstall.manifestPath;
              },
              realpath: (path) => {
                if (path === hostCli) {
                  const error = new Error(`fixture ${code} for running host`);
                  Object.assign(error, { code });
                  throw error;
                }
                return realpathSync(path);
              },
            }),
          new RegExp(`source realpath.*fixture ${code}`, 'i'),
        );
        assert.equal(moduleLookups, 0, `${code} must forbid module substitution`);
      }
    } finally {
      await removeFixture(host.root);
      await removeFixture(moduleInstall.root);
    }
  });

  void it('does not silently fall back when a named Windows Pi host has an invalid bin', async () => {
    const host = await createPackageFixture(
      { name: PI_PACKAGE_NAME, bin: { pi: 'dist/missing.js' } },
      ['dist/host.js'],
    );
    const moduleInstall = await createPiPackage();
    try {
      const hostScript = join(host.packageRoot, 'dist', 'host.js');
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'win32',
            hostScript,
            execPath: process.execPath,
            resolvePackageJson: () => moduleInstall.manifestPath,
          }),
        /pi_executable_resolution_failed/,
      );
    } finally {
      await removeFixture(host.root);
      await removeFixture(moduleInstall.root);
    }
  });

  void it('uses the Windows host walk when package module lookups are unavailable', async () => {
    const fixture = await createPiPackage();
    try {
      assert.ok(fixture.cliPath);
      const attempted: string[] = [];
      const spec = resolvePiLaunch({
        platform: 'win32',
        hostScript: fixture.cliPath,
        execPath: process.execPath,
        resolveModule: (specifier) => {
          attempted.push(specifier);
          throw new Error(`Cannot find module '${specifier}'`);
        },
      });
      assert.equal(spec.argvPrefix[0], realpathSync(fixture.cliPath));
      assert.deepEqual(attempted, [], 'a verified running host must be authoritative');
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('resolves a named manifest by walking from a Windows package entry fallback', async () => {
    const fixture = await createPiPackage();
    const foreignRoot = await mkdtemp(join(tmpdir(), 'pi-launch-sdk-host-'));
    try {
      const foreignHost = join(foreignRoot, 'app.js');
      await writeNestedFile(foreignHost, '', 0o755);
      assert.ok(fixture.cliPath);
      const attempted: string[] = [];
      const spec = resolvePiLaunch({
        platform: 'win32',
        hostScript: foreignHost,
        execPath: process.execPath,
        resolveModule: (specifier) => {
          attempted.push(specifier);
          if (specifier === PI_PACKAGE_MANIFEST) throw new Error('manifest export unavailable');
          if (specifier === PI_PACKAGE_NAME) return fixture.cliPath as string;
          throw new Error(`unexpected ${specifier}`);
        },
      });
      assert.deepEqual(attempted, [PI_PACKAGE_MANIFEST, PI_PACKAGE_NAME]);
      assert.equal(spec.argvPrefix[0], realpathSync(fixture.cliPath));
    } finally {
      await removeFixture(fixture.root);
      await removeFixture(foreignRoot);
    }
  });

  void it('requires the exact Pi package name for direct Windows module manifests', async () => {
    const fixture = await createPackageFixture(
      { name: 'lookalike-pi', bin: { pi: 'dist/cli.js' } },
      ['dist/cli.js'],
    );
    try {
      assert.throws(
        () => resolvePiLaunch(fixture.deps),
        /pi_executable_resolution_failed.*lookalike-pi|package name/i,
      );
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('resolves Windows string and object JavaScript bins through a generic runtime', async () => {
    for (const manifest of [
      { name: PI_PACKAGE_NAME, bin: 'dist/cli.js' },
      { name: PI_PACKAGE_NAME, bin: { pi: 'dist/cli.cjs' } },
      { name: PI_PACKAGE_NAME, bin: { pi: 'dist/cli.mjs' } },
    ]) {
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.pi;
      const fixture = await createPackageFixture(manifest, [bin]);
      try {
        const spec = resolvePiLaunch(fixture.deps);
        assert.equal(spec.executable, process.execPath);
        assert.equal(spec.kind, 'package-node-cli');
        assert.deepEqual(spec.argvPrefix, [realpathSync(join(fixture.packageRoot, bin))]);
        assert.deepEqual(piLaunchArgv(spec, ['--mode', 'json']), [
          realpathSync(join(fixture.packageRoot, bin)),
          '--mode',
          'json',
        ]);
      } finally {
        await removeFixture(fixture.root);
      }
    }
  });

  void it('retains direct Windows native package bins without a shell or argv prefix', async () => {
    for (const extension of ['.exe', '.com']) {
      const file = `dist/pi${extension}`;
      const fixture = await createPackageFixture(
        { name: PI_PACKAGE_NAME, bin: { pi: file } },
        [file],
      );
      try {
        const spec = resolvePiLaunch(fixture.deps);
        assert.deepEqual(spec, {
          executable: realpathSync(join(fixture.packageRoot, file)),
          argvPrefix: [],
          kind: 'package-node-cli',
        });
      } finally {
        await removeFixture(fixture.root);
      }
    }
  });

  void it('uses a direct compiled route only for an executable explicitly named Pi', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-launch-compiled-'));
    const moduleInstall = await createPiPackage();
    try {
      const compiled = join(root, 'pi');
      await writeNestedFile(compiled, 'compiled fixture\n', 0o755);
      const spec = resolvePiLaunch({
        platform: 'linux',
        execPath: compiled,
        hostScript: '/$bunfs/root/cli.js',
        path: join(root, 'empty-bin'),
      });
      assert.deepEqual(spec, {
        executable: realpathSync(compiled),
        argvPrefix: [],
        kind: 'compiled-host',
      });

      const arbitrarySdkApp = join(root, 'custom-sdk-application');
      await writeNestedFile(arbitrarySdkApp, 'compiled SDK fixture\n', 0o755);
      let moduleLookups = 0;
      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'linux',
            execPath: arbitrarySdkApp,
            hostScript: '/$bunfs/root/custom-sdk-app.js',
            path: join(root, 'empty-bin'),
            resolvePackageJson: () => {
              moduleLookups += 1;
              return moduleInstall.manifestPath;
            },
          }),
        /generic JavaScript runtime|cannot launch.*JavaScript/i,
      );
      assert.equal(moduleLookups, 1, 'an arbitrary compiled SDK app must not bypass package lookup');

      const compiledWindows = join(root, 'pi.exe');
      await writeNestedFile(compiledWindows, 'compiled Windows fixture\n');
      assert.deepEqual(
        resolvePiLaunch({
          platform: 'win32',
          execPath: compiledWindows,
          hostScript: '',
        }),
        {
          executable: realpathSync(compiledWindows),
          argvPrefix: [],
          kind: 'compiled-host',
        },
      );

      assert.throws(
        () =>
          resolvePiLaunch({
            platform: 'linux',
            execPath: process.execPath,
            hostScript: '/$bunfs/root/cli.js',
            path: join(root, 'empty-bin'),
            resolvePackageJson: noModuleResolution(),
          }),
        /pi_executable_resolution_failed/,
      );
    } finally {
      await removeFixture(root);
      await removeFixture(moduleInstall.root);
    }
  });

  void it('rejects command shims, shell scripts, extensionless targets, and unknown extensions', async () => {
    for (const extension of ['.cmd', '.bat', '.ps1', '', '.txt']) {
      const file = `dist/pi${extension}`;
      const fixture = await createPackageFixture(
        { name: PI_PACKAGE_NAME, bin: { pi: file } },
        [file],
      );
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

  void it('rejects absolute, lexical, and symlink bin escapes from the package root', async () => {
    for (const absoluteBin of [
      join(tmpdir(), 'outside-cli.js'),
      'C:\\outside\\cli.js',
      'C:relative\\cli.js',
      '\\\\server\\share\\cli.js',
    ]) {
      const absolute = await createPackageFixture(
        { name: PI_PACKAGE_NAME, bin: { pi: absoluteBin } },
        [],
      );
      try {
        assert.throws(() => resolvePiLaunch(absolute.deps), /absolute|outside the package root/);
      } finally {
        await removeFixture(absolute.root);
      }
    }

    const lexical = await createPackageFixture(
      { name: PI_PACKAGE_NAME, bin: { pi: '../outside/cli.js' } },
      [],
    );
    try {
      await writeNestedFile(join(lexical.packageRoot, '..', 'outside', 'cli.js'));
      assert.throws(
        () => resolvePiLaunch(lexical.deps),
        /pi_executable_resolution_failed: Pi package bin target (?:path escapes|resolves outside) the package root/,
      );
    } finally {
      await removeFixture(lexical.root);
    }

    const linked = await createPackageFixture(
      { name: PI_PACKAGE_NAME, bin: { pi: 'dist/cli.js' } },
      [],
    );
    try {
      const outside = join(linked.root, 'outside.js');
      await writeNestedFile(outside, '');
      await mkdir(join(linked.packageRoot, 'dist'), { recursive: true });
      await symlink(outside, join(linked.packageRoot, 'dist', 'cli.js'), 'file');
      assert.throws(() => resolvePiLaunch(linked.deps), /outside the package root/);
    } finally {
      await removeFixture(linked.root);
    }
  });

  void it('accepts canonical in-package bin symlinks and a symlinked package path', async () => {
    const fixture = await createPackageFixture(
      { name: PI_PACKAGE_NAME, bin: { pi: 'bin/pi.js' } },
      ['dist/real-cli.js'],
    );
    try {
      await mkdir(join(fixture.packageRoot, 'bin'), { recursive: true });
      await symlink('../dist/real-cli.js', join(fixture.packageRoot, 'bin', 'pi.js'), 'file');
      const packageAlias = join(fixture.root, 'package-alias');
      await symlink(
        fixture.packageRoot,
        packageAlias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const aliasManifest = join(packageAlias, 'package.json');
      const spec = resolvePiLaunch(depsFor(aliasManifest));
      assert.equal(spec.argvPrefix[0], realpathSync(join(fixture.packageRoot, 'dist', 'real-cli.js')));
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('rejects malformed/missing manifests, malformed bins, non-files, and JS under a non-runtime', async () => {
    const malformed = await createPiPackage();
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
      await removeFixture(missingRoot);
    }

    for (const manifest of [
      { name: PI_PACKAGE_NAME },
      { name: PI_PACKAGE_NAME, bin: {} },
      { name: PI_PACKAGE_NAME, bin: { pi: '   ' } },
    ]) {
      const fixture = await createPackageFixture(manifest, []);
      try {
        assert.throws(() => resolvePiLaunch(fixture.deps), /pi_executable_resolution_failed/);
      } finally {
        await removeFixture(fixture.root);
      }
    }

    const directoryTarget = await createPackageFixture(
      { name: PI_PACKAGE_NAME, bin: { pi: 'dist/cli.js' } },
      [],
    );
    try {
      await mkdir(join(directoryTarget.packageRoot, 'dist', 'cli.js'), { recursive: true });
      assert.throws(() => resolvePiLaunch(directoryTarget.deps), /regular file/);
    } finally {
      await removeFixture(directoryTarget.root);
    }

    const jsTarget = await createPiPackage();
    try {
      const nonRuntime = join(jsTarget.root, 'compiled-host.exe');
      await writeNestedFile(nonRuntime, '');
      assert.throws(
        () => resolvePiLaunch({ ...jsTarget.deps, execPath: nonRuntime }),
        /generic JavaScript runtime|cannot launch.*JavaScript/i,
      );
    } finally {
      await removeFixture(jsTarget.root);
    }
  });

  void it('keeps spaced paths and quoted arguments as distinct Windows argv values', async () => {
    const fixture = await createPiPackage('dist/cli with spaces.js', 'pi bg launch spaced-');
    try {
      const windowsNode = 'C:\\Program Files\\nodejs\\node.exe';
      const spec = resolvePiLaunch({ ...fixture.deps, execPath: windowsNode });
      const args = ['--session-dir', 'C:\\Task Dir\\session', '--model', 'a"b\\c'];
      const argv = piLaunchArgv(spec, args);
      assert.equal(spec.executable, windowsNode);
      assert.deepEqual(argv, [realpathSync(fixture.cliPath as string), ...args]);
      assert.doesNotThrow(() =>
        assertWindowsCommandLineWithinLimit(spec, args, 'win32', 'quoted-spaced-stage'),
      );
    } finally {
      await removeFixture(fixture.root);
    }
  });

  void it('rejects oversized Windows command lines without leaking argument text', () => {
    const launch: PiLaunchSpec = {
      executable: 'C:\\Node Dir\\node.exe',
      argvPrefix: ['C:\\pkg dir\\cli.js'],
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
