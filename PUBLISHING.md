# Publishing pi-background-tasks

Release checklist for npm publishing and standalone git publishing.

The release version is always read from `package.json`:

```bash
# From the pi-background-tasks package root:
VERSION=$(node -p "require('./package.json').version")
printf 'pi-background-tasks@%s\n' "$VERSION"
```

Observed standalone git tags currently stop at `v0.6.0`; do **not** advertise a `v$VERSION` git install target until that tag exists in the standalone package repository.

## Preconditions

- npm account with publish rights for `pi-background-tasks`.
- Standalone GitHub repository: `github.com/ismailsaleekh/pi-background-tasks`.
- Clean worktree and final release commit in the standalone package repository.
- Frontier model evidence, if any, uses Pi subscription/OAuth channels only; never metered APIs.
- No automated publish, push, or tag from repair runs unless the operator explicitly requests it.

## Ordinary release checks

```bash
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
npm run docs:verify
npm run payload:check
# On a tag ref only: GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v$VERSION npm run release:check-version
npm run pack:dry-run
# With pnpm 11.18.0 on PATH:
npm run test:pnpm-pack
npm run test:compat
npm view pi-background-tasks name version --json
```

`npm run test:full` is the full interactive gate (default gate plus PTY and agent-loop). Run it when certifying full TUI/agent-loop behavior, not for docs-only maintenance.

## Payload verification

Use `npm pack --dry-run --json --ignore-scripts` output as the payload source of truth for payload inspection. Verify that `extensions/`, `src/`, `docs/`, `README.md`, `TESTING.md`, `TEST_PLAN.md`, `PUBLISHING.md`, `BACKGROUND-TASKS-INSTRUCTIONS.md`, root `logo.png`, and `LICENSE` match current `package.json.files`, and that tests/scripts/local `.pi` artifacts/node_modules/nested tarballs are excluded. Pi AI and TypeBox must remain host-provided peers rather than private runtime copies.

## Publish to npm

Only after operator approval:

```bash
npm login
npm publish --access public
```

Post-publish smoke with isolated Pi state:

```bash
PI_CODING_AGENT_DIR=$(mktemp -d) pi -e npm:pi-background-tasks@$VERSION --offline --no-tools --no-session -p "/jobs"
pi install npm:pi-background-tasks@$VERSION
```

## Standalone git tag certification

Pi git package installs treat the repository root as the package root. Do not point Pi at the `ai-pipeline` monorepo root for this package.

Before any git install instructions are published, verify in the standalone repo that tag `v$VERSION` exists and points at the release commit. `npm run release:check-version` requires an explicit tag ref (`GITHUB_REF_TYPE=tag`, `GITHUB_REF_NAME=v$VERSION`) and never publishes. If the tag does not exist, the git channel is not certified for this release.

Git install smoke only after the tag exists:

```bash
PI_CODING_AGENT_DIR=$(mktemp -d) pi -e git:github.com/ismailsaleekh/pi-background-tasks@v$VERSION --offline --no-tools --no-session -p "/jobs"
pi install git:github.com/ismailsaleekh/pi-background-tasks@v$VERSION
```

## pi.dev/packages

The package includes the `pi-package` keyword and a `pi.extensions` manifest. After npm publish, it should be discoverable by pi.dev package indexing. If it does not appear automatically, refresh according to the package-gallery process.
