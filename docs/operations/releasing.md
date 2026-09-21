---
doc_id: operations/releasing
audience: maintainer
mode: authored
review_policy: contract
stability: evolving
covers_surfaces: []
covers_sources: []
---
# Releasing operations

Package maintenance entrypoint: `PUBLISHING.md`. Source version is always `package.json`; never hard-code a release version in commands.

```bash
VERSION=$(node -p "require('./package.json').version")
printf 'pi-background-tasks@%s\n' "$VERSION"
```

Current observed standalone git tags stop at `v0.6.0`. Do not advertise or certify a `v1.x` git install tag until that tag exists in the standalone package repository.

## Ordinary release checks

Run from the `pi-background-tasks` package root in an isolated environment. These are release-candidate checks, not tag certification:

```bash
npm run build:runtime
npm run typecheck
npm run test:type-safety
npm run test:unit
npm run test:sdk
npm run test:rpc
npm run test:component
npm run test:package
npm run test:hook-contract
npm run smoke
npm run smoke:large-context
npm run pack:dry-run
# With pnpm 11.18.0 on PATH:
npm run test:pnpm-pack
npm run docs:verify
npm run payload:check
# On a tag ref only: GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v$VERSION npm run release:check-version
npm run test:compat
npm view pi-background-tasks name version --json
```

`npm run test:full` additionally runs PTY and scripted-provider agent-loop gates. Treat it as a full interactive gate; do not run it for routine docs edits.

Live evidence (`npx tsx scripts/delegate-live-run.ts`) is release-time and performs real subscription-OAuth inference. It must never use API-key/metered frontier channels.

## Payload verification

Use `npm pack --dry-run --json` output as the payload source of truth. Verify at minimum:

- `dist/extensions/anthropic-attribution.js` and `dist/extensions/background-tasks.js` are the ordered Pi entrypoints;
- the complete compiled `dist/` runtime closure, source maps, copied hook-contract evidence, and minimal `dist/package.json` are included;
- authoritative `extensions/` and runtime `src/` sources remain included for public source/API compatibility;
- `docs/`, `README.md`, `TESTING.md`, `TEST_PLAN.md`, `PUBLISHING.md`, `BACKGROUND-TASKS-INSTRUCTIONS.md`, `THIRD_PARTY_NOTICES.md`, root `logo.png`, and `LICENSE` are included per current `package.json.files`;
- tests, scripts, node_modules, local `.pi/` artifacts, generated evidence not meant for runtime, and nested tarballs are excluded;
- TypeBox and `@earendil-works/pi-ai` remain Pi-provided peers and no private/nested runtime copies are bundled;
- production dependencies use registry versions only; no exotic URL/git/file subdependency is shipped;
- docs/assets/gateway/logo inclusion matches `package.json.files` exactly.

## Tag certification vs npm publishing

Separate these activities:

1. **npm release candidate:** version comes from `package.json`; run ordinary release checks; inspect pack payload; publish only on operator approval.
2. **git tag certification:** verify the standalone repo is at the exact release commit, clean, and already has or is about to receive tag `v$VERSION`. `npm run release:check-version` requires an explicit tag ref (`GITHUB_REF_TYPE=tag`, `GITHUB_REF_NAME=v$VERSION`) and never publishes. Tags currently observed stop at `v0.6.0`, so `v$VERSION` is not certified merely because npm has that version.
3. **post-publish install smoke:** install by `npm:pi-background-tasks@$VERSION` in an isolated Pi agent dir. Use git install smoke only after the corresponding standalone tag exists.

No auto-publish. No automated push/tag from repair runs unless the operator explicitly asks.
