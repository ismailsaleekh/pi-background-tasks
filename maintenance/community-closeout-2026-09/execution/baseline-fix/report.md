# Mission B0 correction report

## Result and boundary

All five independent-review findings are corrected in the working tree. The corrections remain **unstaged and uncommitted** for the parent to commit mechanically. No index/history operation, production edit, generated-doc edit, manifest/lock edit, package checkout/worktree/source copy, network/GitHub action, publish, paid API, Fusion, or delegated agent was used. Reviewer repro scripts were retained only under the authorized reports directory.

Observed route before substantive work:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

Correction base for all seven owned paths:

```text
c0ba66543c67a468a67a859b7ff2d267d48b2e26
base tree 53004f0129109869082a671750fbad13c8ccc3e5
```

Initial checkout HEAD was `1b3d48d833554ced807c729cab354dd7cc73b79d`. The concurrent launcher worker later advanced HEAD, without touching these seven paths, to `b7e4bcdaec093e5d25faa2eebde57e45ab2b6220` (`fix(core): verify Pi child launch routes`).

### Exact owned changed paths

1. `tests/helpers/typescript-source-guards.ts`
2. `tests/helpers/offline-npm-registry.ts`
3. `tests/package/type-safety.test.ts`
4. `tests/package/package.test.ts`
5. `docs/operations/testing.md`
6. `TESTING.md`
7. `TEST_PLAN.md`

Design was written before edits at `reports/baseline-fix/design.md`.

## Finding-by-finding corrections and red/green evidence

Every red command used the task roots and environment required by the brief. Each named regression was first added while the corresponding `c0ba665` helper remained in place.

| Finding | Correction | Red result | Green result |
|---|---|---|---|
| BR-1 | URL abstract values distinguish URL objects, absolute strings, relative strings, `import.meta.url`, and templates with a static scheme. A URL object or statically absolute first argument determines the protocol and never consults an irrelevant base. | Focused `file URL guard gives absolute first arguments precedence over bases`: exit 1, 0/1; old helper returned `[]` instead of file lines 2/3/5. | Included in final five-finding command: pass. Corrected reviewer probe reports file object `[2]`, import-meta `[1]`, template file `[2]`, HTTPS object/template `[]`. |
| BR-2 | Whole-file assignment collection was replaced by finite flow state at each use. Sequential writes overwrite, unknown-condition branches merge, literal-infeasible branches are pruned, continuing branch outcomes are respected, switch alternatives/fallthrough are joined, and loops are bounded. Any tracked may-file alternative is retained. | Focused `file URL guard uses feasible values at each pathname read`: exit 1, 0/1; later HTTPS masked the earlier file read. A supplementary switch fixture also failed 0/1 before switch-flow support. | Included in final five-finding command: pass, including earlier/later write controls, may-file `if` and `switch`, definite HTTPS overwrite, and unreachable-file control. |
| BR-3 | The flow scanner now handles object binding declarations, real object destructuring assignments, and computed keys whose flow value may be the static string `pathname`. Compiler symbols continue to preserve local shadowing. | Focused `file URL guard covers destructuring assignments and computed pathname aliases`: exit 1, 0/1; old helper returned `[]` instead of lines 2/4/6. | Included in final five-finding command: pass; HTTPS and shadowed-constructor controls remain clean. |
| BR-4 | Direct double-assertion detection unwraps any intervening parentheses and type-transparent `satisfies` expressions. It intentionally does not chase assertions through identifiers. | Focused `finds directly nested assertions through type-transparent wrappers only`: exit 1, 0/1; old helper returned no rules instead of three `double assertion` findings. | Included in final five-finding command: pass. Exact reviewer spelling now reports one direct finding; alias-separated and validated-unknown fixtures remain allowed by explicit policy. |
| BR-5 | npm environments now create and select explicit empty task-owned user/global npmrc files, task-owned temp/cache/home, an explicit registry, and `GIT_ALLOW_PROTOCOL=file`. Package/dependency packs run from isolated package-bearing cwd directories with empty project `.npmrc`; all pack targets/destinations and tarball install operands are absolute. The dependency helper refuses non-absolute coordinates or a missing Git protocol guard. | Focused `isolates npm user, global, and project configuration without a hostile request`: exit 1, 0/1; old environment selected `<root>/npmrc` and had no explicit global config/Git guard. Before that assertion, the controlled vulnerable environment proved the hostile scoped global entry wins. | Included in final five-finding command: pass. Standalone package file and independent offline probe also pass. |

