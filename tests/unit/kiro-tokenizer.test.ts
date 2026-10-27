import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { KIRO_OPUS_45_CALIBRATION } from '../../src/core/context/kiro-calibration.js';
import { calibratedKiroForecast, countSurrogateTokens, KIRO_MAX_PRETOKEN_UTF8_BYTES } from '../../src/core/context/kiro-tokenizer.js';
import { assertDelegateAdmission, evaluateDelegateRuntimeBudget, planDelegateAdmission } from '../../src/core/delegate/budget.js';
import { DelegateError, type DelegatePinnedRoute } from '../../src/core/delegate/types.js';

const route: DelegatePinnedRoute = {
  provider: 'kiro', model: 'claude-opus-4-5', qualified_id: 'kiro/claude-opus-4-5',
  context_window_tokens: 200_000, thinking_level: 'max', origin: 'explicit',
};
const limits = {
  max_turns: 24, max_tool_calls: 120, timeout_seconds: 1200,
  max_tool_result_bytes: 65536, max_total_tool_output_bytes: 67108864,
  max_answer_bytes: 4194304, allowed_input_tokens: 171328,
};
const text = 'The reviewer reads the source and verifies each contract before reporting the evidence.\n';
const prompt = text.repeat(Math.ceil(212_910 / text.length)).slice(0, 212_910);

