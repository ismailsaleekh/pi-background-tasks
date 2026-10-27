import type { KiroTokenizerCalibration } from './kiro-tokenizer.js';

// Selected on training samples only; coverage and provenance are checked against the committed corpus.
export const KIRO_OPUS_45_CALIBRATION: KiroTokenizerCalibration = Object.freeze({
  "id": "kiro-opus-4-5-cl100k-2026-10-27-v1",
  "provider": "kiro",
  "model": "claude-opus-4-5",
  "context_window_tokens": 200000,
  "tokenizer": "cl100k_base",
  "multiplier_numerator": 194,
  "multiplier_denominator": 100,
  "fixed_tokens": 512,
  "min_utf8_bytes": 60177,
  "max_utf8_bytes": 448070,
  "training_samples": 30,
  "validation_samples": 19,
  "corpus_sha256": "sha256:a49aa574d35f97873e4864392e63bfe2edaaba8fddb61c6ecb7aee896674f84d",
  "measurement_source": "percentage-derived context occupancy, rounded upward; Pi 1.4.0 / pi-provider-kiro 0.12.1"
});
