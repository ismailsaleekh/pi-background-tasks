---
doc_id: subsystems/docs-freshness-gate
audience: maintainer
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: []
covers_sources: []
---
# Docs freshness gate

This authored section defines the boundary: documentation facts are extracted from package metadata and TypeScript ASTs, then generated into docs and the manifest. Unsupported syntax fails the gate rather than falling back to regex or stale hand-maintained inventories. Public registrations must remain unconditional top-level direct calls, use the one validated local tool-wrapper shape, use the closed finite-variant grammar below, or occur in a direct inline `session_start` activation callback whose containing statement already has validated availability. Host/method aliases, computed access, nested/dynamic conditions, loops, wrapper chaining/passing, constructor helpers, ambiguous public metadata, destructured Pi parameters, and repeated imported registrars are rejected.

The finite grammar recognizes only a top-level immutable binding returned by the actual unshadowed import of `parseBackgroundTasksConfig()` and direct top-level registration/registrar calls guarded by a validated feature atom, the exact delegate-or-Fusion derived-result disjunction, or one of the two registrable dock literals. The parser itself must have the reviewed structural shape: exactly one final direct return, a frozen returned config, and the exact frozen feature record; nested return paths are structurally rejected. Config authority remains lexical through supported activation callbacks and independently validated imported registrars. Every captured or local config-binding use is checked; aliases, destructuring, writes, updates, mutation calls, argument/closure escapes, shadowed parser names, and unsupported conditions fail. `off` cannot guard a registration. Runtime feature/shortcut/default enums are compared with the docs engine's closed enum, so drift fails generation.

Every registration-owning function, imported registrar, and supported activation callback is checked as a whole, including parameter declarations and initializers. Destructured registration bindings, computed or property registration methods on unknown hosts, default-parameter host aliases, initializer calls/throws/control flow, and unmodeled body returns or throws are rejected. The sole early-return form is the structurally validated synchronous Anthropic duplicate-owner guard: the exact production claim channel, exact schema field/value and closed probe shape, one local empty acknowledgement array, one adjacent direct claim emit with the exact acknowledgement append, and the positive-length bare return. A local pre-probe claim listener is not accepted. Returns inside command/tool/event handlers that own no registrations remain unrelated and legal. Extracted surfaces carry a normalized availability expression and source-derived default status through the manifest, INDEX/read gate, README facts, and generated surface contracts.

<!-- pi-docs:begin name="docs-freshness-gate" generator="scripts/docs/generate.mjs" -->
- Canonical package version: `2.6.7`
- Governed markdown docs: 42
- Public surfaces extracted: 32
- Public surfaces available by default: 31
- Finite feature values: `process`, `delegate`, `fusion`, `attested`, `attribution`
- Finite dock shortcut values: `shift+down`, `ctrl+alt+b`, `off`
- Governed production sources: 60
- Tool contracts extracted: 11
- Schema IDs extracted: 48
- Environment variable references extracted: 54
- Behavioral attestation receipts not passing: 9
- Receipt store: `docs/attestations.json`

`npm run docs:verify` is read-only: it renders generated files twice in memory and compares them with committed bytes. `npm run docs:generate` is the only docs writer.
<!-- pi-docs:end name="docs-freshness-gate" -->
