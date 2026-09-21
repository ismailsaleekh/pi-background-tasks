import { stat, readFile, realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const PI_AI_PACKAGE_NAME = '@earendil-works/pi-ai';
const EXPECTED_MAJOR = 0;
const EXPECTED_MINOR = 86;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

interface PackageManifest {
  readonly path: string;
  readonly root: string;
  readonly name: string;
  readonly version: string;
  readonly json: Readonly<Record<string, unknown>>;
}

export interface ResolvedQualificationPackage {
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly entryPath: string;
  readonly entryUrl: string;
}

export interface ResolvedQualificationHost {
  readonly host: ResolvedQualificationPackage;
  readonly piAi: ResolvedQualificationPackage;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function containingManifestPath(explicitPath: string): Promise<string> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(explicitPath);
  } catch {
    throw new Error(`supplied host package path does not exist or is unreadable: ${explicitPath}`);
  }

  const pathStat = await stat(resolvedPath);
  let current = pathStat.isDirectory() ? resolvedPath : dirname(resolvedPath);
  for (;;) {
    const candidate = resolve(current, 'package.json');
    try {
      if ((await stat(candidate)).isFile()) return realpath(candidate);
    } catch {
      // Continue only through ancestors of the explicitly supplied path.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`supplied host package path is not inside a package: ${explicitPath}`);
}

async function readManifest(manifestPath: string, label: string): Promise<PackageManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} package manifest is malformed at ${manifestPath}: ${detail}`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} package manifest must contain a JSON object: ${manifestPath}`);
  }
  const name = parsed['name'];
  const version = parsed['version'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${label} package manifest has no valid name: ${manifestPath}`);
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${label} package manifest has no valid version: ${manifestPath}`);
  }
  return {
    path: manifestPath,
    root: dirname(manifestPath),
    name,
    version,
    json: parsed,
  };
}

function importExportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isJsonObject(value)) return undefined;
  if (Object.hasOwn(value, '.')) return importExportTarget(value['.']);
  if (Object.hasOwn(value, 'node')) {
    const nodeTarget = importExportTarget(value['node']);
    if (nodeTarget !== undefined) return nodeTarget;
  }
  if (Object.hasOwn(value, 'import')) return importExportTarget(value['import']);
  if (Object.hasOwn(value, 'default')) return importExportTarget(value['default']);
  return undefined;
}

async function resolvePublicEntry(manifest: PackageManifest, label: string): Promise<string> {
  const exportsValue = manifest.json['exports'];
  const mainValue = manifest.json['main'];
  const target = exportsValue === undefined
    ? (typeof mainValue === 'string' ? mainValue : undefined)
    : importExportTarget(exportsValue);
  if (target === undefined) {
    throw new Error(`${label} package has no resolvable public ESM entry: ${manifest.path}`);
  }
  if (!target.startsWith('./')) {
    throw new Error(`${label} package public entry must be package-relative: ${target}`);
  }

  const entryPath = resolve(manifest.root, target);
  const relativeEntry = relative(manifest.root, entryPath);
  if (relativeEntry === '..' || relativeEntry.startsWith(`..${sep}`) || isAbsolute(relativeEntry)) {
    throw new Error(`${label} package public entry escapes its package root: ${target}`);
  }
  try {
    if (!(await stat(entryPath)).isFile()) {
      throw new Error('entry is not a file');
    }
    return await realpath(entryPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} package public entry is missing or unreadable at ${entryPath}: ${detail}`);
  }
}

function verifyIdentityAndVersion(
  manifest: PackageManifest,
  expectedName: string,
  label: string,
): void {
  if (manifest.name !== expectedName) {
    throw new Error(
      `${label} package identity mismatch: expected ${expectedName}, observed ${manifest.name} at ${manifest.path}`,
    );
  }
  const match = SEMVER_PATTERN.exec(manifest.version);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`${label} package version is not valid semantic version text: ${manifest.version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== EXPECTED_MAJOR || minor !== EXPECTED_MINOR) {
    throw new Error(
      `${label} package version line mismatch: expected ${EXPECTED_MAJOR}.${EXPECTED_MINOR}.x, observed ${manifest.version}`,
    );
  }
}

async function resolvedPackage(
  manifest: PackageManifest,
  expectedName: string,
  label: string,
): Promise<ResolvedQualificationPackage> {
  verifyIdentityAndVersion(manifest, expectedName, label);
  const entryPath = await resolvePublicEntry(manifest, label);
  return {
    name: manifest.name,
    version: manifest.version,
    manifestPath: manifest.path,
    entryPath,
    entryUrl: pathToFileURL(entryPath).href,
  };
}

export function parseQualificationHostArgument(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--host-package') {
    throw new Error(
      'usage: anthropic-forwarding-pi086.ts --host-package <explicit @earendil-works/pi-coding-agent directory-or-path>',
    );
  }
  const suppliedPath = args[1]?.trim();
  if (!suppliedPath) {
    throw new Error('--host-package requires a non-empty explicit path');
  }
  return suppliedPath;
}

export async function resolveQualificationHost(
  suppliedPath: string,
  cwd = process.cwd(),
): Promise<ResolvedQualificationHost> {
  const explicitPath = resolve(cwd, suppliedPath);
  const hostManifest = await readManifest(
    await containingManifestPath(explicitPath),
    'host Pi',
  );
  verifyIdentityAndVersion(hostManifest, HOST_PACKAGE_NAME, 'host Pi');

  const dependencies = hostManifest.json['dependencies'];
  const declaredPiAi = isJsonObject(dependencies) ? dependencies[PI_AI_PACKAGE_NAME] : undefined;
  if (typeof declaredPiAi !== 'string' || declaredPiAi.trim().length === 0) {
    throw new Error(`host Pi package does not declare ${PI_AI_PACKAGE_NAME} as a dependency`);
  }

  const host = await resolvedPackage(hostManifest, HOST_PACKAGE_NAME, 'host Pi');
  let piAiManifestPath: string | undefined;
  try {
    piAiManifestPath = findPackageJSON(PI_AI_PACKAGE_NAME, pathToFileURL(host.entryPath));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`host Pi cannot resolve its ${PI_AI_PACKAGE_NAME} dependency: ${detail}`);
  }
  if (piAiManifestPath === undefined) {
    throw new Error(`host Pi cannot resolve its ${PI_AI_PACKAGE_NAME} dependency`);
  }
  const piAiManifest = await readManifest(await realpath(piAiManifestPath), 'host pi-ai');
  const piAi = await resolvedPackage(piAiManifest, PI_AI_PACKAGE_NAME, 'host pi-ai');
  return { host, piAi };
}
