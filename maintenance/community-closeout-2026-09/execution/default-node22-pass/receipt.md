# Integrated pre-feature default-gate receipt

Task `b1202e157` completed with exit **0** on source `4cb2a90c76df735ab23402a1f68b5c5e33daecdf`, verified identical before and after.

Environment: Node **22.19.0**, npm **10.9.3**, `env -i`, task-owned HOME/USERPROFILE/TMPDIR/agent/cache/user+global npm configs, invalid external registry, `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

`npm test` results:

- typecheck: PASS
- type-safety: **4/4**, 0 skipped
- unit: **549/549**, 0 skipped
- SDK: **48/48**, 0 skipped
- RPC: **10/10**, 0 skipped
- component: **11/11**, 0 skipped
- package: **68/68**, 0 skipped
- hook contract: **7/7**, 0 skipped

Full TAP output is hash-covered by `SHA256SUMS`. Exact test roots/config/cache were removed after terminal evidence capture.

This is the integrated reviewed A/R1/B0/L1/F1 baseline. C1a/C1b/P1/D1 were not yet integrated, so final candidate qualification must be rerun afterward.
