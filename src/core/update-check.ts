import { readFileSync } from 'node:fs';
import { isJsonObject, parseJsonText, type JsonObject } from './common.js';

/**
 * Typed, offline-safe boundary for the "update available" footer notice.
 *
 * All network access flows through an injectable {@link FetchLike} so unit tests
 * never touch the real npm registry. Every failure path (offline, timeout, bad
 * status, malformed payload) resolves to `undefined` and never throws, so the
 * footer/session can never hang or error because of an update check.
 */

export const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmjs.org';
export const DEFAULT_UPDATE_TIMEOUT_MS = 2000;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<FetchResponseLike>;

export interface FetchLatestVersionOptions {
  packageName: string;
  registryUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  onError?: (error: Error) => void;
}

export interface PackageInfo {
  name?: string;
  version?: string;
}

function asPayload(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function readNonEmptyString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Narrow an npm registry `<pkg>/latest` JSON payload to its `version` string. */
export function parseLatestVersionPayload(payload: unknown): string | undefined {
  const record = asPayload(payload);
  if (!record) return undefined;
  return readNonEmptyString(record, 'version');
}

/** Narrow a parsed `package.json` payload to the fields this extension needs. */
export function parsePackageInfo(payload: unknown): PackageInfo {
  const record = asPayload(payload);
  if (!record) return {};
  const info: PackageInfo = {};
  const name = readNonEmptyString(record, 'name');
  const version = readNonEmptyString(record, 'version');
  if (name !== undefined) info.name = name;
  if (version !== undefined) info.version = version;
  return info;
}

const realFetch: FetchLike = (url, init) => fetch(url, init);

/** Duck-type AbortError because Node versions differ on DOMException inheritance. */
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'name') === 'AbortError';
}

/** Time-boxed, never-throwing lookup of the latest published version of a package. */
export async function fetchLatestVersion(
  options: FetchLatestVersionOptions,
): Promise<string | undefined> {
  const registryUrl = (options.registryUrl ?? DEFAULT_NPM_REGISTRY_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? realFetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    // Ownership matters: a fetch implementation may reject with AbortError for
    // another reason. Only the abort initiated by this timer is an expected skip.
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const url = `${registryUrl}/${encodeURIComponent(options.packageName)}/latest`;
    const response = await doFetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const payload = await response.json();
    return parseLatestVersionPayload(payload);
  } catch (error) {
    const expectedTimeoutAbort = timedOut && controller.signal.aborted && isAbortError(error);
    if (options.onError && !expectedTimeoutAbort) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Read `name`/`version` from a local `package.json`, returning `{}` on every failure. */
export function readPackageInfo(
  packageJsonUrl: URL | string,
  onError?: (error: Error) => void,
): PackageInfo {
  try {
    return parsePackageInfo(parseJsonText(readFileSync(packageJsonUrl, 'utf8')));
  } catch (error) {
    if (onError) onError(error instanceof Error ? error : new Error(String(error)));
    return {};
  }
}
