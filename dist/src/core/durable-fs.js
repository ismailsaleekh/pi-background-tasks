import { randomBytes } from 'node:crypto';
import { open as nodeOpen, rename as nodeRename, rm as nodeRm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
export class DurableFileCancellationError extends Error {
    code = 'durable_file_cancelled';
    path;
    reason;
    cleanupFailures;
    targetPath;
    temporaryPath;
    renameCompleted;
    constructor(input) {
        const reasonText = describeCause(input.reason);
        const cleanupText = input.cleanupFailures.length === 0
            ? ''
            : ` Cleanup failures: ${input.cleanupFailures.map(formatFailureForMessage).join('; ')}`;
        const commitText = input.renameCompleted
            ? ` Replacement may already be visible at ${input.targetPath ?? input.path}.`
            : '';
        super(`Durable file operation cancelled for ${input.path}: ${reasonText}.${commitText}${cleanupText}`);
        this.name = 'DurableFileCancellationError';
        this.path = input.path;
        this.reason = input.reason;
        this.cleanupFailures = [...input.cleanupFailures];
        this.targetPath = input.targetPath;
        this.temporaryPath = input.temporaryPath;
        this.renameCompleted = input.renameCompleted;
    }
}
export class DurableFileError extends Error {
    operation;
    path;
    nativeCode;
    primaryCause;
    cleanupFailures;
    targetPath;
    temporaryPath;
    renameCompleted;
    constructor(input) {
        super(formatDurableMessage(input));
        this.name = 'DurableFileError';
        this.operation = input.operation;
        this.path = input.path;
        this.nativeCode = nativeCodeForCause(input.cause);
        this.primaryCause = input.cause;
        this.cleanupFailures = [...input.cleanupFailures];
        this.targetPath = input.targetPath;
        this.temporaryPath = input.temporaryPath;
        this.renameCompleted = input.renameCompleted;
    }
}
function failure(operation, path, cause) {
    return { operation, path, cause };
}
function durableError(input) {
    return new DurableFileError(input);
}
function nativeCodeForCause(cause) {
    if (typeof cause !== 'object' || cause === null)
        return undefined;
    const code = Reflect.get(cause, 'code');
    return typeof code === 'string' ? code : undefined;
}
function describeCause(cause) {
    if (cause instanceof Error) {
        const message = cause.message.length > 0 ? cause.message : String(cause);
        return `${cause.name}: ${message}`;
    }
    return String(cause);
}
function formatFailureForMessage(entry) {
    const code = nativeCodeForCause(entry.cause);
    const codeText = code === undefined ? '' : ` (code ${code})`;
    return `${entry.operation} ${entry.path}${codeText}: ${describeCause(entry.cause)}`;
}
function formatDurableMessage(input) {
    const primary = formatFailureForMessage({
        operation: input.operation,
        path: input.path,
        cause: input.cause,
    });
    const segments = [`Durable file operation failed: ${primary}`];
    if (input.targetPath !== undefined)
        segments.push(`target: ${input.targetPath}`);
    if (input.temporaryPath !== undefined)
        segments.push(`temporary: ${input.temporaryPath}`);
    if (input.renameCompleted) {
        const target = input.targetPath ?? input.path;
        segments.push(`Replacement may already be visible at ${target}.`);
    }
    if (input.cleanupFailures.length > 0) {
        const cleanupText = input.cleanupFailures.map(formatFailureForMessage).join('; ');
        segments.push(`Cleanup failures: ${cleanupText}`);
    }
    return segments.join(' ');
}
async function writeSyncClose(handle, path, data, signal) {
    const cleanupFailures = [];
    let primaryFailure;
    let cancelled = signal?.aborted === true;
    if (!cancelled) {
        try {
            await handle.writeFile(data);
        }
        catch (error) {
            primaryFailure = failure('write_file', path, error);
        }
        cancelled = signal?.aborted === true;
    }
    if (primaryFailure === undefined && !cancelled) {
        try {
            await handle.sync();
        }
        catch (error) {
            primaryFailure = failure('sync_file', path, error);
        }
        cancelled = signal?.aborted === true;
    }
    try {
        await handle.close();
    }
    catch (error) {
        const closeFailure = failure('close_file', path, error);
        if (primaryFailure === undefined)
            primaryFailure = closeFailure;
        else
            cleanupFailures.push(closeFailure);
    }
    cancelled ||= signal?.aborted === true;
    return { primaryFailure, cleanupFailures, cancelled };
}
async function syncCloseDirectory(handle, path) {
    const cleanupFailures = [];
    let primaryFailure;
    try {
        await handle.sync();
    }
    catch (error) {
        primaryFailure = failure('sync_directory', path, error);
    }
    try {
        await handle.close();
    }
    catch (error) {
        const closeFailure = failure('close_directory', path, error);
        if (primaryFailure === undefined)
            primaryFailure = closeFailure;
        else
            cleanupFailures.push(closeFailure);
    }
    return { primaryFailure, cleanupFailures, cancelled: false };
}
function cancellationReason(signal) {
    return signal.reason ?? new Error('operation aborted');
}
function throwCancellation(signal, path, cleanupFailures, targetPath, temporaryPath, renameCompleted) {
    const reason = cancellationReason(signal);
    if (cleanupFailures.length === 0 && !renameCompleted && reason instanceof Error)
        throw reason;
    throw new DurableFileCancellationError({
        path,
        reason,
        cleanupFailures,
        targetPath,
        temporaryPath,
        renameCompleted,
    });
}
function throwDurable(primaryFailure, cleanupFailures, targetPath, temporaryPath, renameCompleted) {
    throw durableError({
        operation: primaryFailure.operation,
        path: primaryFailure.path,
        cause: primaryFailure.cause,
        cleanupFailures,
        targetPath,
        temporaryPath,
        renameCompleted,
    });
}
async function removeTemporary(operations, temporaryPath, cleanupFailures) {
    try {
        await operations.remove(temporaryPath);
    }
    catch (error) {
        cleanupFailures.push(failure('remove_temp', temporaryPath, error));
    }
}
function isAborted(signal) {
    return signal?.aborted === true;
}
async function writeWithOperations(operations, path, data, options) {
    const signal = options.signal;
    if (signal !== undefined && isAborted(signal))
        throwCancellation(signal, path, [], path, undefined, false);
    let handle;
    try {
        handle = await operations.openWritable(path, 'w');
    }
    catch (error) {
        if (signal !== undefined && isAborted(signal))
            throwCancellation(signal, path, [], path, undefined, false);
        throwDurable(failure('open_file', path, error), [], path, undefined, false);
    }
    const result = await writeSyncClose(handle, path, data, signal);
    if (result.primaryFailure !== undefined) {
        throwDurable(result.primaryFailure, result.cleanupFailures, path, undefined, false);
    }
    if (result.cancelled && signal !== undefined) {
        throwCancellation(signal, path, result.cleanupFailures, path, undefined, false);
    }
}
async function syncDirectoryAfterRename(operations, targetPath, temporaryPath) {
    if (operations.platform === 'win32')
        return;
    const directoryPath = dirname(targetPath);
    let handle;
    try {
        handle = await operations.openDirectory(directoryPath);
    }
    catch (error) {
        throwDurable(failure('open_directory', directoryPath, error), [], targetPath, temporaryPath, true);
    }
    const result = await syncCloseDirectory(handle, directoryPath);
    if (result.primaryFailure !== undefined) {
        throwDurable(result.primaryFailure, result.cleanupFailures, targetPath, temporaryPath, true);
    }
}
async function replaceWithOperations(operations, path, data, options) {
    const signal = options.signal;
    if (signal !== undefined && isAborted(signal))
        throwCancellation(signal, path, [], path, undefined, false);
    const temporaryPath = operations.temporaryPath(path);
    let handle;
    try {
        handle = await operations.openWritable(temporaryPath, 'wx', 0o600);
    }
    catch (error) {
        if (signal !== undefined && isAborted(signal))
            throwCancellation(signal, temporaryPath, [], path, temporaryPath, false);
        throwDurable(failure('open_file', temporaryPath, error), [], path, temporaryPath, false);
    }
    const writeResult = await writeSyncClose(handle, temporaryPath, data, signal);
    if (writeResult.primaryFailure !== undefined) {
        await removeTemporary(operations, temporaryPath, writeResult.cleanupFailures);
        throwDurable(writeResult.primaryFailure, writeResult.cleanupFailures, path, temporaryPath, false);
    }
    if (writeResult.cancelled && signal !== undefined) {
        await removeTemporary(operations, temporaryPath, writeResult.cleanupFailures);
        throwCancellation(signal, temporaryPath, writeResult.cleanupFailures, path, temporaryPath, false);
    }
    const renameResult = await renameWithWindowsContention(operations, temporaryPath, path, signal);
    if (renameResult.cancelled && signal !== undefined) {
        const cleanupFailures = [];
        await removeTemporary(operations, temporaryPath, cleanupFailures);
        throwCancellation(signal, temporaryPath, cleanupFailures, path, temporaryPath, false);
    }
    if (renameResult.error !== undefined) {
        const cleanupFailures = [];
        await removeTemporary(operations, temporaryPath, cleanupFailures);
        throwDurable(failure('rename_file', path, renameResult.error), cleanupFailures, path, temporaryPath, false);
    }
    await syncDirectoryAfterRename(operations, path, temporaryPath);
    if (signal !== undefined && isAborted(signal)) {
        throwCancellation(signal, path, [], path, temporaryPath, true);
    }
}
/**
 * Windows sharing-violation codes for a replace-rename.
 *
 * POSIX `rename(2)` atomically replaces the target. Windows `MoveFileEx` fails
 * with a sharing violation when another process momentarily holds the target
 * open, including transient scanners, indexers, and concurrent writers. The
 * operation is legitimate and simply needs to be reattempted.
 */
const WINDOWS_RENAME_CONTENTION_CODES = new Set([
    'EPERM',
    'EACCES',
    'EBUSY',
]);
const WINDOWS_RENAME_ATTEMPTS = 10;
const WINDOWS_RENAME_RETRY_DELAY_MS = 20;
function delay(ms, signal) {
    if (isAborted(signal))
        return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', aborted);
            resolve();
        }, ms);
        const aborted = () => {
            clearTimeout(timer);
            resolve();
        };
        signal?.addEventListener('abort', aborted, { once: true });
    });
}
/**
 * Rename the temporary file over the target, retrying only Windows sharing
 * violations.
 *
 * This is a bounded retry of a transient OS condition, not a fallback: the
 * final failure is still returned and raised loudly, no alternative write path
 * is taken, and no other platform or error code is retried.
 *
 * Returns an explicit success/error/cancellation sequence result.
 */
