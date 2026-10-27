/** Light registration constants shared by the delegate facade and budget engine. */
import type { DelegateBudgetRouteSource } from './types.js';

export function describeDelegateEstimator(budget: DelegateBudgetRouteSource): string {
  const forecast = budget.tokenizer_forecast;
  if (forecast !== undefined) {
    const profile = forecast.calibration;
    return `Estimator: ${profile.id}, ${profile.tokenizer} surrogate × ${String(profile.multiplier_numerator)}/${String(profile.multiplier_denominator)} + ${String(profile.fixed_tokens)} tokens; corpus ${profile.corpus_sha256}. ${forecast.warning}`;
  }
  const source = budget.rate_source;
  return `Estimator: family ${budget.family}, source ${source.source}, rate ${String(source.effective_rate_bytes_per_token_x100)}/100 B/tok + ${String(source.affine_f_tokens)} tokens${source.warning === null ? '' : `; warning: ${source.warning}`}`;
}
export const DELEGATE_DEFAULT_MAX_TURNS = 24;
export const DELEGATE_DEFAULT_MAX_TOOL_CALLS = 120;
export const DELEGATE_DEFAULT_TIMEOUT_SECONDS = 1200;
/** Answers at or under this serialize inline; larger ones degrade explicitly. */
export const DELEGATE_INLINE_ANSWER_BYTES = 48 * 1024;
