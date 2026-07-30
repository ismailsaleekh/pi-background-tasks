import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import { isJsonObject, parseJsonText, type JsonObject } from '../common.js';
import {
  FUSION_MODEL_CONFIG_SCHEMA_VERSION,
  FusionError,
  type FusionModelConfigRevision,
  type FusionModelConfigV1,
  type FusionModelSelection,
  type FusionThinkingLevel,
  type LoadedFusionModelConfig,
  type ResolvedFusionModel,
  type ResolvedFusionModels,
} from './types.js';

export const FUSION_MODEL_CONFIG_FILE = 'fusion-models.json';
export const CURRENT_MODEL_SELECTION = '$current';

export interface FusionModelRegistry {
  getAll(): Model<Api>[];
  getAvailable(): Model<Api>[];
  find?(provider: string, modelId: string): Model<Api> | undefined;
}

export interface ResolveFusionModelsInput {
  config: FusionModelConfigV1;
  modelRegistry: FusionModelRegistry;
  currentModel: Model<Api> | undefined;
  thinkingLevel: FusionThinkingLevel;
}

export function defaultFusionModelConfig(): FusionModelConfigV1 {
  return {
    schema_version: FUSION_MODEL_CONFIG_SCHEMA_VERSION,
    candidates: [CURRENT_MODEL_SELECTION, CURRENT_MODEL_SELECTION, CURRENT_MODEL_SELECTION],
    evaluator: CURRENT_MODEL_SELECTION,
    merger: CURRENT_MODEL_SELECTION,
  };
}

export function fusionModelConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, FUSION_MODEL_CONFIG_FILE);
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function revisionForPath(path: string): Promise<FusionModelConfigRevision> {
  try {
    const bytes = await readFile(path);
    return { path, exists: true, sha256: sha256Hex(bytes) };
  } catch (error) {
    if (errorHasCode(error, 'ENOENT')) return { path, exists: false, sha256: null };
    throw error;
  }
}

function errorHasCode(error: unknown, code: string): boolean {
  return isJsonObject(error) && error['code'] === code;
}

function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

function assertClosed(record: JsonObject, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(record)) {
    if (!expectedSet.has(key)) throw configError(`${label} contains unknown key ${key}`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw configError(`${label} is missing key ${key}`);
    }
  }
}

function configError(message: string): FusionError {
  return new FusionError(message, { code: 'config_invalid', childCreated: false });
}

function requireSelection(value: unknown, label: string): FusionModelSelection {
  if (typeof value !== 'string') throw configError(`${label} must be a string`);
  if (value === CURRENT_MODEL_SELECTION) return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) throw configError(`${label} must not be blank`);
  if (trimmed !== value) throw configError(`${label} must not have surrounding whitespace`);
  if (!trimmed.includes('/')) throw configError(`${label} must be a qualified provider/model key`);
  return trimmed;
}

function requireCandidateSelections(
  value: unknown,
): [FusionModelSelection, FusionModelSelection, FusionModelSelection] {
  if (!Array.isArray(value)) throw configError('candidates must be an array');
  if (value.length !== 3) throw configError('candidates must contain exactly three entries');
  const first = requireSelection(value[0], 'candidates[0]');
  const second = requireSelection(value[1], 'candidates[1]');
  const third = requireSelection(value[2], 'candidates[2]');
  return [first, second, third];
}

export function parseFusionModelConfig(value: unknown): FusionModelConfigV1 {
  if (!isJsonObject(value) || Array.isArray(value))
    throw configError('fusion model config must be an object');
  const record: JsonObject = value;
  assertClosed(
    record,
    ['schema_version', 'candidates', 'evaluator', 'merger'],
    'fusion model config',
  );
  if (record['schema_version'] !== FUSION_MODEL_CONFIG_SCHEMA_VERSION) {
    throw configError('fusion model config schema_version mismatch');
  }
  return {
    schema_version: FUSION_MODEL_CONFIG_SCHEMA_VERSION,
    candidates: requireCandidateSelections(record['candidates']),
    evaluator: requireSelection(record['evaluator'], 'evaluator'),
    merger: requireSelection(record['merger'], 'merger'),
  };
}

