import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 as win32Path, } from 'node:path';
import { fileURLToPath } from 'node:url';
export class PiLaunchResolutionError extends Error {
    code = 'pi_executable_resolution_failed';
    constructor(message) {
        super(`pi_executable_resolution_failed: ${message}`);
        this.name = 'PiLaunchResolutionError';
    }
}
export class PiCommandLineLimitError extends Error {
    code = 'pi_command_line_too_long';
    stage;
    measuredLength;
    limit;
    constructor(stage, measuredLength, limit) {
        super(`pi_command_line_too_long: ${stage} measured UTF-16 command line length ${String(measuredLength)} exceeds limit ${String(limit)}`);
        this.name = 'PiCommandLineLimitError';
        this.stage = stage;
        this.measuredLength = measuredLength;
        this.limit = limit;
    }
}
const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const PI_PACKAGE_MANIFEST = `${PI_PACKAGE_NAME}/package.json`;
const WINDOWS_COMMAND_LINE_LIMIT = 32767;
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const WINDOWS_NATIVE_EXTENSIONS = new Set(['.exe', '.com']);
class HostIsNotPiError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HostIsNotPiError';
    }
}
class LaunchPathOperationError extends Error {
    operation;
    path;
    pathCause;
    constructor(operation, path, cause) {
        super(`${operation} failed for ${path}: ${errorMessage(cause)}`, { cause });
        this.name = 'LaunchPathOperationError';
        this.operation = operation;
        this.path = path;
        this.pathCause = cause;
    }
}
const nodeLaunchIo = {
    readFile: (path) => readFileSync(path),
    realpath: (path) => realpathSync(path),
    stat: (path) => statSync(path),
    access: (path, mode) => accessSync(path, mode),
};
function launchIo(deps) {
    return {
        readFile: deps.readFile ?? nodeLaunchIo.readFile,
        realpath: deps.realpath ?? nodeLaunchIo.realpath,
        stat: deps.stat ?? nodeLaunchIo.stat,
        access: deps.access ?? nodeLaunchIo.access,
    };
}
function failResolution(message) {
    throw new PiLaunchResolutionError(message);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function pathOperation(label, path, action) {
    try {
        return action();
    }
    catch (error) {
        throw new LaunchPathOperationError(label, path, error);
    }
}
function isMissingPathError(error) {
    if (typeof error !== 'object' || error === null)
        return false;
    const code = Reflect.get(error, 'code');
    return code === 'ENOENT' || code === 'ENOTDIR';
}
function isJsonRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseManifest(raw, manifestPath) {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
    }
    catch (error) {
        throw new Error(`manifest JSON is invalid at ${manifestPath}: ${errorMessage(error)}`);
    }
    if (!isJsonRecord(parsed))
        throw new Error(`manifest is not an object at ${manifestPath}`);
    return parsed;
}
function packageName(manifest, manifestPath) {
    const name = manifest['name'];
    if (name === undefined)
        return undefined;
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error(`manifest name is malformed at ${manifestPath}`);
    }
    return name;
}
function requirePiPackageName(manifest, manifestPath) {
    const name = packageName(manifest, manifestPath);
    if (name !== PI_PACKAGE_NAME) {
        throw new Error(`manifest package name must be ${PI_PACKAGE_NAME} at ${manifestPath}; received ${name === undefined ? '<missing>' : name}`);
    }
}
function readPiBin(manifest, manifestPath) {
    const bin = manifest['bin'];
    if (typeof bin === 'string' && bin.trim().length > 0)
        return bin;
    if (isJsonRecord(bin)) {
        const pi = bin['pi'];
        if (typeof pi === 'string' && pi.trim().length > 0)
            return pi;
    }
    throw new Error(`manifest bin.pi is missing or malformed at ${manifestPath}`);
}
function pathInside(parent, child) {
    const rel = relative(parent, child);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
function findNearestNamedManifest(sourcePath, io) {
    const sourceReal = pathOperation('source realpath', sourcePath, () => io.realpath(sourcePath));
    let dir = dirname(sourceReal);
    for (;;) {
        const candidate = join(dir, 'package.json');
        let candidateStat;
        try {
            candidateStat = io.stat(candidate);
        }
        catch (error) {
            if (!isMissingPathError(error)) {
                throw new Error(`manifest stat failed for ${candidate}: ${errorMessage(error)}`);
            }
            const parent = dirname(dir);
            if (parent === dir) {
                throw new HostIsNotPiError(`no named package manifest above ${sourceReal}`);
            }
            dir = parent;
            continue;
        }
        if (!candidateStat.isFile()) {
            throw new Error(`package boundary manifest is not a regular file at ${candidate}`);
        }
        const manifest = parseManifest(pathOperation('manifest read', candidate, () => io.readFile(candidate)), candidate);
        const name = packageName(manifest, candidate);
        if (name !== undefined)
            return { manifestPath: candidate, sourceReal, name };
        const parent = dirname(dir);
        if (parent === dir) {
            throw new HostIsNotPiError(`no named package manifest above ${sourceReal}`);
        }
        dir = parent;
    }
}
function findPiManifestFromHostScript(hostScript, io) {
    if (!hostScript)
        throw new HostIsNotPiError('host script path is unavailable');
    let found;
    try {
        found = findNearestNamedManifest(hostScript, io);
    }
    catch (error) {
        if (error instanceof HostIsNotPiError)
            throw error;
        if (error instanceof LaunchPathOperationError &&
            error.operation === 'source realpath' &&
            isMissingPathError(error.pathCause)) {
            throw new HostIsNotPiError(error.message);
        }
        throw error;
    }
    if (found.name !== PI_PACKAGE_NAME) {
        throw new HostIsNotPiError(`nearest named manifest above host script belongs to ${found.name}: ${found.manifestPath}`);
    }
    return found;
}
/**
 * Resolve only a genuine running Pi package. This helper performs package-boundary
 * discovery; resolvePiLaunch() additionally validates bin.pi and host/bin identity.
 */
export function resolvePiManifestFromHostScript(hostScript, deps = {}) {
    return findPiManifestFromHostScript(hostScript, launchIo(deps)).manifestPath;
}
function normalizeResolvedModulePath(pathOrUrl) {
    return pathOrUrl.startsWith('file:') ? fileURLToPath(pathOrUrl) : pathOrUrl;
}
function defaultResolveModule(specifier) {
    if (specifier === PI_PACKAGE_MANIFEST) {
        return createRequire(import.meta.url).resolve(specifier);
    }
    return normalizeResolvedModulePath(import.meta.resolve(specifier));
}
function resolvePiManifestFromModules(deps, io) {
    if (deps.resolvePackageJson) {
        return normalizeResolvedModulePath(deps.resolvePackageJson(PI_PACKAGE_MANIFEST));
    }
    const resolveModule = deps.resolveModule ?? defaultResolveModule;
    let manifestError;
    try {
        return normalizeResolvedModulePath(resolveModule(PI_PACKAGE_MANIFEST));
    }
    catch (error) {
        manifestError = error;
    }
    let packageEntry;
    try {
        packageEntry = normalizeResolvedModulePath(resolveModule(PI_PACKAGE_NAME));
    }
    catch (entryError) {
        throw new Error(`package manifest resolve failed for ${PI_PACKAGE_MANIFEST}: ${errorMessage(manifestError)}; package entry resolve failed: ${errorMessage(entryError)}`);
    }
    let found;
    try {
        found = findNearestNamedManifest(packageEntry, io);
    }
    catch (searchError) {
        throw new Error(`package manifest resolve failed for ${PI_PACKAGE_MANIFEST}: ${errorMessage(manifestError)}; package entry manifest search failed: ${errorMessage(searchError)}`);
    }
    if (found.name !== PI_PACKAGE_NAME) {
        throw new Error(`package entry nearest named manifest belongs to ${found.name}: ${found.manifestPath}`);
    }
    return found.manifestPath;
}
function executableBasename(execPath, platform) {
    return platform === 'win32' ? win32Path.basename(execPath) : basename(execPath);
}
function isGenericJavaScriptRuntime(execPath, platform) {
    return /^(?:node|nodejs|bun)(?:\.exe)?$/i.test(executableBasename(execPath, platform));
}
function resolveCompiledHostLaunch(deps, io, platform) {
    const execPath = deps.execPath ?? process.execPath;
    const executableName = executableBasename(execPath, platform);
    const isNamedPiExecutable = platform === 'win32' ? /^pi\.(?:exe|com)$/i.test(executableName) : executableName === 'pi';
    // A Bun virtual script path describes packaging mechanics shared by every
    // compiled SDK application; it is not Pi CLI authority. Retain the direct
    // route only for the established Pi executable name.
    if (isGenericJavaScriptRuntime(execPath, platform) || !isNamedPiExecutable)
        return undefined;
    const executableReal = pathOperation('compiled host realpath', execPath, () => io.realpath(execPath));
    const executableStat = pathOperation('compiled host stat', executableReal, () => io.stat(executableReal));
    if (!executableStat.isFile())
        throw new Error('compiled Pi host is not a regular file');
    if (platform === 'win32') {
        if (!WINDOWS_NATIVE_EXTENSIONS.has(extname(executableReal).toLowerCase())) {
            throw new Error('compiled Windows Pi host must be an .exe or .com file');
        }
    }
    else {
        pathOperation('compiled host execute access', executableReal, () => io.access(executableReal, constants.X_OK));
    }
    return { executable: executableReal, argvPrefix: [], kind: 'compiled-host' };
}
function resolvePackageLaunch(manifestPath, deps, io, platform, expectedHostReal) {
    const manifestReal = pathOperation('manifest realpath', manifestPath, () => io.realpath(manifestPath));
    if (basename(manifestReal).toLowerCase() !== 'package.json') {
        throw new Error(`resolved Pi manifest is not package.json: ${manifestReal}`);
    }
    const manifestStat = pathOperation('manifest stat', manifestReal, () => io.stat(manifestReal));
    if (!manifestStat.isFile())
        throw new Error(`Pi package manifest is not a regular file: ${manifestReal}`);
    const manifest = parseManifest(pathOperation('manifest read', manifestReal, () => io.readFile(manifestReal)), manifestReal);
    requirePiPackageName(manifest, manifestReal);
    const packageRootReal = pathOperation('package root realpath', dirname(manifestReal), () => io.realpath(dirname(manifestReal)));
    if (!pathInside(packageRootReal, manifestReal)) {
        throw new Error('Pi package manifest resolves outside the package root');
    }
    const bin = readPiBin(manifest, manifestReal);
    if (isAbsolute(bin) ||
        (platform === 'win32' && (win32Path.isAbsolute(bin) || /^[a-z]:/i.test(bin))))
        throw new Error('Pi package bin target must not be absolute; it must be relative to the package root');
    const targetCandidate = resolve(packageRootReal, bin);
    if (!pathInside(packageRootReal, targetCandidate)) {
        throw new Error('Pi package bin target path escapes the package root');
    }
    const targetReal = pathOperation('bin target realpath', targetCandidate, () => io.realpath(targetCandidate));
    if (!pathInside(packageRootReal, targetReal)) {
        throw new Error('Pi package bin target resolves outside the package root');
    }
    const targetStat = pathOperation('bin target stat', targetReal, () => io.stat(targetReal));
    if (!targetStat.isFile())
        throw new Error('Pi package bin target is not a regular file');
    if (expectedHostReal !== undefined && targetReal !== expectedHostReal) {
        throw new Error(`running host script does not match manifest bin.pi: host ${expectedHostReal}; bin ${targetReal}`);
    }
    const extension = extname(targetReal).toLowerCase();
    if (JAVASCRIPT_EXTENSIONS.has(extension)) {
        const execPath = deps.execPath ?? process.execPath;
        if (!isGenericJavaScriptRuntime(execPath, platform)) {
            throw new Error(`Pi package JavaScript bin cannot launch through a non-generic JavaScript runtime: ${execPath}`);
        }
        return { executable: execPath, argvPrefix: [targetReal], kind: 'package-node-cli' };
    }
    if (platform === 'win32' && WINDOWS_NATIVE_EXTENSIONS.has(extension)) {
        // Keep the historical package launch kind for compatibility; argvPrefix
        // distinguishes this direct native form from the JavaScript package form.
        return { executable: targetReal, argvPrefix: [], kind: 'package-node-cli' };
    }
    throw new Error(`Pi package bin target extension is unsupported: ${extension || '<none>'}`);
}
function resolveExecutableOnPosixPath(deps, io) {
    const rawPath = deps.path ?? process.env['PATH'] ?? '';
    const diagnostics = [];
    if (rawPath.length === 0)
        diagnostics.push('PATH is empty');
    for (const entry of rawPath.split(delimiter)) {
        const directory = entry.length === 0 ? process.cwd() : entry;
        const candidate = resolve(directory, 'pi');
        let candidateReal;
        try {
            candidateReal = io.realpath(candidate);
        }
        catch (error) {
            diagnostics.push(`${candidate}: ${errorMessage(error)}`);
            continue;
        }
        try {
            if (!io.stat(candidateReal).isFile()) {
                diagnostics.push(`${candidateReal} is not a regular file`);
                continue;
            }
            io.access(candidateReal, constants.X_OK);
        }
        catch (error) {
            diagnostics.push(`${candidateReal} is not executable: ${errorMessage(error)}`);
            continue;
        }
        return {
            // Bind the launch plan to the exact canonical executable admitted above.
            // A later cwd or environment/PATH change must not trigger a second lookup.
            launch: { executable: candidateReal, argvPrefix: [], kind: 'path' },
            diagnostics,
        };
    }
    return { diagnostics };
}
export function resolvePiLaunch(deps = {}) {
    const platform = deps.platform ?? process.platform;
    const io = launchIo(deps);
    try {
        const compiled = resolveCompiledHostLaunch(deps, io, platform);
        if (compiled)
            return compiled;
    }
    catch (error) {
        failResolution(errorMessage(error));
    }
    const hostScript = deps.hostScript ?? process.argv[1];
    let pathDiagnostic;
    if (platform !== 'win32') {
        const pathResult = resolveExecutableOnPosixPath(deps, io);
        if (pathResult.launch)
            return pathResult.launch;
        pathDiagnostic = `no executable pi on PATH (${pathResult.diagnostics.join('; ') || 'no candidates'})`;
    }
    let hostDiagnostic = 'host script was not inspected';
    try {
        const host = findPiManifestFromHostScript(hostScript, io);
        // A manifest that identifies the running host as Pi is authoritative. Never
        // hide its invalid bin/identity behind another module installation.
        return resolvePackageLaunch(host.manifestPath, deps, io, platform, host.sourceReal);
    }
    catch (error) {
        // Only genuine absence or a positively foreign package identity permits the
        // exact installed-module route. I/O and integrity failures remain fatal.
        if (!(error instanceof HostIsNotPiError))
            failResolution(errorMessage(error));
        hostDiagnostic = errorMessage(error);
    }
    let manifestPath;
    try {
        manifestPath = resolvePiManifestFromModules(deps, io);
    }
    catch (error) {
        const prefix = pathDiagnostic === undefined ? '' : `${pathDiagnostic}; `;
        failResolution(`${prefix}${errorMessage(error)}; running host lookup: ${hostDiagnostic}`);
    }
    try {
        return resolvePackageLaunch(manifestPath, deps, io, platform);
    }
    catch (error) {
        failResolution(errorMessage(error));
    }
}
export function piLaunchArgv(launch, piArgs) {
    return [...launch.argvPrefix, ...piArgs];
}
function renderWindowsArgument(value) {
    if (value.length > 0 && !/[ \t"]/.test(value))
        return value;
    let rendered = '"';
    let backslashes = 0;
    for (const char of value) {
        if (char === '\\') {
            backslashes += 1;
            continue;
        }
        if (char === '"') {
            rendered += '\\'.repeat(backslashes * 2 + 1);
            rendered += '"';
            backslashes = 0;
            continue;
        }
        if (backslashes > 0) {
            rendered += '\\'.repeat(backslashes);
            backslashes = 0;
        }
        rendered += char;
    }
    if (backslashes > 0)
        rendered += '\\'.repeat(backslashes * 2);
    rendered += '"';
    return rendered;
}
function renderWindowsCommandLine(parts) {
    return parts.map(renderWindowsArgument).join(' ');
}
export function assertWindowsCommandLineWithinLimit(launch, piArgs, platform, stage) {
    if (platform !== 'win32')
        return;
    const measuredLength = renderWindowsCommandLine([launch.executable, ...launch.argvPrefix, ...piArgs]).length + 1;
    if (measuredLength > WINDOWS_COMMAND_LINE_LIMIT) {
        throw new PiCommandLineLimitError(stage, measuredLength, WINDOWS_COMMAND_LINE_LIMIT);
    }
}
//# sourceMappingURL=pi-launch.js.map