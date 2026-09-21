/** Activation-local synchronous close callbacks installed by the entrypoint. */
export class SynchronousActivationCloseFence {
    closed = false;
    callbacks = new Set();
    add(callback) {
        this.callbacks.add(callback);
        if (this.closed)
            callback();
    }
    close() {
        this.closed = true;
        // Re-run idempotent teardown callbacks on repeated lifecycle dispatch. The
        // core callback deliberately clears handles assigned by racing continuations.
        const failures = [];
        for (const callback of this.callbacks) {
            try {
                callback();
            }
            catch (error) {
                failures.push(error);
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, `synchronous activation close barrier failed in ${String(failures.length)} callback(s)`);
        }
    }
}
const MODULE_ID_MAX_CHARS = 120;
const CAUSE_MAX_CHARS = 480;
const CLOSE_REASON_MAX_CHARS = 160;
function boundedSingleLine(value, maximum) {
    const singleLine = value.replace(/\s+/gu, ' ').trim();
    if (singleLine.length <= maximum)
        return singleLine;
    return `${singleLine.slice(0, maximum)}…`;
}
function boundedModuleId(moduleId) {
    const bounded = boundedSingleLine(moduleId, MODULE_ID_MAX_CHARS);
    return bounded.length > 0 ? bounded : 'unnamed-module';
}
function causeText(error) {
    if (error instanceof Error) {
        const message = error.message.trim();
        return boundedSingleLine(message.length > 0 ? `${error.name}: ${message}` : error.name, CAUSE_MAX_CHARS);
    }
    return boundedSingleLine(String(error), CAUSE_MAX_CHARS);
}
class LazyModuleLoadError extends Error {
    code = 'lazy_module_load_failed';
    moduleId;
    constructor(moduleId, error) {
        const cause = causeText(error);
        super(`lazy_module_load_failed: deferred module ${moduleId} could not load: ${cause}`);
        this.name = 'LazyModuleLoadError';
        this.moduleId = moduleId;
    }
}
class LazyModuleClosedError extends Error {
    code = 'lazy_module_closed';
    moduleId;
    constructor(moduleId, reason) {
        super(`lazy_module_closed: deferred module ${moduleId} belongs to a closed activation (${boundedSingleLine(reason, CLOSE_REASON_MAX_CHARS) || 'closed'})`);
        this.name = 'LazyModuleClosedError';
        this.moduleId = moduleId;
    }
}
/**
 * Activation-local, single-flight deferred module loader.
 *
 * The loader is deliberately terminal after `close()`: a Pi reload creates a
 * fresh facade and therefore a fresh loader rather than reviving stale state.
 */
export class LazyModule {
    moduleId;
    importer;
    currentState = 'unloaded';
    activationGeneration = 0;
    loadingPromise;
    loadedValue;
    loadFailure;
    closedFailure;
    constructor(moduleId, importer) {
        this.moduleId = boundedModuleId(moduleId);
        this.importer = importer;
    }
    get state() {
        return this.currentState;
    }
    /** Synchronously and permanently close this activation. */
    close(reason = 'activation closed') {
        if (this.currentState === 'closed')
            return;
        this.activationGeneration += 1;
        this.currentState = 'closed';
        this.loadedValue = undefined;
        this.loadingPromise = undefined;
        this.loadFailure = undefined;
        this.closedFailure = new LazyModuleClosedError(this.moduleId, reason);
    }
    /** Assert immediately before an activation-owned side effect. */
    assertOpen(expectedGeneration = this.activationGeneration) {
        if (this.currentState === 'closed' ||
            expectedGeneration !== this.activationGeneration) {
            throw this.closedError();
        }
    }
    load() {
        const generation = this.activationGeneration;
        try {
            this.assertOpen(generation);
        }
        catch (error) {
            return Promise.reject(error);
        }
        if (this.currentState === 'loaded') {
            const loaded = this.loadedValue;
            if (loaded === undefined) {
                return Promise.reject(new Error(`lazy_module_invariant: ${this.moduleId} is loaded without a value`));
            }
            return Promise.resolve(loaded.value);
        }
        if (this.currentState === 'failed') {
            const failure = this.loadFailure;
            if (failure === undefined) {
                return Promise.reject(new Error(`lazy_module_invariant: ${this.moduleId} failed without an error`));
            }
            return Promise.reject(failure);
        }
        if (this.currentState === 'loading') {
            const pending = this.loadingPromise;
            if (pending === undefined) {
                return Promise.reject(new Error(`lazy_module_invariant: ${this.moduleId} is loading without a promise`));
            }
            return pending;
        }
        this.currentState = 'loading';
        // The importer itself runs in a later microtask. `loadingPromise` is stored
        // before that callback can run, including under re-entrant test importers.
        const pending = Promise.resolve()
            .then(() => {
            this.assertOpen(generation);
            return this.importer();
        })
            .then((value) => {
            this.assertOpen(generation);
            this.loadedValue = { value };
            this.loadingPromise = undefined;
            this.currentState = 'loaded';
            return value;
        }, (error) => {
            this.assertOpen(generation);
            const failure = new LazyModuleLoadError(this.moduleId, error);
            this.loadFailure = failure;
            this.loadingPromise = undefined;
            this.currentState = 'failed';
            throw failure;
        });
        this.loadingPromise = pending;
        return pending;
    }
    /**
     * Load once, then invoke this caller's operation independently after the
     * final generation check. Only module loading is shared between callers.
     */
    async run(operation) {
        const generation = this.activationGeneration;
        this.assertOpen(generation);
        const module = await this.load();
        this.assertOpen(generation);
        return operation(module);
    }
    closedError() {
        const failure = this.closedFailure;
        if (failure !== undefined)
            return failure;
        const created = new LazyModuleClosedError(this.moduleId, 'activation closed');
        this.closedFailure = created;
        return created;
    }
}
//# sourceMappingURL=lazy-module.js.map