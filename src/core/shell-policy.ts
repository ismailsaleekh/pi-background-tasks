import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import {
  resolveShellPolicy,
  type ResolvedShellPolicy,
  type ShellPolicySnapshot,
} from './common.js';

export const SHELL_POLICY_SECTION = 'pi_background_shell_policy';
const SHELL_POLICY_OPEN = `<${SHELL_POLICY_SECTION}>`;
const SHELL_POLICY_CLOSE = `</${SHELL_POLICY_SECTION}>`;

interface MutableStructuredPromptOptions {
  sections?: Record<string, string> | undefined;
  forceSystemPrompt?: string | undefined;
}

export interface ShellPolicyInitializationOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly activationCwd?: string | undefined;
}

function displayedArgs(policy: ShellPolicySnapshot): string[] {
  return [
    ...policy.argvPrefix,
    policy.dialect === 'cmd' ? '"<command>"' : '<command>',
  ];
}

/** Stable, non-secret guidance generated from the same selection used for spawning. */
export function shellPolicyGuidance(policy: ShellPolicySnapshot): string {
  const launch = JSON.stringify({
    policy: policy.policy,
    executable: policy.executable,
    dialect: policy.dialect,
    args: displayedArgs(policy),
  });
  const lines = [
    `bg_run and /bg execute commands with the activation shell policy ${launch}.`,
    'The executable and arguments are passed directly to process spawn; the executable path is never interpolated into another shell command.',
  ];

  if (policy.dialect === 'user-non-posix') {
    lines.push(
      'This inherited user shell is not classified as POSIX or Bash. Do not generate Bash/POSIX syntax or assume Bash startup files for bg_run or /bg.',
      'Bash remediation: set PI_BG_POSIX_SHELL=bash before starting or reloading Pi; optionally set PI_BG_POSIX_SHELL_PATH to an absolute executable Bash path.',
    );
  } else if (policy.dialect === 'bash') {
    lines.push(
      'Generate Bash syntax for bg_run and /bg. Commands use Bash -c, never -lc, so login-shell startup files are not loaded implicitly.',
    );
  } else if (policy.dialect === 'posix') {
    lines.push(
      'Generate portable POSIX shell syntax for bg_run and /bg; do not assume Bash-only syntax. Commands use -c and do not request login-shell startup.',
    );
  } else {
    lines.push(
      'Generate Windows cmd.exe syntax for bg_run and /bg. The POSIX shell-selection variables do not change Windows execution.',
    );
  }

  return lines.join('\n');
}

export function renderShellPolicyGuidanceBlock(policy: ShellPolicySnapshot): string {
  return `${SHELL_POLICY_OPEN}\n${shellPolicyGuidance(policy)}\n${SHELL_POLICY_CLOSE}`;
}

/** Replace this package's section without disturbing guidance owned by another hook. */
export function upsertShellPolicyGuidance(
  systemPrompt: string,
  policy: ShellPolicySnapshot,
): string {
  const block = renderShellPolicyGuidanceBlock(policy);
  const start = systemPrompt.indexOf(SHELL_POLICY_OPEN);
  if (start >= 0) {
    const close = systemPrompt.indexOf(SHELL_POLICY_CLOSE, start + SHELL_POLICY_OPEN.length);
    if (close >= 0) {
      return `${systemPrompt.slice(0, start)}${block}${systemPrompt.slice(close + SHELL_POLICY_CLOSE.length)}`;
    }
  }
  return systemPrompt.length > 0 ? `${systemPrompt}\n\n${block}` : block;
}

/**
 * Compose across Pi 0.84's chained string hook and Pi 0.86's structured prompt sections.
 * A pre-existing forced prompt is updated as well because structured sections are opaque
 * while `forceSystemPrompt` is active.
 */
export function applyShellPolicyGuidance(
  event: Pick<BeforeAgentStartEvent, 'systemPrompt' | 'systemPromptOptions'>,
  policy: ShellPolicySnapshot,
): BeforeAgentStartEventResult | undefined {
  const options = event.systemPromptOptions as MutableStructuredPromptOptions;
  if (
    typeof options.sections === 'object' &&
    options.sections !== null &&
    !Array.isArray(options.sections)
  ) {
    options.sections[SHELL_POLICY_SECTION] = shellPolicyGuidance(policy);
    if (typeof options.forceSystemPrompt === 'string') {
      options.forceSystemPrompt = upsertShellPolicyGuidance(options.forceSystemPrompt, policy);
    }
    return undefined;
  }
  return { systemPrompt: upsertShellPolicyGuidance(event.systemPrompt, policy) };
}

export function createShellPolicyGuidanceHandler(policy: ResolvedShellPolicy) {
  return (event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined =>
    applyShellPolicyGuidance(event, policy);
}

export function registerShellPolicyGuidance(
  pi: Pick<ExtensionAPI, 'on'>,
  policy: ResolvedShellPolicy,
): void {
  pi.on('before_agent_start', createShellPolicyGuidanceHandler(policy));
}

/** Resolve once at extension activation; the returned object is deeply frozen. */
export function initializeShellPolicy(
  options: ShellPolicyInitializationOptions = {},
): ResolvedShellPolicy {
  return resolveShellPolicy(
    options.platform ?? process.platform,
    options.env ?? process.env,
    options.activationCwd ?? process.cwd(),
  );
}
