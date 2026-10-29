// Everything a stage launch needs on disk and on the command line (SPEC "Session engine"): the
// hook wrapper, the per-launch settings and policy files, the PTY env and the claude argv.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Template } from '@shared/tasks';
import { cleanClaudeEnv } from './env';

type StageTemplate = Template['stages'][number];

/** The hook events YANTRA listens to. Tool events take a matcher. */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'] as const;
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

/** Claude-side deny list, on top of the hook's own (the hook is the real fence; this is belt and braces). */
const SETTINGS_DENY = ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(gh pr merge:*)', 'Bash(glab mr merge:*)'];

/**
 * Writes bin/hook.cmd (Windows) or bin/hook.sh, which runs hook.cjs with Electron's own Node.
 * Rewritten at every app start, because process.execPath moves when Electron updates.
 */
export function writeHookWrapper(binDir: string, execPath: string, hookScript: string, platform = process.platform): string {
  mkdirSync(binDir, { recursive: true });
  if (platform === 'win32') {
    const file = join(binDir, 'hook.cmd');
    const body = ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${execPath}" "${hookScript}"`, 'exit /b %ERRORLEVEL%', ''].join('\r\n');
    writeIfChanged(file, body);
    return file;
  }
  const file = join(binDir, 'hook.sh');
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeIfChanged(file, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(execPath)} ${q(hookScript)}\n`, 0o755);
  return file;
}

function writeIfChanged(file: string, body: string, mode?: number) {
  if (existsSync(file) && readFileSync(file, 'utf8') === body) return;
  writeFileSync(file, body, mode === undefined ? undefined : { mode });
}

/** The generated Claude settings file: every hook goes to the wrapper (forward slashes, quoted for spaces). */
export function settingsJson(hookWrapper: string) {
  const fwd = hookWrapper.replace(/\\/g, '/');
  const command = /\s/.test(fwd) ? `"${fwd}"` : fwd;
  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((e) => [e, [{ ...(TOOL_EVENTS.has(e) ? { matcher: '*' } : {}), hooks: [{ type: 'command', command }] }]]),
  );
  return { hooks, permissions: { deny: SETTINGS_DENY } };
}

export interface Policy {
  stage: string;
  taskDir: string;
  worktree: string;
  write: string[];
  deny: string[];
}

export interface StageFiles {
  settings: string;
  policy: string;
}

/** Writes .stage/settings-<stage>.json and .stage/policy-<stage>.json for one launch. */
export function writeStageFiles(taskDir: string, stage: string, hookWrapper: string, policy: Policy): StageFiles {
  const dir = join(taskDir, '.stage');
  mkdirSync(dir, { recursive: true });
  const files = { settings: join(dir, `settings-${stage}.json`), policy: join(dir, `policy-${stage}.json`) };
  writeFileSync(files.settings, JSON.stringify(settingsJson(hookWrapper), null, 2));
  writeFileSync(files.policy, JSON.stringify(policy, null, 2));
  return files;
}

export interface PromptVars {
  taskDir: string;
  worktree: string;
  issueKey: string;
  title: string;
  round: number;
  feedbackFile: string;
  baseSha: string;
}

/** {{name}} placeholders, and {{#feedback}}…{{/feedback}} kept only when there is a feedback file. */
export function renderPrompt(text: string, vars: PromptVars): string {
  return text
    .replace(/\{\{#feedback\}\}([\s\S]*?)\{\{\/feedback\}\}/g, (_m, inner: string) => (vars.feedbackFile ? inner : ''))
    .replace(/\{\{(\w+)\}\}/g, (m, name: string) => (name in vars ? String(vars[name as keyof PromptVars]) : m))
    .trim();
}

/** A stage's prompt file: the user's <YANTRA_HOME>/<path> wins over the shipped resources/<path>. */
export function readPromptFile(relPath: string, dirs: string[]): string {
  for (const dir of dirs) {
    const file = join(dir, relPath);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  throw new Error(`The prompt file ${relPath} doesn't exist`);
}

/** The role line. Stable for the life of a session: the CLI snapshots the system prompt on the first request. */
export const roleLine = (stage: StageTemplate) => `You are the ${stage.key.toUpperCase()} agent in YANTRA. Stay in your lane.`;

export interface LaunchArgs {
  mode: 'start' | 'resume';
  sessionId: string;
  /** The first message. Required for start; optional for resume (none after a crash). */
  prompt?: string;
  stage: StageTemplate;
  addDirs: string[];
  settings: string;
}

/**
 * claude's argv. The positional prompt goes first, because --add-dir is variadic. Never --bare
 * or --safe-mode (both disable hooks). acceptEdits so writing the artifact doesn't stop for a
 * prompt; the hook decides what may be written.
 */
export function claudeArgs(a: LaunchArgs): string[] {
  const head = a.mode === 'start' ? [a.prompt ?? '', '--session-id', a.sessionId, '--append-system-prompt', roleLine(a.stage)] : ['--resume', a.sessionId, ...(a.prompt ? [a.prompt] : [])];
  return [
    ...head,
    ...a.addDirs.flatMap((d) => ['--add-dir', d]),
    '--settings',
    a.settings,
    '--permission-mode',
    'acceptEdits',
    '--no-chrome',
    ...(a.stage.model ? ['--model', a.stage.model] : []),
  ];
}

export interface StageEnvVars {
  taskDir: string;
  worktree: string;
  stage: string;
  runId: number;
  policy: string;
}

/** The user's env minus CLAUDE* and ELECTRON_RUN_AS_NODE, plus the YANTRA_* contract. */
export function stageEnv(v: StageEnvVars, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    ...cleanClaudeEnv(base),
    YANTRA_TASK_DIR: v.taskDir,
    YANTRA_WORKTREE: v.worktree,
    YANTRA_STAGE: v.stage,
    YANTRA_RUN_ID: String(v.runId),
    YANTRA_POLICY: v.policy,
    CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    TERM: 'xterm-256color',
  };
}
