# Early integrated minimum-Node core check

- Task: `bd69e29a0` (ordinary mechanical command, not an agent).
- Exit: **0**.
- Source before and after: `4219d9a9d2ec61eee3334cbb4816fc5c394e559d`.
- Runtime: **Node 22.19.0**, the package's declared minimum.
- `tsc --noEmit`: PASS.
- Nine focused files: **92 tests passed, 0 failed, 0 skipped**.
- Included: semantic type-safety, Fusion role docs, four attribution runtime units, attribution fixture portability, actual attribution SDK reload/resume, and Pi launch resolution.
- `env -i` supplied only explicit PATH, task-owned HOME/USERPROFILE/TMPDIR/agent path, `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.
- Exact code command after changing to the package:

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test --test-concurrency=1 \
  tests/package/type-safety.test.ts \
  tests/package/fusion-model-roles-docs.test.ts \
  tests/unit/anthropic-attribution.test.ts \
  tests/unit/anthropic-attribution-lineage.test.ts \
  tests/unit/anthropic-attribution-config.test.ts \
  tests/unit/anthropic-attribution-forwarding.test.ts \
  tests/unit/anthropic-attribution-fixture-portability.test.ts \
  tests/sdk/anthropic-attribution-lifecycle.test.ts \
  tests/unit/pi-launch.test.ts
```

The full TAP output is `core-checks.log`, hash-covered by `SHA256SUMS`. After the terminal notification and evidence capture, the exact `integrated-node22` tmp/home/agent roots were removed.

This is an early integrated core subset, **not** full/default/PTY/agent-loop/package/compatibility qualification. R1 and feature work were not yet integrated. It does not resolve the separately reproduced URL-policy misses or claim native Windows/vendor-binary coverage.
