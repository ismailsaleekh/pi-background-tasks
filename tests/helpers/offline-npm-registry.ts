import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

interface PackageManifest {
  readonly directory: string;
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly raw: Readonly<Record<string, unknown>>;
}

interface PackedDependency {
  readonly archive: Buffer;
  readonly integrity: string;
  readonly manifest: PackageManifest;
  readonly shasum: string;
}

interface PackageTreeSnapshot {
  readonly bytes: number;
  readonly sha256: string;
}

const MAX_FIXTURE_CLOSURE_BYTES = 100 * 1024 * 1024;

const archiveBridgeSource = [
  "'use strict';",
  "const { readdirSync } = require('node:fs');",
  "const { createRequire } = require('node:module');",
  '',
  'const [npmCli, sourceDirectory, archivePath] = process.argv.slice(2);',
  "if (!npmCli || !sourceDirectory || !archivePath) throw new Error('archive bridge arguments missing');",
  "const tar = createRequire(npmCli)('tar');",
  "if (!tar || typeof tar.c !== 'function') throw new Error('npm-bundled tar.c API is unavailable');",
  "const entries = readdirSync(sourceDirectory).filter((name) => name !== 'node_modules').sort();",
  "if (!entries.includes('package.json')) throw new Error('installed package.json is missing');",
  'const excludesNodeModules = (path) =>',
  "  !path.replaceAll('\\\\', '/').split('/').includes('node_modules');",
  'void tar.c({',
  '  cwd: sourceDirectory,',
  '  file: archivePath,',
  '  filter: excludesNodeModules,',
  '  gzip: { level: 9 },',
  "  mtime: new Date('1985-10-26T08:15:00.000Z'),",
  "  prefix: 'package/',",
  '  portable: true,',
  '}, entries).catch((error) => {',
  '  console.error(error);',
  '  process.exitCode = 1;',
  '});',
  '',
].join('\n');

export interface RegistryRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

export interface InstalledDependencyRegistry {
  readonly origin: string;
  readonly packageVersions: readonly string[];
  readonly requests: readonly RegistryRequest[];
  close(): Promise<void>;
}

export interface InstalledDependencyRegistryOptions {
  readonly dependencySpecs: Readonly<Record<string, string>>;
  readonly npmCli: string;
  readonly npmEnv: NodeJS.ProcessEnv;
  readonly packageRoot: string;
  readonly scratchDir: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new TypeError(`${label}.${key} must be a string`);
    output[key] = entry;
  }
  return output;
}

function readManifest(path: string): PackageManifest {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isObject(value)) throw new TypeError(`${path} must contain an object`);
  const name = value['name'];
  const version = value['version'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(`${path} must declare a package name`);
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError(`${path} must declare a package version`);
  }
  return {
    directory: dirname(path),
    name,
    version,
    dependencies: stringRecord(value['dependencies'], `${path} dependencies`),
    optionalDependencies: stringRecord(
      value['optionalDependencies'],
      `${path} optionalDependencies`,
    ),
    raw: value,
  };
}

function packageSegments(name: string): string[] {
  const segments = name.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`invalid installed dependency name ${JSON.stringify(name)}`);
  }
  return segments;
}

