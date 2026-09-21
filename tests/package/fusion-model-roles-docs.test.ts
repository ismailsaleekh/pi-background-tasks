import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseJsonText } from '../../src/core/common.js';
import { buildFusionCleanTaskCanonicalInput } from '../../src/core/fusion/clean-context.js';
import { defaultFusionModelConfig, parseFusionModelConfig } from '../../src/core/fusion/config.js';
import {
  boundedEvaluationErrors,
  validateFusionEvaluation,
} from '../../src/core/fusion/evaluation.js';
import {
  buildBlindEvaluationInput,
  buildEvaluationRepairPrompt,
  buildMergeInput,
} from '../../src/core/fusion/prompts.js';
import {
  FUSION_EVALUATION_SCHEMA_VERSION,
  type FusionEvaluationV1,
} from '../../src/core/fusion/types.js';
import { FUSION_WORKFLOW_PROFILES } from '../../src/core/fusion/workflows.js';

const root = new URL('../../', import.meta.url);

function doc(path: string): string {
  return readFileSync(new URL(path, root), 'utf8');
}

function jsonFenceAfter(source: string, heading: string): unknown {
  const headingIndex = source.indexOf(heading);
  assert.notEqual(headingIndex, -1, `missing ${heading}`);
  const match = /```json\n([\s\S]*?)\n```/u.exec(source.slice(headingIndex + heading.length));
  assert.ok(match?.[1], `missing JSON example after ${heading}`);
  return parseJsonText(match[1]);
}

function evaluation(): FusionEvaluationV1 {
  return {
    schema_version: FUSION_EVALUATION_SCHEMA_VERSION,
    candidate_assessments: [
      {
        candidate_id: 'A',
        summary: 'A summary',
        strengths: ['A strength'],
        limitations: ['A limitation'],
        useful_contributions: ['A contribution'],
        risks: ['A risk'],
      },
      {
        candidate_id: 'B',
        summary: 'B summary',
        strengths: ['B strength'],
        limitations: ['B limitation'],
        useful_contributions: ['B contribution'],
        risks: ['B risk'],
      },
      {
        candidate_id: 'C',
        summary: 'C summary',
        strengths: ['C strength'],
        limitations: ['C limitation'],
        useful_contributions: ['C contribution'],
        risks: ['C risk'],
      },
    ],
    agreements: ['shared conclusion'],
    conflicts: [],
    synthesis_plan: {
      must_include: [{ candidate_id: 'A', contribution: 'A contribution' }],
      must_resolve: [],
      must_avoid: [],
    },
  };
}

void describe('Fusion model-role documentation', () => {
  void it('keeps the user-facing role, tradeoff, and invocation contract visible', () => {
    // Drift protection only: the tests below exercise the production parsers and
    // prompt/profile contracts rather than treating prose presence as semantic proof.
    const guide = doc('docs/commands/fusion-models.md');
    const subsystem = doc('docs/subsystems/fusion.md');

    assert.match(guide, /three independent attempts over the same canonical input/i);
    assert.match(guide, /not assigned specialties/i);
    assert.match(guide, /slowest candidate/i);
    assert.match(guide, /anonymous answers labeled A, B, and C/i);
    assert.match(guide, /same evaluator slot and resolved model/i);
    assert.match(guide, /original blind input, the invalid output, and bounded validation errors/i);
    assert.match(
      guide,
      /original canonical input, all three candidate outputs, and the validated evaluation/i,
    );
    assert.match(guide, /Quality-first/i);
    assert.match(guide, /Speed-first/i);
    assert.match(guide, /subscription OAuth/i);
    assert.match(guide, /five child invocations/i);
    assert.match(guide, /six child invocations/i);
    assert.match(guide, /zero children/i);
    assert.match(guide, /Fusion runtime limits/);

    assert.match(subsystem, /normal-path critical path/i);
    assert.match(subsystem, /evaluation repair.*same.*evaluator/isu);
    assert.match(subsystem, /five slots.*not.*five distinct models/isu);
  });

  void it('parses the documented repeated-route example with the production config parser', () => {
    const example = jsonFenceAfter(
      doc('docs/commands/fusion-models.md'),
      '### Valid repeated-route example',
    );
    const parsed = parseFusionModelConfig(example);
    assert.deepEqual(parsed, defaultFusionModelConfig());
    assert.equal(new Set([...parsed.candidates, parsed.evaluator, parsed.merger]).size, 1);
  });

  void it('anchors fan-in, closed evaluation, and tool policy claims in pure runtime contracts', () => {
    const canonical = buildFusionCleanTaskCanonicalInput({
      cwd: '/example/project',
      source: 'tool',
      workflow: 'investigate',
      request: 'Inspect the requested behavior.',
    }).input;
    const candidates = [
      { candidate_id: 'A' as const, response: 'answer A' },
      { candidate_id: 'B' as const, response: 'answer B' },
      { candidate_id: 'C' as const, response: 'answer C' },
    ] as const;
    const blind = buildBlindEvaluationInput(canonical, candidates);

    assert.strictEqual(blind.canonical_input, canonical);
    assert.strictEqual(blind.candidates, candidates);
    assert.deepEqual(
      blind.candidates.map((candidate) => candidate.candidate_id),
      ['A', 'B', 'C'],
    );

    const validationErrors = boundedEvaluationErrors(['x'.repeat(800), 'missing synthesis_plan']);
    const repairInput = {
      schema_version: 'pi-background-tasks.fusion-evaluation-repair-input.v1' as const,
      original_blind_input: blind,
      invalid_output: '{"invalid":true}',
      validation_errors: validationErrors,
    };
    assert.deepEqual(parseJsonText(buildEvaluationRepairPrompt(repairInput)), repairInput);
    const firstValidationError = validationErrors[0];
    assert.ok(firstValidationError !== undefined);
    assert.ok(firstValidationError.length <= 500);

    const validEvaluation = evaluation();
    assert.equal(validateFusionEvaluation(validEvaluation).ok, true);
    const invalidEvaluation = validateFusionEvaluation({ ...validEvaluation, winner: 'A' });
    assert.equal(invalidEvaluation.ok, false);
    assert.ok(invalidEvaluation.errors.some((error) => error.includes('unknown key winner')));

    const merge = buildMergeInput(canonical, candidates, validEvaluation);
    assert.strictEqual(merge.canonical_input, canonical);
    assert.strictEqual(merge.candidates, candidates);
    assert.strictEqual(merge.evaluation, validEvaluation);

    for (const profile of FUSION_WORKFLOW_PROFILES) {
      assert.deepEqual(profile.evaluatorTools, []);
      assert.deepEqual(profile.mergeTools, []);
    }
    assert.deepEqual(
      FUSION_WORKFLOW_PROFILES.map((profile) => [profile.id, ...profile.candidateTools]),
      [
        ['reason'],
        ['investigate', 'read', 'grep', 'find', 'ls'],
        ['research', 'read', 'grep', 'find', 'ls', 'fusion_web_fetch'],
        ['validate', 'read', 'grep', 'find', 'ls'],
      ],
    );
  });
});