async function renameWithWindowsContention(operations, temporaryPath, targetPath, signal) {
    const attempts = operations.platform === 'win32' ? WINDOWS_RENAME_ATTEMPTS : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        if (isAborted(signal))
            return { error: undefined, cancelled: true };
        try {
            await operations.rename(temporaryPath, targetPath);
            return { error: undefined, cancelled: false };
        }
        catch (error) {
            lastError = error;
            if (isAborted(signal))
                return { error: undefined, cancelled: true };
            const code = nativeCodeForCause(error);
            const retryable = operations.platform === 'win32' &&
                code !== undefined &&
                WINDOWS_RENAME_CONTENTION_CODES.has(code);
            if (!retryable || attempt === attempts)
                return { error, cancelled: false };
            await delay(WINDOWS_RENAME_RETRY_DELAY_MS * attempt, signal);
        }
    }
    return { error: lastError, cancelled: false };
}
function temporaryPathForTarget(target) {
    return join(dirname(target), `.${basename(target)}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`);
}
const nodeOperations = {
    platform: process.platform,
    async openWritable(path, flag, mode) {
        if (mode === undefined)
            return nodeOpen(path, flag);
        return nodeOpen(path, flag, mode);
    },
    async openDirectory(path) {
        return nodeOpen(path, 'r');
    },
    async rename(source, target) {
        await nodeRename(source, target);
    },
    async remove(path) {
        // `force` ignores a missing path only. Permission and other failures still
        // throw and are surfaced as `remove_temp` cleanup failures.
        await nodeRm(path, { force: true });
    },
    temporaryPath: temporaryPathForTarget,
};
const defaultWriter = createDurableFileWriter(nodeOperations);
export function createDurableFileWriter(operations) {
    return {
        async write(path, data, options = {}) {
            await writeWithOperations(operations, path, data, options);
        },
        async replace(path, data, options = {}) {
            await replaceWithOperations(operations, path, data, options);
        },
    };
}
export async function writeFileDurable(path, data, options = {}) {
    await defaultWriter.write(path, data, options);
}
export async function replaceFileDurable(path, data, options = {}) {
    await defaultWriter.replace(path, data, options);
}
//# sourceMappingURL=durable-fs.js.map