# Final unavailable-platform receipt

Host: macOS arm64. This receipt records blockers; it does not convert them into passes.

- `npm run test:windows` exited `1` as designed off Windows. The suite reports all 15 native cases failed/unavailable rather than skipping. Mocked structured argv/taskkill coverage passed in default unit/SDK gates, but native process/pipe/handle continuity is `BLOCKED_ENVIRONMENT`.
- `pnpm` is absent, so `npm run test:pnpm-pack` is `BLOCKED_ENVIRONMENT`. The default npm 10/11 lifecycle-free tarball install and `blockExoticSubdeps` source policy remain covered; they are not renamed as a pnpm pass.
- Bun `1.3.4` exists. Running installed Pi 0.86 under Bun with the compiled package entrypoints failed before extension loading in Pi's bundled Undici: `webidl.util.markAsUncloneable is not a function`. This is a loud host/runtime failure and provides no vendor compiled-Bun certification.
- Exact Pi 0.81.1–0.84.0 reinstall compatibility was not rerun because the release script is offline-only and no isolated task-owned cache contains all package closures. User npm cache and network were not used. Existing supported-line hook evidence and current package Pi 0.84/current host 0.86 execution remain recorded, but are not a substitute for the exact reinstall gate.

Evidence files in this directory preserve the command output and exit status.
