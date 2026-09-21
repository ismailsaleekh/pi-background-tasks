import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isolatedTestEnv, stripAnsi } from '../helpers/normalize.js';
import { installFusionFakePi } from '../helpers/fusion-fake-pi.js';

const extensionPath = resolve('extensions/background-tasks.ts');
const scriptedProviderPath = resolve('tests/scripted-provider/scripted-provider-extension.ts');
const expectBin = '/usr/bin/expect';

const PTY_SKIP_REASON =
  'interactive stdin is not deliverable to a raw-mode Node TUI via /usr/bin/expect on this host ' +
  '(verified: a plain `cat` receives input but a Node process.stdin reader does not). ' +
  'Run `npm run test:pty` on a host/CI where Node TTY stdin works under the PTY driver.';

function tclQuote(value: string): string {
  return `{${value.replace(/}/g, '\\}')}}`;
}

/**
 * Probe whether this host can deliver interactive stdin to a raw-mode Node TUI
 * through /usr/bin/expect. pi is a Node program that puts stdin in raw mode, so
 * if a minimal Node raw-stdin reader cannot receive an expect-sent byte, none of
 * the interactive pi PTY scenarios below can run here. The probe spawns the exact
 * failing shape (Node + expect) rather than guessing from platform/version, and
 * the result is cached so it runs once per suite.
 */
let ptyInputProbe: Promise<boolean> | undefined;
function ptyInputSupported(): Promise<boolean> {
  ptyInputProbe ??= probePtyInput();
  return ptyInputProbe;
}

