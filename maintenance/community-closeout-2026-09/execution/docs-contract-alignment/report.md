# EventBus docs-contract alignment report

## Result

**PASS.** The stale package prose guard now pins both sides of the accepted EventBus close contract without changing runtime or documentation:

1. requests **first emitted after close** are not handled and receive no service response; and
2. a request already accepted before close may receive one error response, but never post-close success.

Only `tests/package/docs-contract.test.ts` was committed.

## Commit and exact change

- Base / parent: `ab474d649274b6722abe7ed290c3f51c72236f69`
- Follow-up commit: `7bca31b7ca6c040076a2fa1ac8d397a5a12d4bfa`
- Commit subject: `test(docs): align EventBus close contract guard`
- Commit tree: `740a3c339509998d0aabd058f3faa01d8bd5497d`
- Committed paths: exactly `tests/package/docs-contract.test.ts`
- File blob: `731eed52d4817ab5a965b2ac74e6474765d50290`
- Final file SHA-256: `7d33e1e4ded1163b85ebb41ee442700c2384e84e11ea81349f6a704390deddf1`
- Exact patch: `/private/tmp/pi-bg-closeout-iNoltL/reports/docs-contract-alignment/exact.diff`
- Exact patch size: 1,070 bytes
- Exact patch SHA-256: `c17abd133f4331e833d821cd73b9fa688864800ca21e489aa06749f9526770d6`

```diff
diff --git a/tests/package/docs-contract.test.ts b/tests/package/docs-contract.test.ts
index 18701b5..731eed5 100644
--- a/tests/package/docs-contract.test.ts
+++ b/tests/package/docs-contract.test.ts
@@ -58,7 +58,14 @@ void describe('docs package integration contract', () => {
 
     assert.match(text('docs/commands/task-manager.md'), /exact task id opens detail view/);
     assert.match(text('docs/api/eventbus-v1.md'), /at least once under emission failure/);
-    assert.match(text('docs/api/eventbus-v1.md'), /later requests are not handled/);
+    assert.match(
+      text('docs/api/eventbus-v1.md'),
+      /requests first emitted after close are not handled and receive no service response/,
+    );
+    assert.match(
+      text('docs/api/eventbus-v1.md'),
+      /request already accepted before close may receive one error response, but never a post-close success/,
+    );
     assert.match(text('docs/subsystems/background-task-runtime.md'), /rather than issuing `fsync`/);
     assert.match(
       text('docs/subsystems/background-task-runtime.md'),
```

## Semantic mapping

- `docs/api/eventbus-v1.md:93` contains the reviewed distinction verbatim. The new guards preserve both clauses rather than merely replacing the stale word “later.”
- `src/core/extension-api.ts:452-456` permanently marks the service closed and removes the request listener. This is why a request first emitted after closure has no service handler and no response.
- An already-entered handler can remain in flight. After execution, `src/core/extension-api.ts:493-497` prevents success once closure/shutdown is observed; the error path at `:498-502` may emit the single failure response documented for accepted work.
- Existing behavioral controls pin execution: `tests/unit/extension-api.test.ts:624-664` requires one failure for accepted preflight crossing shutdown, `:674-752` forbids post-close success for spawned admission work, and `:944-957` requires a newly emitted post-close request to time out without a response.
- The accepted R1 materials were inspected. `admission-review/review.md` records passing post-close insertion/spawn/success checks and EventBus response gating while separately identifying the then-remaining process-tree issue. `registry-tree-review/review.md` records the later correction as PASS and independently reports EventBus protocol **8/8** within focused **110/110** coverage. This change does not reopen or alter those behaviors.

## Verification

Every substantive command used Node `v22.19.0`, npm `10.9.3`, and:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/docs-contract-alignment
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/docs-contract-alignment
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/docs-contract-alignment
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
NPM_CONFIG_CACHE=/private/tmp/pi-bg-closeout-iNoltL/tmp/docs-contract-alignment/npm-cache
NPM_CONFIG_USERCONFIG=/private/tmp/pi-bg-closeout-iNoltL/tmp/docs-contract-alignment/npm-config/user.npmrc
NPM_CONFIG_GLOBALCONFIG=/private/tmp/pi-bg-closeout-iNoltL/tmp/docs-contract-alignment/npm-config/global.npmrc
```

| Check | Result | Evidence |
|---|---:|---|
| RED: `./node_modules/.bin/tsx --test tests/package/docs-contract.test.ts` before edit | exit **1**; 2 tests, 1 pass / 1 fail; exact stale `/later requests are not handled/` assertion | `logs/red-focused.log` |
| GREEN: same focused command after edit | exit **0**; **2/2** | `logs/green-focused.log` |
| Post-commit focused command | exit **0**; **2/2** | `logs/postcommit-focused.log` |
| `npm run test:docs` | exit **0**; **5/5** | `logs/test-docs.log` |
| `npm run docs:verify` | exit **0**; deterministic generation OK, 31 surfaces / 50 sources | `logs/docs-verify.log` |
| `npm run typecheck` | exit **0** | `logs/typecheck.log` |
| `npm run test:type-safety` | exit **0**; **4/4** | `logs/type-safety.log` |
| `npm run test:package` | exit **0**; **67/67** overall, including package **35/35** and the real local-tarball offline install | `logs/package-test.log` |
| Node 22 focused Prettier check for the owned file | exit **0** | `logs/prettier.log` |
| Commit diff check | exit **0** | `logs/postcommit-integrity.log` |

The full/default/root suite and hook-contract lane were intentionally not run; the parent owns the full-chain rerun.

## Scope and integrity proof

- Before and after aggregate tracked `src/**` + `docs/**` index identity: `c4d67e402cf23a3fbcc16289cc5d924ec7dced16a27149050e7a955884276589`.
- Before and after aggregate `src/**` + `docs/**` worktree-byte identity: `37ab373e4efcc8f708f969855004e8a95df3d0851b69385c90687f79dd9ea07b`.
- `git diff ab474d649274b6722abe7ed290c3f51c72236f69..7bca31b7ca6c040076a2fa1ac8d397a5a12d4bfa -- src docs`: exit 0 / empty.
- Worktree `git diff -- src docs`: exit 0 / empty.
- The commit contains one path and no runtime, manifest, generated-doc, authored-doc, B0, C1, or maintenance file.
- Entry-state parent-owned `maintenance/community-closeout-2026-09/STATE.md` and untracked execution directories remain present and were not staged or committed.

Integrity details are in `logs/pre-edit-integrity.log` and `logs/postcommit-integrity.log`.

## Route, isolation, and cleanup

- Effective route: `openai-codex` / `gpt-5.6-sol` / `max` (`PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` verified).
- Darwin arm64; all requested gates above ran on Node `22.19.0`.
- No checkout/worktree/repository copy, shared-dependency install or mutation, external network, provider call, user agent/auth/session state, GitHub operation, push, publish, paid API, Fusion tool, delegated agent, history rewrite, docs generation, or semantic attestation was used. The package lane's required install control used only its task-owned offline local fixture path.
- Owned TMP/HOME/agent roots removed: **3/3 absent**.
- Remaining process commands referencing those owned roots: **0**.
- Final retained report footprint: 76 KiB, well below 100 MiB.
- Cleanup evidence: `logs/cleanup.log`.
