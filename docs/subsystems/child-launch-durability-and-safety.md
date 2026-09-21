---
doc_id: subsystems/child-launch-durability-and-safety
audience: maintainer
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [src/core/canonical-json.ts, src/core/durable-fs.ts, src/core/pi-launch.ts, src/core/task-durable.ts]
---
# Child launch, durability, and safety

Primary sources: `src/core/pi-launch.ts`, `src/core/durable-fs.ts`, `src/core/task-durable.ts`, and `src/core/canonical-json.ts`.

## Pi launch resolution

`resolvePiLaunch()` returns a verified executable plus an argv prefix; callers pass both directly to `spawn` without a shell.

On POSIX platforms, resolution searches `PATH` in order. A candidate named `pi` must canonicalize to a regular file and pass execute-access validation. Invalid candidates are skipped so a later executable can win. The returned `executable` is the canonical absolute candidate that passed those checks, not the bare name `pi`; changing the child cwd or spawn environment/PATH therefore cannot reselect a different file.

If no PATH candidate qualifies, resolution canonicalizes the running host script and walks upward through package manifests. It skips only valid nameless sub-manifests, stops at the nearest named package boundary, and accepts the host only when:

- the package name is exactly `@earendil-works/pi-coding-agent`;
- the package has a valid npm `bin` string or `bin.pi` entry;
- the canonical host script is the canonical declared bin target.

A verified running Pi host is authoritative. If the host path is genuinely absent or the nearest named package is foreign, POSIX can use the same exact installed-package route as an embedded Windows SDK host: resolve the Pi manifest directly, or resolve the package entry and walk to its nearest named manifest. This supports a Node/Bun application that embeds the documented Pi SDK without pretending its own `process.argv[1]` is the Pi CLI. An arbitrary JavaScript host is not itself a Pi fallback merely because its filename ends in `.js`, `.cjs`, or `.mjs`.

Windows never consults PATH shims. It first applies the same named-package check to the running host, which covers a global Pi installation loading this package from Pi's separate extension prefix. A valid running Pi host is authoritative. A genuinely absent/foreign SDK host may use the exact installed-package route. Every accepted module manifest on either platform must carry the exact Pi package name; a host that is unreadable or claims to be Pi but has an invalid bin does not silently fall through to another installation.

All package routes realpath the manifest root and bin target, reject absolute or escaping bins, require a regular target file, and preserve these launch forms:

- `.js`, `.cjs`, `.mjs`: launch through a generic `node`, `nodejs`, or `bun` `process.execPath`, with the canonical target as `argvPrefix[0]` (`package-node-cli`);
- Windows `.exe`, `.com`: launch the canonical target directly with an empty argv prefix (retaining the historical `package-node-cli` kind);
- `.cmd`, `.bat`, `.ps1`, extensionless package targets, and other forms: reject rather than invoke a shell.

A non-generic `process.execPath` whose executable name is exactly `pi` (`pi.exe`/`pi.com` on Windows) is a separate `compiled-host` authority: the canonical regular host executable is relaunched directly (with POSIX execute-access or Windows native-extension validation), and a virtual script is not passed as an argument. A Bun virtual host-script shape such as `/$bunfs/root/...` is packaging evidence shared by arbitrary compiled SDK applications and grants no authority by itself. Renamed compiled Pi executables are therefore not claimed as supported; this branch preserves limited compiled-host mechanics but does not certify any vendor binary.

Malformed, unreadable, non-object, or malformed-name manifests are hard package-boundary failures. A missing host source (`ENOENT`/`ENOTDIR`), no named boundary, or a nearest foreign package can permit exact module discovery; source `realpath` permission/I/O failures and all claimed-Pi integrity failures are fatal and cannot be hidden by another installation. Resolution failures throw `PiLaunchResolutionError` with code `pi_executable_resolution_failed`; no substitute route, model, shell interpolation, or invalid-manifest fallback is selected.

## Windows argv and command-line length

`assertWindowsCommandLineWithinLimit()` renders the exact Windows command line with Windows quoting rules, measures UTF-16 length plus the terminating NUL, and throws `PiCommandLineLimitError` (`pi_command_line_too_long`) if it exceeds 32,767 characters. The check is used before child launches that construct `pi` argv.

Delegate seed bytes are delivered over stdin, not argv, so large seeds do not rely on command-line quoting or shell length limits.

## Durable write invariant

`durable-fs.ts` provides two public operations:

- `writeFileDurable(path, data, { signal? })`: open the target once with `w`, write, `sync()`, close.
- `replaceFileDurable(path, data, { signal? })`: create a task-owned temp file with exclusive `wx` at `0o600`, write, `sync()`, close, rename over the target, then directory-sync on non-Windows.

Invariant: a pathname is never reopened merely to fsync it. Sync failures are fatal and surfaced as `DurableFileError`; cleanup failures are retained in the error object instead of hiding the primary failure.

Cancellation is cooperative between filesystem phases, not a claim that Node can interrupt every in-flight kernel syscall. Once a handle is opened, cancellation waits for the current operation and handle close. Before rename it removes the owned temp and never commits it. If cancellation overlaps a successful rename, directory sync still completes before `DurableFileCancellationError` reports `renameCompleted: true`; the caller therefore knows the replacement may already be visible and can perform its owning cleanup.

Temp ownership matters: if exclusive temp creation collides, the caller does not delete the other writer's file. A successful rename is the commit point; if a post-rename directory sync fails, the error marks `renameCompleted: true` because the replacement may already be visible.

`task-durable.ts` is the lightweight task-facing wrapper for durable files, atomic JSON, and output-stream closure. Keeping it separate prevents ordinary process startup from importing the opt-in attested producer. `canonical-json.ts` owns stable key ordering and SHA-256 byte labels shared by delegate, Fusion, and attested artifacts; the attested module re-exports those helpers for API compatibility.

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
