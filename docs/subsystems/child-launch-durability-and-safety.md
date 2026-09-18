---
doc_id: subsystems/child-launch-durability-and-safety
audience: maintainer
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [src/core/durable-fs.ts, src/core/pi-launch.ts]
---
# Child launch, durability, and safety

Primary sources: `src/core/pi-launch.ts` and `src/core/durable-fs.ts`.

## Pi launch resolution

On non-Windows platforms, `resolvePiLaunch()` returns `{ executable: 'pi', argvPrefix: [], kind: 'path' }`.

On Windows, the package does not trust shell PATH shims. It locates `@earendil-works/pi-coding-agent/package.json` by module resolution from this package's install location first. When that fails, as it does when Pi is installed globally and this package sits in Pi's extension prefix, it walks up from the running host script (`process.argv[1]`) to the nearest `package.json` that carries a `name`, and accepts it only when that name is `@earendil-works/pi-coding-agent`. Either way, it then reads `bin.pi`, realpaths the package root and bin target, verifies the target stays inside the package root, and accepts only a regular file with one of these forms:

- `.js`, `.cjs`, `.mjs`: launch with `process.execPath` and the target as `argvPrefix[0]`;
- `.exe`, `.com`: launch the target directly.

Resolution failures throw `PiLaunchResolutionError` with code `pi_executable_resolution_failed`; no substitute route or shell fallback is selected.

## Windows argv and command-line length

`assertWindowsCommandLineWithinLimit()` renders the exact Windows command line with Windows quoting rules, measures UTF-16 length plus the terminating NUL, and throws `PiCommandLineLimitError` (`pi_command_line_too_long`) if it exceeds 32,767 characters. The check is used before child launches that construct `pi` argv.

Delegate seed bytes are delivered over stdin, not argv, so large seeds do not rely on command-line quoting or shell length limits.

## Durable write invariant

`durable-fs.ts` provides two public operations:

- `writeFileDurable(path, data)`: open the target once with `w`, write, `sync()`, close.
- `replaceFileDurable(path, data)`: create a task-owned temp file with exclusive `wx` at `0o600`, write, `sync()`, close, rename over the target, then directory-sync on non-Windows.

Invariant: a pathname is never reopened merely to fsync it. Sync failures are fatal and surfaced as `DurableFileError`; cleanup failures are retained in the error object instead of hiding the primary failure.

Temp ownership matters: if exclusive temp creation collides, the caller does not delete the other writer's file. A successful rename is the commit point; if a post-rename directory sync fails, the error marks `renameCompleted: true` because the replacement may already be visible.

## POSIX directory sync limitation

After atomic replace, POSIX-like platforms open and sync the parent directory to durably record the rename. Windows skips directory sync because Node/Windows directory fsync is not portable in the same way. This is an explicit platform limitation, not a silent success claim; file contents are still written and synced before rename.

## Process trust boundaries

- Background shell tasks run the operator-provided shell command in the project cwd and are not sandboxed.
- Delegate children are direct `pi` spawns, not shell commands. They use a task-owned session id and session dir, stripped parent session environment, disabled discovery, and an explicit child guard extension; Anthropic delegates first load the package attribution extension.
- Fusion children are direct `pi --mode text` spawns with private metadata/tool-call audit extensions and workflow-specific tool policy; Anthropic children first load the package attribution extension.
- Attested Pi tasks are direct `pi --mode json` spawns and produce evidence sidecars after successful parsing and durability; Anthropic tasks receive the package attribution extension explicitly.

Never blur parent and child authority: parent tools can start/inspect/kill tasks, but child tools must stay within their explicit argv tool set.

## Terminal integrity

Task terminal status is not published until output streams are ended and observed finished/closed and terminal metadata is written. Ordinary task `.output` streams are not explicitly fsynced; attested event/stderr buffers and atomic metadata/artifact paths use the durable helpers described above. If stream close or terminal metadata fails, the task is marked failed; terminal truth is not guessed from the process exit alone.