export async function loadFusionModelConfig(
  path = fusionModelConfigPath(),
): Promise<LoadedFusionModelConfig> {
  const revision = await revisionForPath(path);
  if (!revision.exists) return { config: defaultFusionModelConfig(), revision };
  let parsed: unknown;
  try {
    parsed = parseJsonText(await readFile(path, 'utf8'));
  } catch (error) {
    throw configError(
      `fusion model config is not valid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const config = parseFusionModelConfig(parsed);
  return { config, revision };
}

function qualifiedModelKey(model: Pick<Model<Api>, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`;
}

function requireContextWindow(model: Model<Api>, label: string): number {
  const value = model.contextWindow;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new FusionError(`${label} has no positive context window`, {
      code: 'model_unavailable',
      childCreated: false,
    });
  }
  return Math.floor(value);
}

function modelIndex(models: readonly Model<Api>[]): Map<string, Model<Api>> {
  const out = new Map<string, Model<Api>>();
  for (const model of models) out.set(qualifiedModelKey(model), model);
  return out;
}

function resolveSelection(
  selection: FusionModelSelection,
  slotLabel: string,
  availableByKey: Map<string, Model<Api>>,
  currentModel: Model<Api> | undefined,
  thinkingLevel: FusionThinkingLevel,
): ResolvedFusionModel {
  if (selection === CURRENT_MODEL_SELECTION) {
    if (currentModel === undefined) {
      throw new FusionError(`${slotLabel} uses $current but Pi has no current model`, {
        code: 'model_unavailable',
        childCreated: false,
      });
    }
    const qualifiedId = qualifiedModelKey(currentModel);
    const available = availableByKey.get(qualifiedId);
    if (available === undefined) {
      throw new FusionError(
        `${slotLabel} current model is not available to child Pi: ${qualifiedId}`,
        {
          code: 'model_unavailable',
          childCreated: false,
        },
      );
    }
    return {
      selection,
      source: 'current',
      provider: available.provider,
      model: available.id,
      qualifiedId,
      thinkingLevel,
      contextWindow: requireContextWindow(available, slotLabel),
    };
  }
  const model = availableByKey.get(selection);
  if (model === undefined) {
    throw new FusionError(`${slotLabel} configured model is unavailable: ${selection}`, {
      code: 'model_unavailable',
      childCreated: false,
    });
  }
  return {
    selection,
    source: 'configured',
    provider: model.provider,
    model: model.id,
    qualifiedId: selection,
    thinkingLevel,
    contextWindow: requireContextWindow(model, slotLabel),
  };
}

export function resolveFusionModels(input: ResolveFusionModelsInput): ResolvedFusionModels {
  const availableByKey = modelIndex(input.modelRegistry.getAvailable());
  const [first, second, third] = input.config.candidates;
  return {
    candidates: [
      resolveSelection(
        first,
        'candidate 1',
        availableByKey,
        input.currentModel,
        input.thinkingLevel,
      ),
      resolveSelection(
        second,
        'candidate 2',
        availableByKey,
        input.currentModel,
        input.thinkingLevel,
      ),
      resolveSelection(
        third,
        'candidate 3',
        availableByKey,
        input.currentModel,
        input.thinkingLevel,
      ),
    ],
    evaluator: resolveSelection(
      input.config.evaluator,
      'evaluator',
      availableByKey,
      input.currentModel,
      input.thinkingLevel,
    ),
    merger: resolveSelection(
      input.config.merger,
      'merger',
      availableByKey,
      input.currentModel,
      input.thinkingLevel,
    ),
  };
}

async function fsyncFile(path: string): Promise<void> {
  // Windows FlushFileBuffers requires a writable handle; a read-only handle
  // fails consistently with EPERM even for files created by this process.
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withConfigLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const dir = dirname(path);
  const lockPath = join(dir, `.${basename(path)}.lock`);
  const started = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  while (handle === undefined) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (!errorHasCode(error, 'EEXIST')) throw error;
      if (Date.now() - started > 10_000) {
        throw new FusionError(`timed out waiting for fusion model config lock: ${path}`, {
          code: 'config_conflict',
          childCreated: false,
        });
      }
      await delay(25);
    }
  }
  try {
    await handle.writeFile(`${String(process.pid)}\n`);
    await handle.sync();
    return await fn();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function prettyConfig(config: FusionModelConfigV1): string {
  const sorted = {
    schema_version: config.schema_version,
    candidates: [...config.candidates],
    evaluator: config.evaluator,
    merger: config.merger,
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function revisionsMatch(
  expected: FusionModelConfigRevision,
  current: FusionModelConfigRevision,
): boolean {
  if (expected.path !== current.path) return false;
  if (expected.exists !== current.exists) return false;
  return expected.sha256 === current.sha256;
}

export async function saveFusionModelConfig(
  path: string,
  config: FusionModelConfigV1,
  expectedRevision: FusionModelConfigRevision,
): Promise<FusionModelConfigRevision> {
  parseFusionModelConfig(config);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return withConfigLock(path, async () => {
    const current = await revisionForPath(path);
    if (!revisionsMatch(expectedRevision, current)) {
      throw new FusionError(`fusion model config changed on disk: ${path}`, {
        code: 'config_conflict',
        childCreated: false,
      });
    }
    const tmp = join(
      dir,
      `.${basename(path)}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`,
    );
    const text = prettyConfig(config);
    try {
      await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
      await fsyncFile(tmp);
      renameSync(tmp, path);
      await fsyncDirectory(dir);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return revisionForPath(path);
  });
}

export function describeFusionModelConfig(config: FusionModelConfigV1): string {
  return keysOf(config).join(', ');
}