Red logs: `red-br1.log`, `red-br2.log`, `red-br2-switch.log`, `red-br3.log`, `red-br4.log`, and `red-br5.log` under `reports/baseline-fix/`.

Final focused command:

```text
tsx --test --test-name-pattern='gives absolute first arguments|uses feasible values|covers destructuring assignments|finds directly nested assertions|isolates npm user' tests/package/type-safety.test.ts tests/package/package.test.ts
exit 0; 5 tests, 5 pass, 0 fail
```

## Offline npm/config isolation proof

The permanent config test performs only `npm config get` for the hostile controls; it does not run install/pack/fetch against the hostile URL and sends no hostile request.

It proves all of the following:

- In an intentionally vulnerable environment, a controlled global npmrc containing `@mixmark-io:registry=http://127.0.0.1:9/never-contact/` overrides a generic registry, reproducing the reviewed precedence risk without network access.
- The isolated environment reports the task-owned `config/user.npmrc` and `config/global.npmrc`, the owned generic registry, and does not report the hostile scoped registry.
- A hostile task-owned project `.npmrc` also wins only when npm is deliberately run from that hostile project, proving why pack/probe/install cwd isolation matters.
- Every real fixture npm environment hard-sets `GIT_ALLOW_PROTOCOL=file`, task-owned HOME/XDG/cache/temp coordinates, both uppercase and lowercase user/global/registry keys, and an empty project `.npmrc`.
- Main-package and installed-dependency `npm pack` calls use lifecycle scripts disabled, isolated cwd/config, absolute source directories, and absolute pack destinations. Tarball install operands are absolute.

The adapted independent `offline-install-probe.mts` exited 0 and recorded:

```text
npm 11.13.0
empty-cache negative exit 1 with ENOTCACHED
closure: @mixmark-io/domino@2.2.0, turndown@7.2.4
registry requests: /turndown, /@mixmark-io/domino, and both exact tarballs — all 200
registry closed before offline install: true
offline install exit 0
real Turndown/Domino load exit 0
markdown: Offline / closure loaded
scratch before finally cleanup: 24,736 KiB
```

Thus the success path retains the real direct/transitive closure, empty-cache negative, owned loopback preparation, closed-server offline install, exact versions, and real conversion/load. No dependency was waived, substituted, or dummied.

## Policy and analysis limits

### URL source policy

The guard is a bounded source-policy analysis, not a whole-program JavaScript proof:

- Its abstract domain is a finite bit set for static protocol/string classes, URL object classes, import-meta, recognized URL callables, and static property keys.
- It follows compiler-bound symbols through ordered declarations/assignments and conservative branch joins. Any feasible explicitly traced file branch is a finding.
- Loop reprocessing is capped at eight passes in addition to the finite lattice.
- Completely dynamic values remain unknown rather than being fabricated from a base.
- It does not execute calls or infer interprocedural/later-closure effects, arbitrary dynamic strings, proxies, or heap/object mutation. Function bodies are checked against the lexical state available where they are analyzed. `tsc` remains the preceding parse/type gate.
- There is no source-file allowlist.

### Type policy

The double-assertion rule is deliberately direct-syntax policy. Parentheses and `satisfies` are transparent and cannot hide a nested assertion. Identifier-separated assertions are not chased: banning every later assertion of an `unknown` alias would also ban valid boundaries that perform runtime validation. The docs and fixtures explicitly avoid claiming whole-program type soundness.

## Verification results

All test commands used:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/baseline-fix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/baseline-fix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/baseline-fix
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

npm-run commands additionally selected task-owned empty user/global npmrc files.