function resolveInstalledManifest(
  dependencyName: string,
  fromDirectory: string,
  packageRoot: string,
): string | undefined {
  const root = resolve(packageRoot);
  let cursor = resolve(fromDirectory);
  for (;;) {
    const candidate = join(cursor, 'node_modules', ...packageSegments(dependencyName), 'package.json');
    if (existsSync(candidate)) return candidate;
    if (cursor === root) return undefined;
    const parent = dirname(cursor);
    const fromRoot = relative(root, parent);
    if (parent === cursor || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return undefined;
    cursor = parent;
  }
}

function installedClosure(
  packageRoot: string,
  dependencySpecs: Readonly<Record<string, string>>,
): Map<string, PackageManifest> {
  const manifests = new Map<string, PackageManifest>();
  const queue = Object.keys(dependencySpecs)
    .sort()
    .map((name) => ({ fromDirectory: packageRoot, name, optional: false }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const manifestPath = resolveInstalledManifest(next.name, next.fromDirectory, packageRoot);
    if (manifestPath === undefined) {
      if (next.optional) continue;
      throw new Error(`installed production dependency ${next.name} is missing`);
    }
    const manifest = readManifest(manifestPath);
    if (manifest.name !== next.name) {
      throw new Error(
        `installed dependency ${next.name} resolved to mismatched package ${manifest.name}`,
      );
    }
    const key = `${manifest.name}@${manifest.version}`;
    if (manifests.has(key)) continue;
    manifests.set(key, manifest);
    for (const name of Object.keys(manifest.dependencies).sort()) {
      queue.push({ fromDirectory: manifest.directory, name, optional: false });
    }
    for (const name of Object.keys(manifest.optionalDependencies).sort()) {
      if (manifest.dependencies[name] === undefined) {
        queue.push({ fromDirectory: manifest.directory, name, optional: true });
      }
    }
  }
  return manifests;
}

function snapshotPackageTree(directory: string): PackageTreeSnapshot {
  const hash = createHash('sha256');
  let bytes = 0;

  const visit = (path: string, relativePath: string): void => {
    const stat = lstatSync(path);
    const mode = stat.mode & 0o7777;
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      hash.update(`link\0${relativePath}\0${String(mode)}\0${target}\0`);
      bytes += Buffer.byteLength(target);
      return;
    }
    if (stat.isFile()) {
      const contents = readFileSync(path);
      hash.update(`file\0${relativePath}\0${String(mode)}\0${String(contents.byteLength)}\0`);
      hash.update(contents);
      hash.update('\0');
      bytes += contents.byteLength;
      return;
    }
    if (!stat.isDirectory()) {
      throw new Error(`installed package contains unsupported entry ${path}`);
    }
    hash.update(`directory\0${relativePath}\0${String(mode)}\0`);
    for (const name of readdirSync(path).sort()) {
      if (name === 'node_modules') continue;
      visit(join(path, name), relativePath.length === 0 ? name : `${relativePath}/${name}`);
    }
  };

  visit(directory, '');
  return { bytes, sha256: hash.digest('hex') };
}

function archiveInstalledPackage(
  npmCli: string,
  npmEnv: NodeJS.ProcessEnv,
  bridgePath: string,
  archivePath: string,
  manifest: PackageManifest,
): void {
  const result = spawnSync(
    process.execPath,
    [bridgePath, npmCli, manifest.directory, archivePath],
    {
      cwd: dirname(bridgePath),
      encoding: 'utf8',
      env: npmEnv,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `failed to archive installed production dependency ${manifest.name}@${manifest.version}: ${result.stderr || result.stdout}`,
    );
  }
  if (!existsSync(archivePath)) {
    throw new Error(
      `archive creation omitted installed production dependency ${manifest.name}@${manifest.version}`,
    );
  }
}

async function packInstalledClosure(
  options: InstalledDependencyRegistryOptions,
): Promise<readonly PackedDependency[]> {
  if (!isAbsolute(options.npmCli)) throw new Error('npm CLI path must be absolute');
  if (!isAbsolute(options.packageRoot)) throw new Error('package root must be absolute');
  if (!isAbsolute(options.scratchDir)) throw new Error('registry scratch directory must be absolute');
  if (options.npmEnv['GIT_ALLOW_PROTOCOL'] !== 'file') {
    throw new Error('dependency packing requires GIT_ALLOW_PROTOCOL=file');
  }
  for (const key of [
    'NPM_CONFIG_USERCONFIG',
    'npm_config_userconfig',
    'NPM_CONFIG_GLOBALCONFIG',
    'npm_config_globalconfig',
  ]) {
    const path = options.npmEnv[key];
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error(`dependency packing requires an absolute ${key}`);
    }
  }

  const tarballDirectory = join(options.scratchDir, 'tarballs');
  const bridgePath = join(options.scratchDir, 'archive-installed-package.cjs');
  mkdirSync(tarballDirectory, { recursive: true });
  writeFileSync(bridgePath, archiveBridgeSource);
  const manifests = installedClosure(options.packageRoot, options.dependencySpecs);
  const packed: PackedDependency[] = [];
  let closureSourceBytes = 0;
  let closureArchiveBytes = 0;

  let archiveIndex = 0;
  for (const [key, manifest] of [...manifests].sort(([left], [right]) => left.localeCompare(right))) {
    if (!isAbsolute(manifest.directory)) {
      throw new Error(`installed production dependency path must be absolute: ${key}`);
    }
    const before = snapshotPackageTree(manifest.directory);
    closureSourceBytes += before.bytes;
    if (closureSourceBytes >= MAX_FIXTURE_CLOSURE_BYTES) {
      throw new Error('installed production dependency closure must be smaller than 100 MiB');
    }

    const archivePath = join(tarballDirectory, `${String(archiveIndex)}.tgz`);
    archiveIndex += 1;
    archiveInstalledPackage(
      options.npmCli,
      options.npmEnv,
      bridgePath,
      archivePath,
      manifest,
    );
    const after = snapshotPackageTree(manifest.directory);
    if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) {
      throw new Error(`dependency packaging modified installed source ${key}`);
    }

    closureArchiveBytes += statSync(archivePath).size;
    if (closureArchiveBytes >= MAX_FIXTURE_CLOSURE_BYTES) {
      throw new Error('installed production dependency archives must be smaller than 100 MiB');
    }
    const archive = await readFile(archivePath);
    packed.push({
      archive,
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      manifest,
      shasum: createHash('sha1').update(archive).digest('hex'),
    });
  }
  return packed;
}

