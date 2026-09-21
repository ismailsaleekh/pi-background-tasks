# F1 Fusion role type correction report

## Result

Applied the independently recommended strict narrowing in the single owned file, `tests/package/fusion-model-roles-docs.test.ts`. No production file, documentation file, or other test was changed. The fix is intentionally unstaged and uncommitted.

Observed route at entry: `openai-codex / gpt-5.6-sol / max` (`PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`).

## Exact diff and final hash

```diff
diff --git a/tests/package/fusion-model-roles-docs.test.ts b/tests/package/fusion-model-roles-docs.test.ts
index b4e0e58..9bb0671 100644
--- a/tests/package/fusion-model-roles-docs.test.ts
+++ b/tests/package/fusion-model-roles-docs.test.ts
@@ -141,7 +141,9 @@ void describe('Fusion model-role documentation', () => {
       validation_errors: validationErrors,
     };
     assert.deepEqual(parseJsonText(buildEvaluationRepairPrompt(repairInput)), repairInput);
-    assert.ok(validationErrors[0].length <= 500);
+    const firstValidationError = validationErrors[0];
+    assert.ok(firstValidationError !== undefined);
+    assert.ok(firstValidationError.length <= 500);
 
     const validEvaluation = evaluation();
     assert.equal(validateFusionEvaluation(validEvaluation).ok, true);
```

Final `tests/package/fusion-model-roles-docs.test.ts` hashes:

- SHA-256: `feea45e813075b15a7e9971149c0e4c6af581ffd26c0e8b96a12afd2661fd560`
- Git blob: `9bb067163df0080af4c1ad70f6b417e51779b903`

Delta summary: 1 file, 3 insertions, 1 deletion.

## Red and green evidence

All commands used this isolated environment:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/fusion-role-typefix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/fusion-role-typefix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/fusion-role-typefix
PI_OFFLINE=1
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
CI=1
GIT_ALLOW_PROTOCOL=file
```

The scratch config is `/private/tmp/pi-bg-closeout-iNoltL/reports/fusion-role-typefix/config/tsconfig.f1-test.json`. It extends the package `tsconfig.json`, supplies the package `node_modules/@types` as `typeRoots`, sets one absolute `files` entry for the focused test, and sets `include` to `[]`.

### RED before correction

```sh
env TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/fusion-role-typefix HOME=/private/tmp/pi-bg-closeout-iNoltL/home/fusion-role-typefix PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/fusion-role-typefix PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file ./node_modules/.bin/tsc --project /private/tmp/pi-bg-closeout-iNoltL/reports/fusion-role-typefix/config/tsconfig.f1-test.json --pretty false
```

Exit `2`, reproducing exactly:

```text
tests/package/fusion-model-roles-docs.test.ts(144,15): error TS2532: Object is possibly 'undefined'.
```

### GREEN after correction

The identical strict `tsc` command above exited `0` with no diagnostics.

Focused tests:

```sh
env TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/fusion-role-typefix HOME=/private/tmp/pi-bg-closeout-iNoltL/home/fusion-role-typefix PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/fusion-role-typefix PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file ./node_modules/.bin/tsx --test tests/package/fusion-model-roles-docs.test.ts
```

Exit `0`; 3 tests passed, 0 failed:

1. `keeps the user-facing role, tradeoff, and invocation contract visible` — PASS
2. `parses the documented repeated-route example with the production config parser` — PASS
3. `anchors fan-in, closed evaluation, and tool policy claims in pure runtime contracts` — PASS

Focused static checks also passed:

- `../../node_modules/.bin/prettier --check tests/package/fusion-model-roles-docs.test.ts` — exit `0`
- `../../node_modules/.bin/eslint tests/package/fusion-model-roles-docs.test.ts` — exit `0`
- `git diff --check -- tests/package/fusion-model-roles-docs.test.ts` — exit `0`

Full/default/root suites were not run, as required.

## Frozen documentation hashes

Both accepted authored docs remained byte-identical before and after the correction:

| File | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `docs/commands/fusion-models.md` | `eda4ccf0849a70d9ecbbac98fd26a165bceb60d88eaf074e3d3be563721794d5` | `eda4ccf0849a70d9ecbbac98fd26a165bceb60d88eaf074e3d3be563721794d5` |
| `docs/subsystems/fusion.md` | `df54271b7c83bb68380c944605336b9b890505e117c2df00375d88f583d8c45a` | `df54271b7c83bb68380c944605336b9b890505e117c2df00375d88f583d8c45a` |

## Isolation, cleanup, and handoff

- No Fusion/agent/provider call, network access, paid API, install, publish, push, extra checkout, staging, commit, or history operation was performed.
- Existing dependencies were only executed/read; they were not modified.
- Peak observed task-owned scratch was `12,328 KiB`, below 50 MiB.
- Assigned `tmp`, `home`, and `agent` roots were cleaned and recreated at `0 KiB` each.
- Final standalone process probe found `0` processes using those roots.
- The sole repository delta is the unstaged named-path correction above; pre-existing unrelated dirt was preserved.

Suggested commit message: `test: narrow Fusion validation error before length check`