| Command | Exit | Result |
|---|---:|---|
| Final five-finding focused command above | 0 | 5/5 pass |
| `tsx --test tests/package/package.test.ts` | 0 | 28/28 pass, including full-tree URL scan, config isolation, packing, empty-cache negative, loopback seed, closed-server offline install/load |
| `npm run test:package` | 1 (known inherited red) | 56/57 pass; sole failure is the genuine unowned `src/core/anthropic-attribution.ts:1493` double assertion |
| `npm run test:type-safety` | 1 (known inherited red) | 3/4 pass; same sole attribution finding |
| `npm run typecheck` | 0 | PASS on the integrated launcher working tree |
| Corrected reviewer source probe | 0 | All corrected URL/type expectations asserted; exact JSON in `green-reviewer-source-probe.log` |
| Original reviewer source probe | 1 (expected stale expectation) | Stops because it expects the now-fixed `satisfies` case to return `[]`; preserved as `reviewer-source-probe-stale-expectations.log` |
| Adapted reviewer offline-install probe | 0 | Real closure and offline install/load proof above |
| `npm run docs:verify` | 1 (unowned concurrent result) | `docs/reference/runtime-contracts.md is stale` after launcher changed `src/core/pi-launch.ts` |
| `npm run test:docs` | 1 (unowned concurrent result) | 4/5 pass; sole failure is the same current-docs verification staleness |
| `git diff --check` on the seven owned paths | 0 | PASS |

The generated runtime-contract doc is outside this lane's ownership. It was not edited or regenerated, and the docs gates are **not** claimed as passing. The package docs integration contract itself passed 2/2 inside `test:package`. No semantic attestation was created.

## Source hashes

Full receipt: `reports/baseline-fix/source-hashes.txt` (SHA-256 `89efb27c5b159c59db3e0612232c5050933a0b64c073e297de22e65010ab95d8`).

| Path | Base SHA-256 (`c0ba665`) | Corrected SHA-256 |
|---|---|---|
| `tests/helpers/typescript-source-guards.ts` | `36e4ee3f099f5efc5f5e94b2ca39e3ad65408b0cf18476e3275940bc001df704` | `c9c90d11ce5fd21989b6d20f24e1944db0baf2f94b9aecb5015beb2c910695b9` |
| `tests/helpers/offline-npm-registry.ts` | `8ee508e3043439d19e59da55583848c30e912effea7bf7a97f5fa2a4a97fccdc` | `97ef95ed3cbd6f1d5839eb1a3866bb76c5606df07f1b2d71ee7adbf5d4fa66b2` |
| `tests/package/type-safety.test.ts` | `e2898011f8d15e757cf800168558726b4374d292b48f7579627fb42fea4777b0` | `13e48b97a5efe06a0fe8850a2231c8855572a0027d0ca731e77cfeeee91a0022` |
| `tests/package/package.test.ts` | `a147eb800b55657b7eba75b706bb16813644d3c8aed6cfd8b82111add508acc4` | `e18a398241364d6f404753ed9bc4dac0f7252605ecd5a73da1e2dc88321e140d` |
| `docs/operations/testing.md` | `a5b8a424d714ddc02e8f0161a903b9146312a89a6a9f05fc9f8c2b331f1bb77c` | `11dd6f7dca285c096f6763745273b9c7495ca11f10fe4c9fdfec29e4ced641fe` |
| `TESTING.md` | `1656604fdbb185e0722247f2e1007aab6d78bea9d840dbdd83aebc21ca80e8c6` | `85aeb814a0dfbecebfe898ac58bc9b7f401efd3e0c452e8a74d194d5de2583a7` |
| `TEST_PLAN.md` | `7273d4f8e11060bb4af745d0b6171d3c69c2490f80eb4c09ae0f6d4e7aec99be` | `4d7338c73d492952c77667d766438a2d5d24647f8a2cdb1ca7e101ad639a4db5` |

## Cleanup and handoff

- Task-owned `tmp/baseline-fix`, `home/baseline-fix`, and `agent/baseline-fix`: **0 KiB each** after cleanup.
- Owned test/npm/registry processes: **zero**.
- Owned-root open files: **zero**.
- Repository-root tarballs: **zero**.
- The active Pi harness is not a test child and was correctly left running.
- Maximum independently measured fixture scratch: 24,736 KiB, below the 400 MiB lane cap.
- All seven owned modifications show as worktree-only ` M`; nothing was staged.

Suggested coherent commit message:

```text
test(package): harden source guards and npm isolation
```

The working tree is ready for the parent's named-path commit and independent targeted re-review.
