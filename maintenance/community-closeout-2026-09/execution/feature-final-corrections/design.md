# C1a final package-owned corrections — design

## Authority, route, and boundary

- Starting worktree: `/private/tmp/pi-bg-closeout-iNoltL/features` at `c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541`.
- Injected route verified before edits: `openai-codex/gpt-5.6-sol`, reasoning `max`.
- Final authority inputs read in full: runtime review 2, docs review 2, every retained probe/log, and the prior correction design/report. The implementation and host behavior, not earlier closure prose, are authoritative.
- Work remains package-only. No dependency install/copy, network, GitHub, provider call, Fusion/agent launch, new checkout, parent/main/other-worktree write, private Pi state access, peer-range change, or attestation stamp.
- Frozen behavior includes capability profiles, shortcuts, shared `bg_result`, child attribution paths, external tool-collision handling, provider legacy/native/later-owner/failure behavior, F1 prose, attribution core, and accepted composed-adapter classification.
- Forbidden production/shared files remain untouched: R1/common/registry, attested/durable/launcher, Fusion engines, shell/P1/persistence, package/lock, `TESTING.md`, `TEST_PLAN.md`, and maintenance state.

## Provider absence restoration

`extensions/anthropic-attribution.ts` keeps the existing public snapshot/token transaction. Cleanup first proves that the exact package legacy config token is still current and that no native replacement exists. It then restores by prior source kind:

1. prior native: register the exact native object;
2. prior legacy: use the captured effective provider to remove only the still-current package legacy layer, then reapply the captured legacy config, preserving registered stream/config behavior and future incremental merges;
3. no prior dynamic registration: call public `unregisterProvider("anthropic")` only after the exact token/later-owner checks, restoring dynamic-registration absence and the built-in effective object.

Post-restore verification will require no legacy/native registration and no registered Anthropic ID in the absence branch, plus exact captured effective-object restoration. There is no blind delete, private map/prototype access, or claim that a transient recomposed legacy adapter retains wrapper identity.

Permanent SDK coverage will add exact no-prior absence and retain preexisting legacy/native, later legacy/native, failed installation, duplicate owner, routing/auth/config/stream/future merge, 16 profiles, external collisions, producer/result paths, and forced-child controls.

## Finite docs grammar

The extractor remains a deliberately finite structural recognizer, not a JavaScript interpreter.

- Registration-owner parameters are part of activation control flow. Unsupported initializers, throws/returns, destructured registration-looking bindings, and unknown computed/property registration hosts fail closed.
- Config authority is lexical and transitive. A validated config-binding environment is inherited into supported direct `session_start` callbacks and imported registrars. Every captured/local authority use must remain one of the recognized availability conditions or the exact supported footer-helper use; writes, updates, aliases, mutation calls, destructuring, and argument/closure escapes are rejected.
- Parser authorization resolves the actual lexical call binding to the unshadowed named import. Parameters or local declarations that shadow `parseBackgroundTasksConfig` cannot authorize a config binding.
- Parser validation checks the complete reachable structure. Nested return/control-flow paths are structurally rejected rather than ignored; the production parser's sole direct immutable return and exact frozen feature record remain accepted.
- The sole registration-owner early-return waiver is bound to the production claim protocol: exact exported claim channel value, exact schema property/value, exact closed probe shape with `acknowledge`, exact acknowledgement callback append, adjacent emit, and positive-length bare return. Arbitrary channels, local fake listeners, omitted/wrong schema, or extra probe fields do not qualify.
- Returns inside unrelated command/tool/event handlers remain legal. Current production extraction must continue to pass without file/name waivers.

The seven docs-review fixtures will be copied as separate permanent controls using the real parser except for the independently mutated-parser fixture. Each must reject for its own structural reason: parameter-initializer control flow, captured config mutation, fake claim channel/schema, unknown computed host, destructured unknown host, shadowed parser import, and hidden parser return. Existing original decisive controls remain distinct and green as rejections.

## Truthful initialized-host contract

No package-only fallback will pretend that bare `createAgentSession()`, `{}` binding, or mode-only binding initializes post-bind attribution resources. Authored getting-started, configuration, attribution, and EventBus API docs will state prominently:

- generated availability means availability after the documented initialized-host contract, not pre-bind availability;
- normal Pi TUI, RPC, print, and JSON modes provide counted bindings and are the supported/proven path;
- an SDK embedder must call `bindExtensions()` with at least one binding counted by Pi (for example `onError`, UI/command actions, or shutdown handling), and after each `reload()` must ensure a counted binding causes `session_start` or explicitly bind again;
- bare `createAgentSession()`, empty binding, and mode-only reload do not provide that guarantee in the current public host API.

Tests will characterize standard/count-binding success versus bare/empty/mode-only blocked behavior without inventing a callback or marking blocked paths passing. #20 remains an explicit `BLOCKED_SCOPE` / SDK compatibility blocker pending a guaranteed post-core-bind/reload callback or owner-token provider-registration API; these package fixes do not reduce scope or claim closure.

## Red/green and generated output

Before implementation, run the exact public-state absence probe and seven-fixture docs probe against `c4eb78c` and retain their expected failing evidence. Then add permanent tests and implement the fixes. Node 22.19 is used for docs/config gates and Node 24 only where required for SDK characterization. Every command uses the owned TMP/HOME/agent roots and `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

Green gates include docs selftest, `test:docs`, current production extraction, 48 manifest profiles, payload closure, feature SDK (15+ cases), standard/bare SDK lifecycle characterization, provider public state, external collisions, producer paths, forced child/path controls, typecheck/type-safety, and `docs:generate` followed by `docs:verify`. Generated docs are written only by `npm run docs:generate`; no attestation writer runs.

A local follow-up commit will contain only owned implementation/docs/tests/generated files. The final absolute report will list commits and paths, red/green commands and counts, exact provider states, all seven grammar controls, initialized-host matrix, the unchanged host blocker/no-scope-reduction statement, generated files, accepted hashes, route, and cleanup. Work stops for independent review; P1 is not started.
