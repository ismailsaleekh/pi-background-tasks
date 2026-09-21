# Manually invalidated full-gate attempt

Task `b4b7a0a97` began on source `4cb2a90c76df735ab23402a1f68b5c5e33daecdf`. The source remained unchanged throughout the recorded run.

The integrator mistakenly read commit order and killed the task, believing `7bca31b` had landed afterward; in fact `7bca31b` was already the parent of `4cb2a90`. Therefore this run is unusable solely because it was manually interrupted—not because it was mixed-source. It is retained for transparency and is **not** a pass/fail qualification receipt. A clean source-frozen rerun is required.
