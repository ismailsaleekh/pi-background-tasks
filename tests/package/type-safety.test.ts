import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

interface Check {
  rule: string;
  pattern: RegExp;
}

async function scan(files: readonly string[], checks: readonly Check[]): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const check of checks) {
        if (check.pattern.test(line))
          violations.push({ file, line: index + 1, rule: check.rule, text: line.trim() });
      }
    }
  }
  return violations;
}

function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${String(violation.line)} ${violation.rule}: ${violation.text}`,
    )
    .join('\n');
}

void describe('type-safety standard', () => {
  void it('has no explicit top-type escape, compiler suppressions, or double assertions in package TypeScript', async () => {
    const explicitTopTypePattern = new RegExp('\\b' + 'an' + 'y' + '\\b');
    const violations = await scan(await filesFor(allTypeScriptRoots), [
      { rule: 'explicit top-type escape', pattern: explicitTopTypePattern },
      { rule: 'compiler suppression', pattern: /@ts-(?:ignore|expect-error|nocheck)/ },
      { rule: 'double assertion', pattern: /\bas\s+(?:unknown|never)\s+as\b/ },
    ]);
    assert.equal(violations.length, 0, formatViolations(violations));
  });

  void it('has no production non-null assertion bypasses', async () => {
    const violations = await scan(await filesFor(productionTypeScriptRoots), [
      { rule: 'non-null assertion', pattern: /(?:!\.|!\)|!;|!\]|!$)/ },
    ]);
    assert.equal(violations.length, 0, formatViolations(violations));
  });
});
