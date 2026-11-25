import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isJsonObject, parseJsonText } from './common.js';
import { writeJsonAtomic } from './task-durable.js';
/** The task started just before its process did; a pid born at another time is another process. */
const START_TOLERANCE_MS = 60_000;
const POLL_MS = 100;
const DEFAULT_KILL_GRACE_MS = 3_000;
const ELAPSED = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/u;
/** `ps -o etime=` as seconds: `[[dd-]hh:]mm:ss`. */
export function parsePsElapsedSeconds(text) {
    const match = ELAPSED.exec(text.trim());
    if (match === null)
        return undefined;
    const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
    return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}
function psProcessStartMs(pid) {
    return new Promise((resolvePromise) => {
        const askedAt = Date.now();
        execFile('ps', ['-o', 'etime=', '-p', String(pid)], { timeout: 5_000 }, (error, stdout) => {
            const seconds = error ? undefined : parsePsElapsedSeconds(stdout);
            resolvePromise(seconds === undefined ? undefined : askedAt - seconds * 1000);
        });
    });
}
function ownerPidOf(runDirectory) {
    const pid = Number(/-(\d+)$/u.exec(runDirectory)?.[1]);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
async function findPersistedTask(cwd, id) {
    const root = join(cwd, '.pi', 'tasks');
    const runs = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const run of runs) {
        if (!run.isDirectory())
            continue;
        const path = join(root, run.name, `${id}.json`);
        const text = await readFile(path, 'utf8').catch(() => undefined);
        if (text === undefined)
            continue;
        try {
            const record = parseJsonText(text);
            if (isJsonObject(record) && record['id'] === id)
                return { path, record, ownerPid: ownerPidOf(run.name) };
        }
        catch {
            continue;
        }
    }
    return undefined;
}
function runningTask(found) {
    const { pid, startTime, status } = found.record;
    if (status !== 'running')
        return undefined;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1)
        return undefined;
    if (typeof startTime !== 'number' || !Number.isFinite(startTime))
        return undefined;
    return { ...found, pid, startTime };
}
function signalGroup(kill, pid, signal) {
    try {
        kill(-pid, signal);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Stop the task with exactly this id when no registry owns it. Resolves undefined when there is no
 * such record under `cwd`, so the caller keeps its own "unknown task" answer; throws when the record
 * is there but the task cannot be stopped from here, saying why.
 */
export async function stopOrphanedTask(cwd, id, deps = {}) {
    if (!/^[A-Za-z0-9_-]+$/u.test(id))
        return undefined;
    const found = await findPersistedTask(cwd, id);
    if (found === undefined)
        return undefined;
    const task = runningTask(found);
    if (task === undefined) {
        throw new Error(`Task ${id} was started by an earlier process and is recorded as ${String(found.record['status'])}, not running`);
    }
    if ((deps.platform ?? process.platform) === 'win32') {
        throw new Error(`Task ${id} was started by an earlier process (pid ${String(task.pid)}); stopping such a task is not supported on Windows, end it with taskkill /T /PID ${String(task.pid)}`);
    }
    const now = deps.now ?? Date.now;
    const kill = deps.kill ?? process.kill.bind(process);
    const sleep = deps.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
    const processStartMs = deps.processStartMs ?? psProcessStartMs;
    const name = typeof task.record['name'] === 'string' ? task.record['name'] : id;
    const outputPath = typeof task.record['outputPath'] === 'string' ? task.record['outputPath'] : '';
    const ownerBornAt = task.ownerPid === undefined ? undefined : await processStartMs(task.ownerPid);
    if (ownerBornAt !== undefined && ownerBornAt <= task.startTime + START_TOLERANCE_MS) {
        throw new Error(`Task ${id} belongs to a process that is still running (pid ${String(task.ownerPid)}); stop it from the session that started it`);
    }
    const bornAt = await processStartMs(task.pid);
    const sameProcess = bornAt !== undefined && Math.abs(bornAt - task.startTime) <= START_TOLERANCE_MS;
    let signal = 'SIGTERM';
    if (sameProcess) {
        signalGroup(kill, task.pid, 'SIGTERM');
        const deadline = now() + (deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
        while ((await processStartMs(task.pid)) !== undefined && now() < deadline)
            await sleep(POLL_MS);
        if ((await processStartMs(task.pid)) !== undefined) {
            signal = 'SIGKILL';
            signalGroup(kill, task.pid, 'SIGKILL');
            await sleep(POLL_MS);
            if ((await processStartMs(task.pid)) !== undefined) {
                throw new Error(`Task ${id} (pid ${String(task.pid)}) did not exit after SIGKILL`);
            }
        }
    }
    await writeJsonAtomic(task.path, {
        ...task.record,
        status: sameProcess ? 'killed' : 'failed',
        endTime: now(),
        exitCode: null,
        signal: sameProcess ? signal : null,
        error: sameProcess
            ? 'Stopped after the process that started it was gone'
            : 'The process that started it was gone, and so was the task',
    });
    return { id, name, outputPath, signal, wasRunning: sameProcess };
}
//# sourceMappingURL=orphaned-task.js.map