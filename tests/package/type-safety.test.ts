import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findTypeSafetyViolations,
  type TypeSafetyScanOptions,
  type TypeSafetyViolation,
} from '../helpers/typescript-source-guards.js';

// `URL.pathname` yields `/D:/...` on Windows, which then joins into `D:\D:\...`.
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const allTypeScriptRoots = ['extensions', 'src', 'tests', 'scripts'];
const productionTypeScriptRoots = ['extensions', 'src', 'scripts'];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function filesFor(roots: readonly string[]): Promise<string[]> {
  const nested = await Promise.all(roots.map((root) => walk(join(packageRoot, root))));
  return nested.flat().sort();
}

async function scan(
  files: readonly string[],
  options: TypeSafetyScanOptions,
): Promise<TypeSafetyViolation[]> {
  const violations: TypeSafetyViolation[] = [];
  for (const file of files) {
    violations.push(...findTypeSafetyViolations(file, await readFile(file, 'utf8'), options));
  }
  return violations;
}

function formatViolations(violations: readonly TypeSafetyViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${String(violation.line)} ${violation.rule}: ${violation.text}`,
    )
    .join('\n');
}

void describe('type-safety standard', () => {
  void it('classifies syntax and compiler directives without scanning inert text', () => {
    const safeSource = [
      '// Ordinary prose can say any or mention @ts-ignore without becoming a directive.',
      'const quoted = "let escaped: any; // @ts-expect-error";',
      'const template = `value as unknown as Target; // @ts-nocheck`;',
      'const pattern = /@ts-ignore|as\\s+unknown\\s+as|\\bany\\b/u;',
      'const once = value as unknown;',
      'const propertyNamedAny = record.any;',
      'const ordinaryNegation = !flag;',
    ].join('\n');
    assert.deepEqual(
      findTypeSafetyViolations('safe.ts', safeSource, {
        escapeHatches: true,
        nonNullAssertions: true,
      }),
      [],
    );

    const escapeSource = [
      '// @ts-nocheck',
      '// @ts-ignore deliberate fixture',
      'const ignored = 1;',
      '/* @ts-expect-error deliberate fixture */',
      'const expected = 2;',
      'let explicit:',
      '  any;',
      'const multiline = (',
      '  (value as',
      '    unknown)',
      ') as Target;',
      'const angle = <Target>(<unknown>value);',
    ].join('\n');
    const escapeViolations = findTypeSafetyViolations('escapes.ts', escapeSource, {
      escapeHatches: true,
      nonNullAssertions: false,
    });
    assert.deepEqual(
      escapeViolations.map((violation) => violation.rule),
      [
        'compiler suppression',
        'compiler suppression',
        'compiler suppression',
        'explicit top-type escape',
        'double assertion',
        'double assertion',
      ],
    );

    const nonNullViolations = findTypeSafetyViolations(
      'non-null.ts',
      ['const direct = maybe!.value;', 'const parenthesized = (maybe!).value;'].join('\n'),
      { escapeHatches: false, nonNullAssertions: true },
    );
    assert.deepEqual(
      nonNullViolations.map((violation) => violation.rule),
      ['non-null assertion', 'non-null assertion'],
    );
  });

  void it('finds directly nested assertions through type-transparent wrappers only', () => {
    const wrappedSource = [
      'const one = ((value as unknown) satisfies unknown) as Target;',
      'const two = ((((value as unknown) satisfies unknown) satisfies unknown)) as Target;',
      'const three = <Target>(((<unknown>value) satisfies unknown));',
    ].join('\n');
    const wrappedViolations = findTypeSafetyViolations('wrapped.ts', wrappedSource, {
      escapeHatches: true,
      nonNullAssertions: false,
    });
    assert.deepEqual(
      wrappedViolations.map((violation) => violation.rule),
      ['double assertion', 'double assertion', 'double assertion'],
    );

    const aliasSeparated = [
      'const intermediate = value as unknown;',
      'const split = intermediate as Target;',
    ].join('\n');
    assert.deepEqual(
      findTypeSafetyViolations('alias-separated.ts', aliasSeparated, {
        escapeHatches: true,
        nonNullAssertions: false,
      }),
      [],
      'alias-separated assertions are outside this direct-syntax rule',
    );

    const validatedBoundary = [
      'declare function parseInput(): unknown;',
      'declare function assertTarget(value: unknown): asserts value is Target;',
      'const boundary = parseInput() as unknown;',
      'assertTarget(boundary);',
      'const target = boundary as Target;',
    ].join('\n');
    assert.deepEqual(
      findTypeSafetyViolations('validated-boundary.ts', validatedBoundary, {
        escapeHatches: true,
        nonNullAssertions: false,
      }),
      [],
      'the syntax guard must not pretend to prove alias data flow across a validated unknown boundary',
    );
  });

  void it('has no explicit top-type escape, compiler suppressions, or double assertions in package TypeScript', async () => {
    const violations = await scan(await filesFor(allTypeScriptRoots), {
      escapeHatches: true,
      nonNullAssertions: false,
    });
    assert.equal(violations.length, 0, formatViolations(violations));
  });

  void it('has no production non-null assertion bypasses', async () => {
    const violations = await scan(await filesFor(productionTypeScriptRoots), {
      escapeHatches: false,
      nonNullAssertions: true,
    });
    assert.equal(violations.length, 0, formatViolations(violations));
  });
});