void describe('measured Kiro delegate forecasting', () => {
  void it('refits on training only and covers independent held-out occupancy measurements', () => {
    const bytes = readFileSync(new URL('../fixtures/kiro-opus-45-calibration.json', import.meta.url));
    assert.equal(KIRO_OPUS_45_CALIBRATION.corpus_sha256, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    const corpus = JSON.parse(bytes.toString('utf8')) as { samples: Array<{
      split: string; localTokens: number; rawContextPercent: number; catalogContextWindowTokens: number;
      reportedInput: number; cacheRead: number; cacheWrite: number; usable: boolean;
      wireContainsExactPrompt: boolean; wireContainsExactSystem: boolean; wireToolCount: number;
      countOrigin: string; exactUtf8Bytes: number;
    }> };
    const train = corpus.samples.filter(sample => sample.split === 'train');
    const heldout = corpus.samples.filter(sample => sample.split === 'heldout');
    assert.equal(train.length, KIRO_OPUS_45_CALIBRATION.training_samples);
    assert.equal(heldout.length, KIRO_OPUS_45_CALIBRATION.validation_samples);
    const observed = (sample: (typeof corpus.samples)[number]): number => Math.max(
      Math.ceil(sample.rawContextPercent * sample.catalogContextWindowTokens / 100),
      sample.reportedInput + sample.cacheRead + sample.cacheWrite,
    );
    const numerator = Math.max(...train.map(sample => Number(
      (BigInt(observed(sample)) * 120n + BigInt(sample.localTokens) - 1n) / BigInt(sample.localTokens),
    )));
    assert.equal(numerator, KIRO_OPUS_45_CALIBRATION.multiplier_numerator);
    assert.equal(KIRO_OPUS_45_CALIBRATION.multiplier_denominator, 100);
    assert.equal(KIRO_OPUS_45_CALIBRATION.fixed_tokens, 512);
    assert.equal(KIRO_OPUS_45_CALIBRATION.min_utf8_bytes, 60177);
    assert.equal(KIRO_OPUS_45_CALIBRATION.max_utf8_bytes, 448070);
    assert.equal(KIRO_OPUS_45_CALIBRATION.training_samples, 30);
    assert.equal(KIRO_OPUS_45_CALIBRATION.validation_samples, 19);
    for (const sample of corpus.samples) {
      assert.equal(sample.usable && sample.wireContainsExactPrompt && sample.wireContainsExactSystem, true);
      assert.equal(sample.wireToolCount, 0);
      assert.equal(sample.countOrigin, 'percentage_derived');
      assert.ok(sample.exactUtf8Bytes >= KIRO_OPUS_45_CALIBRATION.min_utf8_bytes);
      assert.ok(sample.exactUtf8Bytes <= KIRO_OPUS_45_CALIBRATION.max_utf8_bytes);
      const forecast = Math.ceil(sample.localTokens * numerator / 100) + KIRO_OPUS_45_CALIBRATION.fixed_tokens;
      assert.ok(forecast >= observed(sample), `${sample.split} forecast must cover observed occupancy`);
    }
  });
  void it('admits the incident byte size without dropping text and retains useful investigation runway', () => {
    assert.ok(KIRO_OPUS_45_CALIBRATION, 'calibration must be backed by the committed corpus');
    const plan = planDelegateAdmission({ route, childPrompt: prompt, childSystemPrompt: 'Read only.', limits });
    assert.equal(plan.launch_utf8_bytes, 212920);
    assert.equal(plan.conservative_launch_fits, false);
    assert.equal(plan.fits, true);
    assert.ok(plan.tokenizer_forecast);
    const fc = plan.tokenizer_forecast;
    const expectedForecast = Number((BigInt(fc.local_tokens) * BigInt(fc.calibration.multiplier_numerator) + BigInt(fc.calibration.multiplier_denominator) - 1n) / BigInt(fc.calibration.multiplier_denominator)) + fc.calibration.fixed_tokens;
    assert.equal(fc.forecast_tokens, expectedForecast, 'forecast_tokens must follow the integer (ceil) formula; a floor mutation must fail');
    assert.ok(plan.retained_growth_budget_tokens > 20_000);
    assert.doesNotThrow(() => assertDelegateAdmission(plan));
    const runtime = evaluateDelegateRuntimeBudget({
      retainedInputBytes: plan.launch_utf8_bytes,
      retainedInputMultibyteBytes: 0, retainedInputDenseBytes: 0,
      retainedInputTexts: [prompt, 'Read only.'],
    }, limits.allowed_input_tokens, route);
    assert.equal(runtime.measuredTokens, plan.launch_input_tokens_upper_bound);
    assert.equal(runtime.withinBudget, true);
    assert.deepEqual(runtime.tokenizer_forecast, plan.tokenizer_forecast);
  });

  void it('rejects a dense payload at the same byte size with an explicit forecast and no false linear reduction', () => {
    const block = Array.from({ length: 90 }, (_, i) => String.fromCharCode(33 + (i * 37) % 90)).join('');
    const dense = block.repeat(Math.ceil(212_910 / block.length)).slice(0, 212_910);
    assert.ok(countSurrogateTokens([dense]) > countSurrogateTokens([prompt]) * 3);
    const plan = planDelegateAdmission({ route, childPrompt: dense, childSystemPrompt: '', limits });
    assert.ok(plan.tokenizer_forecast);
    assert.equal(plan.fits, false);
    assert.throws(() => assertDelegateAdmission(plan), (error: unknown) => {
      assert.ok(error instanceof DelegateError);
      assert.equal(error.childCreated, false);
      assert.ok(error.budget?.tokenizer_forecast);
      assert.match(error.message, /not an exact Claude token count/);
      assert.doesNotMatch(error.message, /Required reduction is at least/);
      return true;
    });
  });

  void it('does not calibrate another model, context window, provider or an unmeasured size', () => {
    assert.ok(KIRO_OPUS_45_CALIBRATION);
    const profile = KIRO_OPUS_45_CALIBRATION;
    for (const other of [
      { ...route, provider: 'anthropic' }, { ...route, model: 'claude-sonnet-4-6' },
      { ...route, context_window_tokens: 1_000_000 }, { provider: route.provider, model: route.model },
    ]) assert.equal(calibratedKiroForecast(other, [prompt], profile), undefined);
    assert.equal(calibratedKiroForecast(route, ['small'], profile), undefined);
    assert.equal(calibratedKiroForecast(route, ['x'.repeat(profile.max_utf8_bytes + 1)], profile), undefined);
    const unknown = planDelegateAdmission({ route: { ...route, model: 'unmeasured' }, childPrompt: prompt, childSystemPrompt: '', limits });
    assert.equal(unknown.fits, false);
    assert.equal(unknown.tokenizer_forecast, undefined);
    assert.equal(unknown.route.rate_source.source, 'unknown_provider_floor');
  });

  void it('handles special-token-looking input as literal text and rejects incomplete runtime accounting', () => {
    assert.ok(countSurrogateTokens(['<|endoftext|><|fim_prefix|>']) > 0);
    assert.throws(() => evaluateDelegateRuntimeBudget({
      retainedInputBytes: 100_000, retainedInputMultibyteBytes: 0,
      retainedInputDenseBytes: 0, retainedInputTexts: ['incomplete'],
    }, limits.allowed_input_tokens, route), /does not match/);
  });

  void it('counts long homogeneous pre-tokens with a bounded byte charge without blocking the process', () => {
    const moduleUrl = new URL('../../src/core/context/kiro-tokenizer.ts', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `import { countSurrogateTokens } from ${JSON.stringify(moduleUrl)}; if (countSurrogateTokens(['a'.repeat(212910)]) !== 212910) process.exit(1);`,
    ], { timeout: 10_000, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const plan = planDelegateAdmission({ route, childPrompt: 'a'.repeat(212910), childSystemPrompt: '', limits });
    assert.equal(plan.fits, false);
    assert.equal(plan.tokenizer_forecast?.long_pretoken_utf8_bytes, 212910);
    assert.equal(KIRO_MAX_PRETOKEN_UTF8_BYTES, 512);
  });

  void it('enforces size boundaries and rejects malformed calibration arithmetic', () => {
    const profile = KIRO_OPUS_45_CALIBRATION;
    const sized = (bytes: number): string => 'a '.repeat(Math.floor(bytes / 2)) + (bytes % 2 ? 'a' : '');
    assert.equal(calibratedKiroForecast(route, [sized(profile.min_utf8_bytes - 1)], profile), undefined);
    assert.ok(calibratedKiroForecast(route, [sized(profile.min_utf8_bytes)], profile));
    assert.ok(calibratedKiroForecast(route, [sized(profile.max_utf8_bytes)], profile));
    for (const invalid of [
      { ...profile, multiplier_numerator: -1 }, { ...profile, multiplier_denominator: 0 },
      { ...profile, fixed_tokens: -1 }, { ...profile, corpus_sha256: 'unbacked' },
    ]) assert.throws(() => calibratedKiroForecast(route, [prompt], invalid));
    assert.throws(() => calibratedKiroForecast(route, [prompt], { ...profile, multiplier_numerator: Number.MAX_SAFE_INTEGER }), RangeError);
    const runtime = evaluateDelegateRuntimeBudget({
      retainedInputBytes: 5, retainedInputMultibyteBytes: 0,
      retainedInputDenseBytes: 0, retainedInputTexts: ['small'],
    }, limits.allowed_input_tokens, route);
    assert.equal(runtime.tokenizer_forecast, undefined);
    assert.equal(runtime.rateSource.source, 'unknown_provider_floor');
    assert.equal(runtime.measuredTokens, 517);
  });
});
