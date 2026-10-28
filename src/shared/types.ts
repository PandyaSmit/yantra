// Types shared by main and renderer that are not config/IPC schemas.
import type { AppConfig } from './schemas';

export type ResolvedTheme = 'light' | 'dark';

export const STAGE_STATUSES = [
  'pending',
  'queued',
  'running',
  'idle',
  'awaiting_approval',
  'approved',
  'skipped',
  'interrupted',
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export interface AppInfo {
  version: string;
  platform: string;
  configPath: string;
  dbPath: string | null;
  isDev: boolean;
}

/** Either the loaded config, or why it could not be loaded (the app then shows a blocking error screen). */
export type ConfigState =
  | { ok: true; config: AppConfig }
  | { ok: false; path: string; error: string; issues: string[] };

export interface PreflightCheck {
  ok: boolean;
  detail: string; // one line shown next to the check
}

export interface PreflightResult {
  ok: boolean;
  checkedAt: number;
  binary: PreflightCheck & { path: string | null; version: string | null };
  auth: PreflightCheck & { email: string | null; plan: string | null };
  onboarding: PreflightCheck;
}

export interface RepoInfo {
  ok: boolean;
  error: string | null;
  root: string | null; // repo top level (may differ from the picked folder)
  defaultBranch: string | null;
  remotes: string[];
  suggestedName: string;
  suggestedSlug: string;
  suggestedKey: string;
}
