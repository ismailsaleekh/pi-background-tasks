import { spawn as nodeSpawn } from 'node:child_process';
import { win32 } from 'node:path';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_CAPTURE_BYTES = 8 * 1024;
class BoundedCapture {
    maxBytes;
    chunks = [];
    capturedBytes = 0;
    truncated = false;
    constructor(maxBytes) {
        this.maxBytes = maxBytes;
    }
    append(data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        if (buffer.length === 0)
            return;
        const remaining = this.maxBytes - this.capturedBytes;
        if (remaining > 0) {
            const kept = buffer.length <= remaining ? buffer : buffer.subarray(0, remaining);
            this.chunks.push(kept);
            this.capturedBytes += kept.length;
        }
        if (buffer.length > Math.max(0, remaining))
            this.truncated = true;
    }
    text() {
        return Buffer.concat(this.chunks, this.capturedBytes).toString('utf8');
    }
    isTruncated() {
        return this.truncated;
    }
}
function lookupEnv(env, name) {
    const direct = env[name];
    if (direct !== undefined)
        return direct;
    const lowerName = name.toLowerCase();
    for (const key of Object.keys(env)) {
        if (key.toLowerCase() === lowerName)
            return env[key];
    }
    return undefined;
}
function validateWindowsRoot(raw, label) {
    const value = raw.trim();
    if (value.length === 0)
        throw new Error(`${label} is empty; cannot resolve taskkill.exe`);
    if (value.includes('\0'))
        throw new Error(`${label} contains a NUL byte; cannot resolve taskkill.exe`);
    if (!win32.isAbsolute(value)) {
        throw new Error(`${label} must be an absolute Windows path; cannot resolve taskkill.exe`);
    }
    return value;
}
export function resolveTaskkillPath(env = process.env) {
    const systemRoot = lookupEnv(env, 'SystemRoot');
    if (systemRoot !== undefined) {
        return win32.join(validateWindowsRoot(systemRoot, 'SystemRoot'), 'System32', 'taskkill.exe');
    }
    const windir = lookupEnv(env, 'WINDIR');
    if (windir !== undefined) {
        return win32.join(validateWindowsRoot(windir, 'WINDIR'), 'System32', 'taskkill.exe');
    }
    throw new Error('Cannot resolve taskkill.exe: SystemRoot is missing and WINDIR fallback is missing');
}
function validatePid(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error(`Invalid Windows taskkill pid ${String(pid)}; expected a positive safe integer`);
    }
}
function validatePhase(phase) {
    if (phase !== 'terminate' && phase !== 'force') {
        throw new Error(`Invalid Windows taskkill phase ${String(phase)}`);
    }
}
function positiveFiniteInteger(value, fallback, label) {
    const candidate = value ?? fallback;
    if (!Number.isFinite(candidate) || candidate <= 0) {
        throw new Error(`${label} must be a positive finite number`);
    }
    return Math.max(1, Math.floor(candidate));
}
function outcome(exitCode, signal, stdout, stderr) {
    return {
        exitCode,
        signal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.isTruncated(),
        stderrTruncated: stderr.isTruncated(),
    };
}
function defaultSpawn(command, args, options) {
    return nodeSpawn(command, args, options);
}
export function runWindowsTaskkill(pid, phase, options = {}) {
    validatePid(pid);
    validatePhase(phase);
    const env = options.env ?? process.env;
    const taskkill = resolveTaskkillPath(env);
    const timeoutMs = positiveFiniteInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
    const maxCaptureBytes = positiveFiniteInteger(options.maxCaptureBytes, DEFAULT_MAX_CAPTURE_BYTES, 'maxCaptureBytes');
    const spawn = options.spawn ?? defaultSpawn;
    const abortSignal = options.signal;
    const args = ['/PID', String(pid), '/T'];
    if (phase === 'force')
        args.push('/F');
    if (abortSignal?.aborted) {
        const stdout = new BoundedCapture(maxCaptureBytes);
        const stderr = new BoundedCapture(maxCaptureBytes);
        stderr.append('Windows taskkill was aborted before launch');
        return Promise.resolve(outcome(null, null, stdout, stderr));
    }
    return new Promise((resolve) => {
        const stdout = new BoundedCapture(maxCaptureBytes);
        const stderr = new BoundedCapture(maxCaptureBytes);
        let settled = false;
        let timeout;
        let child;
        let abortListener;
        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            if (timeout !== undefined)
                clearTimeout(timeout);
            if (abortSignal !== undefined && abortListener !== undefined) {
                abortSignal.removeEventListener('abort', abortListener);
            }
            resolve(result);
        };
        const stopHelper = (reason) => {
            stderr.append(reason);
            if (child !== undefined) {
                try {
                    child.kill('SIGKILL');
                }
                catch (error) {
                    stderr.append(`; helper kill failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            settle(outcome(null, null, stdout, stderr));
        };
        const spawnOptions = {
            env,
            shell: false,
            windowsVerbatimArguments: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        };
        try {
            child = spawn(taskkill, args, spawnOptions);
        }
        catch (error) {
            stderr.append(`Windows taskkill spawn failed: ${error instanceof Error ? error.message : String(error)}`);
            settle(outcome(null, null, stdout, stderr));
            return;
        }
        child.stdout?.on('data', (data) => {
            stdout.append(data);
        });
        child.stderr?.on('data', (data) => {
            stderr.append(data);
        });
        child.on('error', (error) => {
            stderr.append(`Windows taskkill spawn error: ${error.message}`);
            settle(outcome(null, null, stdout, stderr));
        });
        child.on('close', (code, signal) => {
            settle(outcome(code, signal, stdout, stderr));
        });
        abortListener = () => {
            stopHelper('Windows taskkill was aborted');
        };
        abortSignal?.addEventListener('abort', abortListener, { once: true });
        // This timeout is the settlement guarantee for a taskkill helper that never
        // exits. It must keep the event loop alive: an unref'd timer lets the loop
        // drain first and leaves this promise pending forever. `settle()` always
        // clears it, so keeping it referenced cannot leak.
        timeout = setTimeout(() => {
            stopHelper(`Windows taskkill timed out after ${String(timeoutMs)}ms`);
        }, timeoutMs);
    });
}
//# sourceMappingURL=windows-taskkill.js.map