function sendJson(response: import('node:http').ServerResponse, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(200, {
    'cache-control': 'public, max-age=300',
    'content-length': String(body.byteLength),
    'content-type': 'application/json',
  });
  response.end(body);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('dependency fixture registry did not bind a TCP port'));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.closeIdleConnections();
    server.close((error) => (error === undefined ? resolveClose() : reject(error)));
  });
}

export async function startInstalledDependencyRegistry(
  options: InstalledDependencyRegistryOptions,
): Promise<InstalledDependencyRegistry> {
  const packed = await packInstalledClosure(options);
  const requests: RegistryRequest[] = [];
  let origin = '';
  const archiveByKey = new Map<string, PackedDependency>(
    packed.map((entry) => [`${entry.manifest.name}@${entry.manifest.version}`, entry]),
  );
  const packagesByName = new Map<string, PackedDependency[]>();
  for (const entry of packed) {
    const entries = packagesByName.get(entry.manifest.name) ?? [];
    entries.push(entry);
    packagesByName.set(entry.manifest.name, entries);
  }

  const server = createServer((request, response) => {
    const method = request.method ?? 'GET';
    const rawPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const decodedPath = decodeURIComponent(rawPath);
    let status = 404;
    const record = (): void => {
      requests.push({ method, path: decodedPath, status });
    };

    if (method !== 'GET' && method !== 'HEAD') {
      status = 405;
      response.writeHead(status).end();
      record();
      return;
    }
    if (decodedPath.startsWith('/tarballs/')) {
      const key = decodedPath.slice('/tarballs/'.length);
      const entry = archiveByKey.get(key);
      if (entry === undefined) {
        response.writeHead(status).end();
        record();
        return;
      }
      status = 200;
      response.writeHead(status, {
        'cache-control': 'public, max-age=300',
        'content-length': String(entry.archive.byteLength),
        'content-type': 'application/octet-stream',
      });
      response.end(method === 'HEAD' ? undefined : entry.archive);
      record();
      return;
    }

    const packageName = decodedPath.slice(1);
    const entries = packagesByName.get(packageName);
    if (entries === undefined) {
      response.writeHead(status).end();
      record();
      return;
    }
    status = 200;
    const versions = Object.fromEntries(
      entries.map((entry) => {
        const key = `${entry.manifest.name}@${entry.manifest.version}`;
        return [
          entry.manifest.version,
          {
            ...entry.manifest.raw,
            dist: {
              integrity: entry.integrity,
              shasum: entry.shasum,
              tarball: `${origin}/tarballs/${encodeURIComponent(key)}`,
            },
          },
        ];
      }),
    );
    const latest = entries
      .map((entry) => entry.manifest.version)
      .sort((left, right) => left.localeCompare(right))
      .at(-1);
    sendJson(response, {
      name: packageName,
      'dist-tags': { latest },
      versions,
    });
    record();
  });

  const port = await listen(server);
  origin = `http://127.0.0.1:${String(port)}`;
  let closed = false;
  return {
    origin,
    packageVersions: [...archiveByKey.keys()].sort(),
    requests,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await closeServer(server);
    },
  };
}
