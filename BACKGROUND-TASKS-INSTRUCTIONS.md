# pi-background-tasks — Mandatory Agent Gateway

**Read this before you read code, edit docs, edit code, or run anything in this package.**
This gateway is for AI agents maintaining `pi-background-tasks`. It is package-local, deterministic, and intentionally stricter than generic repo instructions.

**Logo reference:** use the package-local docs logo when present: [`docs/assets/logo.svg`](docs/assets/logo.svg). Do not invent remote logos; asset files remain asset-owner territory and must be verified in the docs/assets payload check.

---

## Required read-before-edit order

1. [`docs/INDEX.md`](docs/INDEX.md) — generated package navigation index. If it is absent, stale, or not generated yet, stop relying on memory and report that the docs-engine lane must create/update it.
2. [`docs/read-before-edit.md`](docs/read-before-edit.md) — generated source-path to owning-doc read gate. If absent or stale, run/ask for the docs-engine gate before editing production sources.
3. The owning authored doc for the surface you are touching.

Current authored ownership map:

| Surface/source area | Owning doc |
|---|---|
| EventBus API; `src/core/extension-api.ts` | `docs/api/eventbus-v1.md` |
| Shared context projection and estimator; `src/core/context/**` | `docs/concepts/context-projection-and-budgeting.md` |
| Pi child launch resolution and durable file primitives; `src/core/pi-launch.ts`, `src/core/durable-fs.ts` | `docs/subsystems/child-launch-durability-and-safety.md` |
| Paths, artifacts, config, env, defaults, schema registry | `docs/reference/runtime-contracts.md` |
| Symptom triage | `docs/operations/troubleshooting.md` |
| QA/test operations | `docs/operations/testing.md`, then `TESTING.md`, then `TEST_PLAN.md` |
| Release/package maintenance | `docs/operations/releasing.md`, then `PUBLISHING.md` |

---

## Hard rules

- **Code is authority for runtime facts; docs describe code.** Do not change code to satisfy prose. When code and docs disagree, update docs or file a code-owner blocker.
- **Generated regions are not hand-edited.** Regions named `<!-- pi-docs:begin ... -->` / `<!-- pi-docs:end ... -->`, `docs/INDEX.md`, `docs/read-before-edit.md`, README generated facts, and `docs/manifest.json` belong to the docs engine.
- **No silent truncation, fallback, or route substitution.** Oversized data must be persisted with hashes or rejected loudly. Unavailable model routes, missing context windows, stale config, malformed frames, missing artifacts, and unknown schemas are hard errors.
- **Parent and child tools are distinct.** Parent tools include `bg_run`, `bg_delegate`, `bg_result`, `bg_status`, `bg_logs`, `bg_kill`, `bg_run_pi_attested`, and the public Fusion tools. Delegate children are inspect-only (`read`, `grep`, `find`, `ls`, `delegate_read_artifact`). Fusion children receive only the workflow-specific candidate tools; evaluator/merger are no-tools.
- **Frontier routing is subscription-only.** GPT/Codex and Claude-class work must use Pi subscription/OAuth channels. Never route them through metered OpenAI, Anthropic API, OpenRouter, Azure, or other paid API channels.
- **Durability and integrity are contract surfaces.** Terminal task truth is published only after output/metadata durability. Delegate/Fusion artifacts and attested Pi sidecars carry hashes and schema versions; do not replace these with best-effort writes.
- **No self-certification.** If a doc freshness or attestation mechanism exists, do not stamp the same change as verified without the required independent check. If the mechanism is absent, say so plainly.
- **Do not use Fusion tools or commands for package maintenance.** Read files and run focused local checks only.

---

## Runtime roots

- Task runtime: `.pi/tasks/<session-id>-<pid>/` under the active project cwd.
- Fusion runtime: `.pi/fusion/<session-id>-<pid>/<run-id>/` under the active project cwd.
- Delegate artifacts: task-owned artifact directories referenced from task metadata/result packages.
- Fusion model config: `fusion-models.json` under Pi's agent directory (`getAgentDir()`), not the project `.pi/tasks` tree.
- Published Pi entrypoints, in load order: `dist/extensions/anthropic-attribution.js`, then `dist/extensions/background-tasks.js`, via `package.json.pi.extensions`. Authoritative TypeScript remains under `extensions/` and `src/`; `npm run build:runtime` produces the shipped JavaScript closure.

---

## Docs generate/verify/attestation workflow

Current `package.json` exposes the docs-engine lane:

```bash
npm run docs:generate
npm run docs:verify
npm run docs:verify:attestations
npm run docs:attest/record -- <doc_id> --reviewer <identity-after-semantic-review> --verdict PASS --notes <review-notes>
```

`npm run docs:verify` treats semantic receipt freshness as advisory while preserving all deterministic docs, ownership, link, and payload checks. Use the optional `npm run docs:verify:attestations` gate when fresh independent receipts are required. `npm run docs:attest` is an alias for the recorder and still requires a reviewed doc id, reviewer, verdict, and notes; do not self-award PASS.
