# Final cold-load performance receipt

## Scope and provenance

Controlled comparison on the clean integrated commit `5d0ad28fc1132c9611ec42d7f602bfaebd097520` / tree `f1f4cd25acb4e0463fb22dc12b82e4194be762eb`:

- macOS arm64, Node `v24.16.0`, npm `11.13.0`, package Pi `0.84.0`;
- identical driver `f9255508...` and worker `ea8a0397...` for both states;
- one excluded warm-up plus 30 fresh processes per scenario;
- isolated HOME/TMP/agent roots, offline/version/telemetry suppression;
- scenario order reversed each round;
- source then compiled were sequential, not AB/BA;
- cold means an empty process/module cache, not a flushed filesystem cache.

Raw receipts: `source.json` (`62457cfe...`) and `compiled.json` (`7fe12d13...`). Every delegate/Fusion sample completed its deterministic fake-child assertions.

## Controlled final source versus published compiled runtime

Median milliseconds (p90 in parentheses):

| Scenario / metric | Source TypeScript | Compiled JS | Change |
|---|---:|---:|---:|
| no-extension package load | 0.939 (1.353) | 0.922 (1.009) | -1.9% |
| process-only package load | 71.570 (78.442) | 85.323 (100.339) | +19.2% |
| default-full package load | 124.871 (131.708) | 202.386 (243.058) | +62.1% |
| delegate-profile package load | 80.267 (85.751) | 88.290 (102.172) | +10.0% |
| first delegate launch | 149.875 (156.662) | 89.941 (94.612) | -40.0% |
| first delegate result | 19.855 (21.349) | 15.766 (17.378) | -20.6% |
| Fusion-profile package load | 115.831 (121.537) | 97.073 (109.057) | -16.2% |
| first Fusion launch | 195.678 (200.995) | 209.173 (227.369) | +6.9% |
| first Fusion result | 29.591 (32.062) | 19.714 (21.557) | -33.4% |
| selector-profile package load | 117.115 (130.126) | 94.802 (121.745) | -19.1% |
| first selector UI | 19.671 (21.632) | 111.614 (120.231) | +467.4% |
| direct delegate facade import | 509.492 (650.951) | 477.553 (523.760) | -6.3% |
| direct Fusion facade import | 586.418 (653.654) | 478.176 (497.703) | -18.5% |

The result is deliberately not summarized as “compiled is always faster.” On this Node/macOS/Pi-Jiti host, compiled bytes improve several cold imports and first-use paths but regress process/default loading and selector first-use relative to the same final source. The package nevertheless eliminates raw TypeScript from its declared published entrypoints and proves the compiled closure loads and executes correctly. Native Windows—the reported environment in #21—remains unavailable, so no Windows latency claim is made.

## Context against the frozen pre-edit baseline

The earlier accepted P1a v2 receipt at frozen base `fcf2af0` measured medians of 299.116 ms process-only, 326.749 ms default-full, 306.244 ms delegate-profile, 302.338 ms Fusion-profile, and 287.257 ms selector-profile. The final published compiled medians above are lower by roughly 71%, 38%, 71%, 68%, and 67% respectively.

That comparison is contextual rather than a controlled causal claim: the final driver added the explicit runtime selector and the runs occurred later. The source-vs-compiled table above is the controlled same-driver comparison. No timing threshold is enforced in CI.

## Distribution and platform boundary

- Published `package.json.pi.extensions` points to compiled JavaScript.
- The tarball contains the complete 120-file compiled closure and source maps; packed compiled startup, damaged-deferred-module failure, Node 22/24 SDK, smoke, PTY, and compatibility-shaped package paths are tested.
- Source TypeScript remains shipped as authoritative source/public API compatibility, not as the declared normal Pi entrypoint.
- A local Bun 1.3.4 attempt failed in the installed Pi 0.86 host before extension loading (`webidl.util.markAsUncloneable is not a function` in Pi's bundled Undici). This is host/runtime incompatibility, not a package pass. No vendor compiled-Bun claim is made.
- No native Windows, filesystem-cache-cold, pnpm, or live provider evidence is claimed.
