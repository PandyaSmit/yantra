// The environment for anything YANTRA runs that is (or calls) the claude CLI.

/**
 * The user's env minus every CLAUDE* variable and ELECTRON_RUN_AS_NODE. YANTRA may be launched
 * from inside a Claude Code session, whose CLAUDECODE / CLAUDE_CODE_* vars make the CLI think it
 * is nested and use the host's auth instead of its own login (see docs/cli-notes.md).
 */
export function cleanClaudeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || /^CLAUDE/i.test(k) || k === 'ELECTRON_RUN_AS_NODE') continue;
    out[k] = v;
  }
  return out;
}
