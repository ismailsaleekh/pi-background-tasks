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

This authored section defines the boundary: documentation facts are extracted from package metadata and TypeScript ASTs, then generated into docs and the manifest. Unsupported syntax fails the gate rather than falling back to regex or stale hand-maintained inventories. Public registrations must remain unconditional top-level direct calls or use the one validated local tool-wrapper shape; host/method aliases, computed access, nested or conditional registration, wrapper chaining/passing, constructor helpers, ambiguous public metadata, destructured Pi parameters, and repeated imported registrars are rejected.

<!-- pi-docs:begin name="docs-freshness-gate" generator="scripts/docs/generate.mjs" -->
- Canonical package version: `2.4.1`
- Governed markdown docs: 42
- Public surfaces extracted: 31
- Governed production sources: 50
- Tool contracts extracted: 11
- Schema IDs extracted: 46
- Environment variable references extracted: 49
- Behavioral attestation receipts not passing: 8
- Receipt store: `docs/attestations.json`

`npm run docs:verify` is read-only: it renders generated files twice in memory and compares them with committed bytes. `npm run docs:generate` is the only docs writer.
<!-- pi-docs:end name="docs-freshness-gate" -->
