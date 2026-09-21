import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { replaceFileDurable, writeFileDurable } from './durable-fs.js';

function signalError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new Error(
        `Attested Git preflight cancelled${reason === undefined ? '' : `: ${String(reason)}`}`,
      );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signalError(signal);
}

export async function writeFileFsynced(
  path: string,
  data: Buffer | string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await mkdir(dirname(path), { recursive: true });
  throwIfAborted(signal);
  await writeFileDurable(path, data, signal === undefined ? {} : { signal });
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await replaceFileDurable(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
    signal === undefined ? {} : { signal },
  );
}

export async function closeAndFsyncOutputStream(
  stream: NodeJS.WritableStream | undefined,
): Promise<void> {
  if (!stream) return;
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      stream.off('error', fail);
      stream.off('close', finish);
      stream.off('finish', finish);
      resolvePromise();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stream.off('close', finish);
      reject(error);
    };
    stream.once('close', finish);
    stream.once('finish', finish);
    stream.once('error', fail);
    stream.end();
  });
}
