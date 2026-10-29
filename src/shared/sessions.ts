// Sessions: what the renderer sees of stage runs and live PTYs.
import type { PreflightResult, StageStatus } from './types';

/** One PTY lifetime of a stage, newest first in lists. */
export interface RunInfo {
  id: number;
  stageId: number;
  stageKey: string;
  stageTitle: string;
  kind: 'start' | 'resume' | 'feedback';
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  /** 'trust_prompt' when claude quit at the workspace-trust question; 'stopped' after Stop session. */
  exitNote: string | null;
  /** The PTY is alive in this app session. */
  live: boolean;
}

/** A stage that holds or waits for a session slot, for the Running view and the status bar. */
export interface LiveSession {
  taskId: number;
  stageId: number;
  issueKey: string;
  title: string;
  projectSlug: string;
  stageKey: string;
  stageTitle: string;
  status: StageStatus;
  runId: number | null;
  /** When the current run started; null while queued. */
  startedAt: number | null;
  lastMessage: string | null;
  /** Position in the queue (1-based) when queued. */
  queuePosition: number | null;
}

export interface SessionsSummary {
  sessions: LiveSession[];
  /** Live PTYs right now, and the maximum. */
  live: number;
  max: number;
}

/** Launching needs a working, logged-in claude; otherwise the workspace shows the pre-flight banner. */
export type LaunchResult = { ok: true } | { ok: false; preflight: PreflightResult };

/** A toast main asks the renderer to show (fence blocks, stages done, trust-prompt exits). */
export interface Notice {
  tone: 'info' | 'success' | 'error';
  title: string;
  description?: string;
  taskId?: number;
}
