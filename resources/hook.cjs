// YANTRA hook runner. Claude runs it (through bin/hook.cmd or bin/hook.sh, with Electron's own
// Node) for every hook event of a stage session. Plain CommonJS, zero dependencies, < 100 ms.
//
// 1. Reads the JSON payload from stdin (a leading UTF-8 BOM is stripped).
// 2. Appends one line to $YANTRA_TASK_DIR/log/hooks.jsonl, which main tails.
// 3. On PreToolUse, blocks with exit 2 (reason on stderr) when the policy says no.
//
// The fence is best effort: an agent with a shell can still do odd things. The real guarantees
// are that the app never merges, only pushes on a click, and the remote's branch protection.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Tools whose tool_input.command is a shell command. On Windows Claude uses PowerShell. */
const SHELL_TOOLS = ['Bash', 'PowerShell'];
/** Tools that write a file, and the input field holding its path. */
const WRITE_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
/** Task-folder artifacts only their own stage may write, whatever a template says. */
const OWNERS = { 'research.md': 'research', 'plan.md': 'plan' };

/** Lowercased, quotes and backticks removed, whitespace collapsed, git's global options dropped. */
function normalizeCommand(cmd) {
  return String(cmd)
    .replace(/["'`^]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\bgit\.exe\b/g, 'git')
    .replace(/\bgit( (-c [^ ]+|--[a-z-]+(=[^ ]+)?))+(?= )/g, 'git')
    .trim();
}

function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** True when `target` is `dir` or inside it. Case-insensitive on Windows. */
function inside(P, dir, target, platform) {
  const norm = (p) => (platform === 'win32' ? P.resolve(p).toLowerCase() : P.resolve(p));
  const rel = P.relative(norm(dir), norm(target));
  return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel));
}

function samePath(P, a, b, platform) {
  const norm = (p) => (platform === 'win32' ? P.resolve(p).toLowerCase() : P.resolve(p));
  return norm(a) === norm(b);
}

/**
 * The policy decision for one PreToolUse payload. Pure, so it is unit-tested without a process.
 * policy: { stage, taskDir, worktree, write: ["worktree" | "task:<file>"], deny: [string] }
 * Returns { blocked: false } or { blocked: true, reason }.
 */
function decide(payload, policy, platform = process.platform) {
  if (!payload || payload.hook_event_name !== 'PreToolUse') return { blocked: false };
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};

  if (SHELL_TOOLS.includes(tool)) {
    // Quote stripping also exposes commands nested in sh -c "…", cmd /c "…" or powershell -Command "…".
    const cmd = normalizeCommand(input.command || '');
    for (const entry of policy.deny || []) {
      if (cmd.includes(normalizeCommand(entry))) {
        return { blocked: true, reason: `"${entry}" is not allowed in YANTRA stages. Only the YANTRA app pushes, and only after the human clicks Push. Don't retry or work around this.` };
      }
    }
    return { blocked: false };
  }

  const field = WRITE_TOOLS[tool];
  if (!field) return { blocked: false };
  const raw = input[field];
  if (typeof raw !== 'string' || !raw) return { blocked: false };
  const P = pathApi(platform);
  const target = P.resolve(payload.cwd || policy.worktree, raw);
  const stage = policy.stage;

  for (const [file, owner] of Object.entries(OWNERS)) {
    if (owner !== stage && samePath(P, target, P.join(policy.taskDir, file), platform)) {
      return { blocked: true, reason: `${file} belongs to the ${owner} stage; the ${stage} stage may read it but not change it.` };
    }
  }
  for (const rule of policy.write || []) {
    if (rule === 'worktree' && inside(P, policy.worktree, target, platform)) return { blocked: false };
    if (rule.startsWith('task:') && samePath(P, target, P.join(policy.taskDir, rule.slice(5)), platform)) return { blocked: false };
  }
  // Claude's own per-session scratch folder (temp files it creates for itself) is always fine.
  if (payload.scratchpad_dir && inside(P, payload.scratchpad_dir, target, platform)) return { blocked: false };
  const allowed = (policy.write || []).map((r) => (r === 'worktree' ? `anything under ${policy.worktree}` : P.join(policy.taskDir, r.slice(5)))).join(', ');
  return { blocked: true, reason: `The ${stage} stage may only write ${allowed || 'nothing'}. ${target} is outside that.` };
}

/** Bash command, file path or search pattern, for the timeline. */
function summarize(payload) {
  const input = payload.tool_input || {};
  const s = input.command || input.file_path || input.notebook_path || input.pattern || input.url || input.description || '';
  return String(s).slice(0, 300);
}

/** The line appended to hooks.jsonl. Fields beyond the SPEC list are what hooks.ts needs to drive stage status. */
function logLine(payload, env, decision, now = Date.now()) {
  const event = payload.hook_event_name || 'Unknown';
  const line = {
    ts: now,
    runId: env.YANTRA_RUN_ID ? Number(env.YANTRA_RUN_ID) : null,
    stage: env.YANTRA_STAGE || null,
    event,
    sessionId: payload.session_id || null,
    transcriptPath: payload.transcript_path || null,
    tool: payload.tool_name || null,
    summary: summarize(payload),
    blocked: decision.blocked,
  };
  if (decision.blocked) line.reason = decision.reason;
  if (payload.agent_id) line.agentId = payload.agent_id;
  if (event === 'SessionStart') line.source = payload.source || null;
  if (event === 'SessionEnd') line.endReason = payload.reason || null;
  if (event === 'UserPromptSubmit') line.notification = String(payload.prompt || '').trimStart().startsWith('<task-notification>');
  if (event === 'Stop') {
    line.backgroundRunning = (payload.background_tasks || []).some((t) => t && t.status === 'running');
    if (payload.last_assistant_message) line.lastMessage = String(payload.last_assistant_message).slice(0, 2000);
  }
  return line;
}

function readPolicy(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { hook_event_name: 'Unparsed' };
    }
    const env = process.env;
    const policy = env.YANTRA_POLICY ? readPolicy(env.YANTRA_POLICY) : null;
    // A missing or broken policy file fails closed for writes and shells (no write list, the default deny list).
    const decision = decide(payload, policy || { stage: env.YANTRA_STAGE || '?', taskDir: env.YANTRA_TASK_DIR || '', worktree: env.YANTRA_WORKTREE || '', write: [], deny: ['git push', 'git merge'] });
    if (env.YANTRA_TASK_DIR) {
      try {
        fs.mkdirSync(path.join(env.YANTRA_TASK_DIR, 'log'), { recursive: true });
        fs.appendFileSync(path.join(env.YANTRA_TASK_DIR, 'log', 'hooks.jsonl'), JSON.stringify(logLine(payload, env, decision)) + '\n');
      } catch {
        // Logging must never break the session.
      }
    }
    if (decision.blocked) {
      process.stderr.write(`YANTRA: ${decision.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { decide, logLine, normalizeCommand, SHELL_TOOLS, WRITE_TOOLS, OWNERS };
