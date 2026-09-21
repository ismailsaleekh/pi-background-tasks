# B0 bounded URL base/key follow-up design

## Route, base, and boundary

- Effective injected route observed before substantive work: `openai-codex/gpt-5.6-sol`, reasoning `max`.
- Reviewed helper entry SHA-256: `5fee44fc1f45e90929d4c02e4485742a1d64c7daa5a23a0a08b83114f0c3812e`; named URL target: `f8d74b9c308dabd6a1c7bc8e3a9bf1472feaadf0`.
- Package writes are limited to the URL-policy portion of `tests/helpers/typescript-source-guards.ts`, URL cases in `tests/package/package.test.ts`, and URL-policy prose in `docs/operations/testing.md`, `TESTING.md`, and `TEST_PLAN.md`.
- The accepted completion algebra, WHATWG absolute classification, static `for...of` handling, lexical shadowing model, type-safety behavior, and isolated npm proof remain frozen. No production, generated-doc, manifest, maintenance-state, type-safety test, or offline-npm helper change is planned.
- Mechanical checks use task-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/url-base-key-fix`, with offline/telemetry/version-check controls and `GIT_ALLOW_PROTOCOL=file`.

## Red reproduction

Before any package edit, run the two independent reviewer probes unchanged. Their current assertions pin the defects: module-relative unknown/template inputs are omitted despite an observed file base, and only dot-form intrinsic `globalThis.URL` is reported while equivalent static computed forms are omitted. Strict companion fixtures establish that these are valid TypeScript rather than parser/type-error artifacts.

## Minimal finite-lattice correction

No new interpreter or control-flow feature is needed. The correction is confined to two value-lattice joins.

### 1. Unknown or definitely relative first input with an explicit base

A proven absolute first value remains authoritative: file and non-file URL objects/strings are copied directly and never consult the base.

For a generic unknown first value, retain both facts that the bounded analysis can justify:

1. it remains `URL_UNKNOWN` because it may be an absolute or otherwise unclassified input; and
2. when a base expression is explicitly present, it may be relative, so join the base's already-computed file/non-file/unknown URL alternatives.

Thus an observed `import.meta.url`, static file literal/template, or proven file URL object contributes `URL_FILE`; an HTTPS base contributes no file provenance; and mixed known-HTTPS/unknown first alternatives retain both the known non-file branch and the possible file branch. This is a finite bitwise join, not a fabricated definite protocol and not arbitrary string/interprocedural inference.

For template expressions, preserve the existing WHATWG absolute-head test first. If no absolute protocol is established, classify only heads beginning exactly `./` or `../` as definitely relative; all other dynamic heads remain unknown. This restores the bounded safe-relative template class without reviving the former "any nonempty head is relative" approximation.

### 2. Uppercase constructor key distinct from lowercase `import.meta.url`

Keep separate lattice bits for the exact static keys:

- lowercase `url`, used only for computed `import.meta['url']`; and
- uppercase `URL`, used only for computed intrinsic constructor lookup on compiler-proven `globalThis` or a `node:url` namespace.

String literals and flow-traced const aliases can carry the uppercase key bit. Existing compiler-symbol checks on the object expression remain unchanged, so parameter/local fake `globalThis` values stay clean. Dot, literal-bracket, and const-key bracket forms then agree without conflating `URL` with `url`.

## Permanent paired controls

Add focused package cases covering:

- unknown inline, declaration, and assignment uses with file versus HTTPS bases;
- `./` and `../` template heads with file versus HTTPS bases;
- a known-HTTPS/unknown first-value join against file versus HTTPS bases;
- absolute HTTPS and file first values as literals, templates, and URL objects, proving base independence;
- dot, uppercase literal-bracket, and uppercase const-key intrinsic constructors;
- lowercase `import.meta['url']` as a file base and uppercase/lowercase non-conflation controls;
- parameter/local compiler-symbol-shadowed `globalThis` bracket forms.

The accepted 16-case completion/root-class probe is rerun unchanged rather than duplicated or redesigned.

## Verification plan

After implementation, run corrected-expectation copies of both exact reviewer probes, strict-compile both original reviewer fixtures, run all prior eight permanent URL fixtures plus the current full-tree URL scan, rerun the unchanged 16-case root-class proof and prior systematic URL fixture, and run project typecheck. Preserve accepted type/npm files by SHA-256 and do not rerun the npm proof. Finish with an exact five-path commit only after checking concurrent status and path ownership.
