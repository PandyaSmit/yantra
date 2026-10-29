// Worktree trust. Claude asks "Is this a project you created or one you trust?" the first time it
// runs in a folder, and its default answer ("No, exit") ends the session. With the trustWorktrees
// setting on (the default), YANTRA marks each worktree it creates as trusted in ~/.claude.json,
// the same flag Claude sets when you answer "Yes". Nothing else in that file is touched.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** ~/.claude.json. YANTRA_CLAUDE_HOME points it elsewhere for tests. */
export const claudeJsonPath = () => join(process.env.YANTRA_CLAUDE_HOME || homedir(), '.claude.json');

/** Claude keys projects by path with forward slashes: "D:/code/payments-api". */
export const trustKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

export type TrustResult = 'trusted' | 'already' | 'no-config';

export function isTrusted(path: string, file = claudeJsonPath()): boolean {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { projects?: Record<string, { hasTrustDialogAccepted?: unknown }> };
    return j.projects?.[trustKey(path)]?.hasTrustDialogAccepted === true;
  } catch {
    return false;
  }
}

/**
 * Sets projects["<path>"].hasTrustDialogAccepted = true. Read, change one flag, write to a temp
 * file and rename over the original, so a concurrent reader never sees half a file. A missing
 * file means Claude was never set up; pre-flight reports that, so this does nothing.
 */
export function trustFolder(path: string, file = claudeJsonPath()): TrustResult {
  if (!existsSync(file)) return 'no-config';
  const text = readFileSync(file, 'utf8');
  const j = JSON.parse(text.replace(/^\uFEFF/, '')) as { projects?: Record<string, Record<string, unknown>> };
  const key = trustKey(path);
  const projects = (j.projects ??= {});
  if (projects[key]?.hasTrustDialogAccepted === true) return 'already';
  projects[key] = { ...projects[key], hasTrustDialogAccepted: true };
  const tmp = `${file}.yantra-${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(j, null, 2));
  renameSync(tmp, file);
  return 'trusted';
}
