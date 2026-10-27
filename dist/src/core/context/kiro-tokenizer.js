import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let TiktokenCtor;
let cl100kRanks;
let jsTiktokenAvailable = false;
try {
    TiktokenCtor = require('js-tiktoken/lite').Tiktoken;
    cl100kRanks = require('js-tiktoken/ranks/cl100k_base');
    if (cl100kRanks && typeof cl100kRanks === 'object' && cl100kRanks !== null && 'default' in cl100kRanks && cl100kRanks.default !== undefined)
        cl100kRanks = cl100kRanks.default;
    jsTiktokenAvailable = true;
}
catch {
    jsTiktokenAvailable = false;
}
export const KIRO_MAX_PRETOKEN_UTF8_BYTES = 512;
let encoder;
let pretokenRegex;
const pretokenEncodeCache = new Map();
const PRETOKEN_ENCODE_CACHE_MAX = 8192;
// Initialize the regex once after ranks are loaded.
if (jsTiktokenAvailable && cl100kRanks !== undefined) {
    try {
        pretokenRegex = new RegExp(cl100kRanks.pat_str, 'ug');
    }
    catch {
        pretokenRegex = undefined;
    }
}
export function countSurrogateTokens(texts) {
    return boundedSurrogateCount(texts).tokens;
}
export function countSurrogateTokenDetails(texts) {
    return boundedSurrogateCount(texts);
}
function boundedSurrogateCount(texts) {
    if (!jsTiktokenAvailable) {
        let tokens = 0;
        for (const text of texts) {
            tokens += Buffer.byteLength(text, 'utf8');
        }
        return { tokens, longBytes: 0 };
    }
    if (TiktokenCtor === undefined || pretokenRegex === undefined || cl100kRanks === undefined) {
        let tokens = 0;
        for (const text of texts)
            tokens += Buffer.byteLength(text, 'utf8');
        return { tokens, longBytes: 0 };
    }
    encoder ??= new TiktokenCtor(cl100kRanks);
    const activeEncoder = encoder;
    const regex = pretokenRegex;
    let tokens = 0;
    let longBytes = 0;
    for (const text of texts) {
        // Encode pretoken-by-pretoken so repeated pretokens can be cached and the
        // quadratic JS BPE path is only ever applied to one pretoken at a time.
        // Long pretokens are charged as raw UTF-8 bytes (conservative).
        for (const match of text.matchAll(regex)) {
            const pretoken = match[0];
            if (pretoken.length === 0)
                continue;
            const bytes = Buffer.byteLength(pretoken, 'utf8');
            if (bytes > KIRO_MAX_PRETOKEN_UTF8_BYTES) {
                tokens += bytes;
                longBytes += bytes;
                continue;
            }
            let cached = pretokenEncodeCache.get(pretoken);
            if (cached === undefined) {
                cached = activeEncoder.encode(pretoken, [], []).length;
                if (pretokenEncodeCache.size >= PRETOKEN_ENCODE_CACHE_MAX) {
                    const oldest = pretokenEncodeCache.keys().next().value;
                    if (oldest !== undefined)
                        pretokenEncodeCache.delete(oldest);
                }
                pretokenEncodeCache.set(pretoken, cached);
            }
            else {
                // LRU: refresh insertion order.
                pretokenEncodeCache.delete(pretoken);
                pretokenEncodeCache.set(pretoken, cached);
            }
            tokens += cached;
        }
    }
    return { tokens, longBytes };
}
export function calibratedKiroForecastFromCounts(route, bytes, localTokens, calibration, longPretokenUtf8Bytes = 0) {
    if (!jsTiktokenAvailable)
        return undefined;
    if (route.provider !== calibration.provider || route.model !== calibration.model ||
        route.context_window_tokens !== calibration.context_window_tokens)
        return undefined;
    for (const value of [calibration.multiplier_numerator, calibration.multiplier_denominator,
        calibration.context_window_tokens, calibration.min_utf8_bytes, calibration.max_utf8_bytes,
        calibration.training_samples, calibration.validation_samples]) {
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new TypeError('Kiro calibration requires positive safe integers');
    }
    if (!Number.isSafeInteger(calibration.fixed_tokens) || calibration.fixed_tokens < 0 ||
        calibration.min_utf8_bytes > calibration.max_utf8_bytes ||
        !/^sha256:[a-f0-9]{64}$/.test(calibration.corpus_sha256)) {
        throw new TypeError('Invalid Kiro calibration domain or provenance');
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(localTokens) || localTokens < 0 ||
        !Number.isSafeInteger(longPretokenUtf8Bytes) || longPretokenUtf8Bytes < 0) {
        throw new TypeError('Kiro forecast counts must be non-negative safe integers');
    }
    if (bytes < calibration.min_utf8_bytes || bytes > calibration.max_utf8_bytes)
        return undefined;
    if (localTokens <= 0)
        return undefined;
    const numerator = BigInt(localTokens) * BigInt(calibration.multiplier_numerator);
    const denominator = BigInt(calibration.multiplier_denominator);
    const forecastInteger = (numerator + denominator - 1n) / denominator + BigInt(calibration.fixed_tokens);
    if (forecastInteger > BigInt(Number.MAX_SAFE_INTEGER))
        throw new RangeError('Kiro token forecast exceeds safe integer arithmetic');
    const forecast = Number(forecastInteger);
    return {
        calibration,
        local_tokens: localTokens,
        forecast_tokens: forecast,
        long_pretoken_utf8_bytes: longPretokenUtf8Bytes,
        max_pretoken_utf8_bytes: KIRO_MAX_PRETOKEN_UTF8_BYTES,
        warning: 'Empirical route-specific surrogate forecast; not an exact Claude token count or a universal bound. Byte counter-forecast remains available.',
    };
}
export function calibratedKiroForecast(route, texts, calibration) {
    const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
    const count = boundedSurrogateCount(texts);
    return calibratedKiroForecastFromCounts(route, bytes, count.tokens, calibration, count.longBytes);
}
//# sourceMappingURL=kiro-tokenizer.js.map