async function probePtyInput(): Promise<boolean> {
  if (process.platform === 'win32') return false;
  if (!existsSync(expectBin)) return false;
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-pty-probe-'));
  try {
    const reader = join(root, 'reader.cjs');
    await writeFile(
      reader,
      [
        'process.stdin.setEncoding("utf8");',
        'if (process.stdin.setRawMode) process.stdin.setRawMode(true);',
        'process.stdin.resume();',
        'process.stdin.on("data", (d) => { if (d.includes("Z")) { process.stdout.write("PTYPROBE_OK\\n"); process.exit(0); } });',
        'process.stdout.write("PTYPROBE_READY\\n");',
      ].join('\n'),
      'utf8',
    );
    const script = join(root, 'probe.expect');
    await writeFile(
      script,
      [
        'set timeout 6',
        `spawn -noecho ${tclQuote(process.execPath)} ${tclQuote(reader)}`,
        'expect { -re "PTYPROBE_READY" {} timeout { exit 2 } }',
        'after 300',
        'send "Z"',
        'expect { -re "PTYPROBE_OK" { exit 0 } timeout { exit 3 } }',
      ].join('\n'),
      'utf8',
    );
    const result = spawnSync(expectBin, [script], { encoding: 'utf8', timeout: 12_000 });
    return result.status === 0 && result.stdout.includes('PTYPROBE_OK');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

interface RunExpectOptions {
  size?: { rows: number; cols: number } | undefined;
  extensionPaths?: readonly string[] | undefined;
  model?: string | undefined;
  env?: Readonly<Record<string, string>> | undefined;
  fusionFakeMergedText?: string | undefined;
}

async function runExpect(
  body: string,
  timeoutSeconds = 35,
  size?: { rows: number; cols: number },
  options: RunExpectOptions = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-pty-'));
  const cwd = join(root, 'project');
  await mkdir(cwd, { recursive: true });
  const script = join(root, 'scenario.expect');
  const fake =
    options.fusionFakeMergedText === undefined
      ? undefined
      : await installFusionFakePi(root, { mergedText: options.fusionFakeMergedText });
  // Some scenarios (e.g. scrolling the tall detail view) need a taller pty so the
  // bottom-anchored dock is not clipped; stty_init must be set before spawn.
  const requestedSize = options.size ?? size;
  const sttyInit = requestedSize
    ? `set stty_init {rows ${String(requestedSize.rows)} columns ${String(requestedSize.cols)}}\n`
    : '';
  const extensionArgs = (options.extensionPaths ?? [extensionPath])
    .map((path) => `-e ${tclQuote(path)}`)
    .join(' ');
  const modelArg = options.model === undefined ? '' : ` --model ${tclQuote(options.model)}`;
  const optionEnv = Object.entries(options.env ?? {})
    .map(([key, value]) => `set env(${key}) ${tclQuote(value)}`)
    .join('\n');
  const pathEnv = fake === undefined ? '' : `set env(PATH) ${tclQuote(fake.env['PATH'] ?? '')}`;
  const content = `
set timeout ${String(timeoutSeconds)}
${sttyInit}`;
  const tail = `
set env(PI_OFFLINE) "${isolatedTestEnv.PI_OFFLINE}"
set env(PI_SKIP_VERSION_CHECK) "${isolatedTestEnv.PI_SKIP_VERSION_CHECK}"
set env(PI_TELEMETRY) "${isolatedTestEnv.PI_TELEMETRY}"
set env(CI) "${isolatedTestEnv.CI}"
set env(PI_CODING_AGENT_DIR) ${tclQuote(join(root, 'agent'))}
set env(PI_CODING_AGENT_SESSION_DIR) ${tclQuote(join(root, 'sessions'))}
set env(NPM_CONFIG_CACHE) "/tmp/pi-npm-cache"
set env(TERM) "xterm-256color"
${pathEnv}
${optionEnv}
spawn -noecho /usr/local/bin/pi --offline --no-session --no-extensions ${extensionArgs} --no-skills --no-prompt-templates --no-context-files --no-tools${modelArg}
expect {
  -re {\\[\\?u} { send "\\033\\[?0u"; exp_continue }
  -re {\\[c} { send "\\033\\[?1;2c"; exp_continue }
  -re {\\(auto\\)} {}
  timeout { puts "INITIAL_PROMPT_TIMEOUT"; exit 2 }
}
after 600
${body}
send "\\003"
after 500
exit 0
`;
  await writeFile(script, content + tail, 'utf8');
  try {
    const result = spawnSync(expectBin, [script], {
      cwd,
      encoding: 'utf8',
      timeout: (timeoutSeconds + 5) * 1000,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, stripAnsi(output));
    return stripAnsi(output).replace(/\r/g, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void describe('interactive PTY', () => {
  void it(
    'opens the focused dock from /tasks and closes with x',
    { timeout: 45_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send "/tasks"
send "\\r"
expect {
  -re "bg tasks focused|No background tasks" {}
  timeout { puts "TASKS_DOCK_TIMEOUT"; exit 3 }
}
send "x"
`,
        30,
      );
      assert.match(output, /bg tasks focused|No background tasks/);
    },
  );

  void it(
    'launches Fusion in the background and renders terminal completion in the real TUI',
    { timeout: 65_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send "/fusion pty fusion prompt"
send "\\r"
expect {
  -re "Started fusion reason" {}
  timeout { puts "FUSION_LAUNCH_TIMEOUT"; exit 41 }
}
expect {
  -re "\\[bg completed\\].*fusion reason" {}
  timeout { puts "FUSION_TERMINAL_TIMEOUT"; exit 42 }
}
`,
        55,
        undefined,
        {
          extensionPaths: [scriptedProviderPath, extensionPath],
          model: 'pi-bg-scripted/scripted-model',
          env: {
            PI_BG_SCRIPTED_API_KEY: 'scripted-api-key',
            PI_BG_SCRIPTED_SCENARIO: 'display-only-bg',
          },
          fusionFakeMergedText: 'PTY fused answer.',
        },
      );
      assert.match(output, /Started fusion reason/);
      assert.match(output, /\[bg completed\].*fusion reason/);
    },
  );

  void it('opens the Fusion model selector in the real TUI', { timeout: 45_000 }, async (t) => {
    if (!(await ptyInputSupported())) {
      t.skip(PTY_SKIP_REASON);
      return;
    }
    const output = await runExpect(
      `
send "/fusion-models"
send "\\r"
expect {
  -re "Fusion models(.|\n)*Candidate 1(.|\n)*Evaluator" {}
  timeout { puts "FUSION_MODELS_TIMEOUT"; exit 42 }
}
send "\\033"
`,
      35,
      undefined,
      {
        extensionPaths: [scriptedProviderPath, extensionPath],
        model: 'pi-bg-scripted/scripted-model',
        env: {
          PI_BG_SCRIPTED_API_KEY: 'scripted-api-key',
          PI_BG_SCRIPTED_SCENARIO: 'display-only-bg',
        },
      },
    );
    assert.match(output, /Fusion models/);
    assert.match(output, /Candidate 1/);
  });

  void it(
    'opens the footer dock via Shift+Down after starting a named task',
    { timeout: 55_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send {/bg --name "PTY Sleep" node -e "setTimeout(()=>{},4000)"}
send "\\r"
expect {
  -re "Started PTY Sleep" {}
  timeout { puts "BG_START_TIMEOUT"; exit 4 }
}
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused(.|\n)*PTY Sleep" {}
  timeout { puts "SHIFT_DOWN_DOCK_TIMEOUT"; exit 5 }
}
send "x"
`,
        40,
      );
      assert.match(output, /PTY Sleep/);
      assert.match(output, /bg tasks focused/);
    },
  );

  void it(
    'drives real dock detail, history, stop, and close keys',
    { timeout: 70_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send {/bg --name "PTY Action" node -e "let i=0; const t=setInterval(()=>{console.log('pty-action-'+(++i)); if(i===20) clearInterval(t)},100)"}
send "\\r"
expect {
  -re "Started PTY Action" {}
  timeout { puts "ACTION_START_TIMEOUT"; exit 6 }
}
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused(.|\n)*PTY Action" {}
  timeout { puts "ACTION_DOCK_TIMEOUT"; exit 7 }
}
send "\\r"
expect {
  -re "bg: PTY Action|Output tail" {}
  timeout { puts "ACTION_DETAIL_TIMEOUT"; exit 8 }
}
send "r"
after 300
send "\\033\\[D"
expect {
  -re "bg tasks focused" {}
  timeout { puts "ACTION_BACK_TIMEOUT"; exit 9 }
}
send "h"
expect {
  -re "history|active" {}
  timeout { puts "ACTION_HISTORY_TIMEOUT"; exit 10 }
}
send "k"
expect {
  -re "Stopping|Stopped|stopped" {}
  timeout { puts "ACTION_STOP_TIMEOUT"; exit 11 }
}
send "x"
`,
        55,
      );
      assert.match(output, /PTY Action/);
      assert.match(output, /bg tasks focused/);
      assert.match(output, /bg: PTY Action|Output tail/);
    },
  );

  void it(
    'scrolls the detail output tail with real arrow/page keys',
    { timeout: 60_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send {/bg --name "PTY Scroll" node -e "for(let i=1;i<=60;i++)console.log('PTYSCROLL-'+i)"}
send "\\r"
expect {
  -re "Started PTY Scroll" {}
  timeout { puts "SCROLL_START_TIMEOUT"; exit 33 }
}
after 600
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused" {}
  timeout { puts "SCROLL_DOCK_TIMEOUT"; exit 34 }
}
send "\\r"
expect {
  -re "bg: PTY Scroll" {}
  timeout { puts "SCROLL_DETAIL_TIMEOUT"; exit 35 }
}
expect {
  -re "PTYSCROLL-60" {}
  timeout { puts "SCROLL_OUTPUT_TIMEOUT"; exit 37 }
}
send "\\033\\[A"
send "\\033\\[A"
send "\\033\\[A"
expect {
  -re {of 60} {}
  timeout { puts "SCROLL_INDICATOR_TIMEOUT"; exit 36 }
}
send "x"
`,
        45,
        { rows: 80, cols: 120 },
      );
      assert.match(output, /PTY Scroll/);
      assert.match(output, /lines [0-9]+.*of 60/);
    },
  );

  void it(
    'covers secondary dock keys for selection, output path, rerun, and stop-all',
    { timeout: 80_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send {/bg --name "PTY Alpha" node -e "setInterval(()=>console.log('alpha'),200)"}
send "\\r"
expect {
  -re "Started PTY Alpha" {}
  timeout { puts "SECONDARY_ALPHA_TIMEOUT"; exit 12 }
}
send {/bg --name "PTY Beta" node -e "setInterval(()=>console.log('beta'),200)"}
send "\\r"
expect {
  -re "Started PTY Beta" {}
  timeout { puts "SECONDARY_BETA_TIMEOUT"; exit 13 }
}
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused(.|\n)*PTY Beta(.|\n)*PTY Alpha|bg tasks focused(.|\n)*PTY Alpha(.|\n)*PTY Beta" {}
  timeout { puts "SECONDARY_DOCK_TIMEOUT"; exit 14 }
}
send "c"
expect {
  -re "Output path shown for PTY Beta|Output path for PTY Beta" {}
  timeout { puts "SECONDARY_PATH_BETA_TIMEOUT"; exit 15 }
}
send "\\033\\[B"
expect {
  -re "PTY Alpha" {}
  timeout { puts "SECONDARY_DOWN_TIMEOUT"; exit 16 }
}
send "c"
expect {
  -re "Output path shown for PTY Alpha|Output path for PTY Alpha" {}
  timeout { puts "SECONDARY_PATH_ALPHA_TIMEOUT"; exit 17 }
}
send "\\033\\[A"
expect {
  -re "PTY Beta" {}
  timeout { puts "SECONDARY_UP_TIMEOUT"; exit 18 }
}
send "R"
expect {
  -re "Reran as PTY Beta|Rerunning PTY Beta" {}
  timeout { puts "SECONDARY_RERUN_TIMEOUT"; exit 19 }
}
send "a"
expect {
  -re "Press a/K again to stop all" {}
  timeout { puts "SECONDARY_STOP_ALL_ARM_TIMEOUT"; exit 20 }
}
send "K"
expect {
  -re {Stopped [0-9]+ running task} {}
  timeout { puts "SECONDARY_STOP_ALL_TIMEOUT"; exit 21 }
}
send "x"
`,
        65,
      );
      assert.match(output, /PTY Alpha/);
      assert.match(output, /PTY Beta/);
      assert.match(output, /Output path shown for PTY/);
      assert.match(output, /Reran as PTY Beta|Rerunning PTY Beta/);
      assert.match(output, /Stopped [0-9]+ running task/);
    },
  );

  void it(
    'reruns completed, failed, and killed history tasks in a real dock',
    { timeout: 70_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
send {/bg --name "PTY Done Rerun" printf done-rerun}
send "\\r"
expect {
  -re "Started PTY Done Rerun" {}
  timeout { puts "RERUN_COMPLETE_START_TIMEOUT"; exit 22 }
}
expect {
  -re "bg completed.*PTY Done Rerun" {}
  timeout { puts "RERUN_COMPLETE_TERMINAL_TIMEOUT"; exit 33 }
}
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused" {}
  timeout { puts "RERUN_COMPLETE_DOCK_TIMEOUT"; exit 23 }
}
send "R"
expect {
  -re "Reran as PTY Done Rerun|Rerunning PTY Done Rerun" {}
  timeout { puts "RERUN_COMPLETE_ACTION_TIMEOUT"; exit 24 }
}
send "x"
after 200
send {/bg --name "PTY Stop Rerun" sleep 20}
send "\\r"
expect {
  -re "Started PTY Stop Rerun" {}
  timeout { puts "RERUN_KILLED_START_TIMEOUT"; exit 25 }
}
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused" {}
  timeout { puts "RERUN_KILLED_DOCK_TIMEOUT"; exit 26 }
}
send "k"
expect {
  -re "Stopped PTY Stop Rerun" {}
  timeout { puts "RERUN_KILLED_STOP_TIMEOUT"; exit 27 }
}
send "R"
expect {
  -re "Reran as PTY Stop Rerun" {}
  timeout { puts "RERUN_KILLED_ACTION_TIMEOUT"; exit 28 }
}
send "a"
expect {
  -re "Press a/K again to stop all" {}
  timeout { puts "RERUN_KILLED_STOP_ALL_ARM_TIMEOUT"; exit 29 }
}
send "K"
expect {
  -re {Stopped [1-9][0-9]* running task} {}
  timeout { puts "RERUN_KILLED_RERUN_STOP_TIMEOUT"; exit 34 }
}
send "x"
after 200
send {/bg --name "PTY Bad Rerun" node -e "process.exit(5)"}
send "\\r"
expect {
  -re "Started PTY Bad Rerun" {}
  timeout { puts "RERUN_FAILED_START_TIMEOUT"; exit 30 }
}
expect {
  -re "bg failed.*PTY Bad Rerun" {}
  timeout { puts "RERUN_FAILED_TERMINAL_TIMEOUT"; exit 35 }
}
send "\\033\\[1;2B"
expect {
  -re "bg tasks focused" {}
  timeout { puts "RERUN_FAILED_DOCK_TIMEOUT"; exit 31 }
}
send "R"
expect {
  -re "Reran as PTY Bad Rerun|Rerunning PTY Bad Rerun" {}
  timeout { puts "RERUN_FAILED_ACTION_TIMEOUT"; exit 32 }
}
send "x"
`,
        55,
      );
      assert.match(output, /Reran as PTY Done Rerun|Rerunning PTY Done Rerun/);
      assert.match(output, /Reran as PTY Bad Rerun|Rerunning PTY Bad Rerun/);
      assert.match(output, /Reran as PTY Stop Rerun|Rerunning PTY Stop Rerun/);
    },
  );

  void it(
    'covers /bg-tasks history, failed unread badges, and page keys',
    { timeout: 200_000 },
    async (t) => {
      if (!(await ptyInputSupported())) {
        t.skip(PTY_SKIP_REASON);
        return;
      }
      const output = await runExpect(
        `
set send_slow {1 .004}
for {set i 1} {$i <= 16} {incr i} {
  send -s "/bg --name \\"PTY Page $i\\" printf page-$i"
  send "\\r"
  expect {
    -re "Started PTY Page $i" {}
    timeout { puts "PAGE_START_TIMEOUT_$i"; exit 22 }
  }
  after 80
}
send {/bg --name "PTY Fails" node -e "process.exit(4)"}
send "\\r"
expect {
  -re "Started PTY Fails" {}
  timeout { puts "PAGE_FAIL_START_TIMEOUT"; exit 23 }
}
after 700
send "/bg-tasks"
send "\\r"
expect {
  -re "bg tasks focused(.|\n)*(failed|unread)(.|\n)*PTY Fails" {}
  timeout { puts "PAGE_DOCK_TIMEOUT"; exit 24 }
}
send "\\033\\[6~"
after 300
send "\\033\\[5~"
after 300
send "x"
`,
        170,
      );
      assert.match(output, /PTY Fails/);
      assert.match(output, /failed|unread/);
      assert.match(output, /PTY Page/);
    },
  );
});
