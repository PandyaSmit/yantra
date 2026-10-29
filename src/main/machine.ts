// The state machine (SPEC "State machine"): pure functions, state + action → new state + the side
// effects to perform. pipeline.ts executes the effects; nothing here touches the disk or a PTY.
import type { TaskStatus } from '@shared/board';
import type { TaskActionType } from '@shared/tasks';
import type { StageStatus } from '@shared/types';

export interface StageState {
  key: string;
  status: StageStatus;
  round: number;
  /** A claude session for this stage reached SessionStart, so the next launch resumes it. */
  hasSession: boolean;
  /** Its PTY is alive. */
  live: boolean;
  /** It has `pre` commands (the template's, or the project's override). */
  hasChecks: boolean;
  approvedHash: string | null;
}

export interface TaskState {
  status: TaskStatus;
  stages: StageState[];
}

export type Action =
  | { type: 'startTask' } // draft -> active, first stage queued
  | { type: 'launchStage'; stageKey: string } // pending|interrupted (or awaiting with no PTY) -> queued
  | { type: 'slotFree'; stageKey: string } // queued -> running (spawn)
  | { type: 'hook'; event: 'UserPromptSubmit' | 'Stop' | 'SessionEnd'; stageKey: string; artifactReady: boolean; backgroundRunning: boolean }
  | { type: 'approve'; stageKey: string; artifactHash: string }
  | { type: 'reject'; stageKey: string; feedback: string } // same stage, round+1, resume session
  | { type: 'sendBack'; toStageKey: string; feedback: string } // earlier stage, round+1; later stages reset to pending
  | { type: 'skip'; stageKey: string }
  | { type: 'appRestart' } // running|idle|queued -> interrupted
  | { type: 'pushed' } // ready_to_ship -> pushed
  | { type: 'finish' } // pushed (or ready_to_ship) -> done (cleanup)
  | { type: 'abandon' }; // any but done -> abandoned (cleanup, no push)

export type Effect =
  | { kind: 'spawn'; stageKey: string; mode: 'start' | 'resume'; feedbackFile?: string }
  | { kind: 'kill'; stageKey: string }
  | { kind: 'snapshotArtifact'; stageKey: string }
  | { kind: 'writeFeedback'; stageKey: string; round: number; text: string }
  | { kind: 'runChecks'; stageKey: string }
  | { kind: 'notify'; reason: 'awaiting_approval' | 'blocked' | 'checks_done'; stageKey: string }
  | { kind: 'cleanup'; keepBranch: boolean };

export class IllegalAction extends Error {}

/** feedback/<stage>-round-N.md, relative to the task folder. */
export const feedbackFile = (stageKey: string, round: number) => `feedback/${stageKey}-round-${round}.md`;

/** The stage that runs now: the first, in template order, that isn't approved or skipped (-1: none). */
export const currentIndex = (t: TaskState) => t.stages.findIndex((s) => s.status !== 'approved' && s.status !== 'skipped');

/** Statuses that hold or wait for a session slot. */
const HOLDING: StageStatus[] = ['queued', 'running', 'idle'];

export function reduce(task: TaskState, action: Action): { task: TaskState; effects: Effect[] } {
  const t: TaskState = { status: task.status, stages: task.stages.map((s) => ({ ...s })) };
  const effects: Effect[] = [];
  const fail = (why: string): never => {
    throw new IllegalAction(why);
  };
  const byKey = (key: string) => t.stages.find((s) => s.key === key) ?? fail(`There's no ${key} stage`);
  const current = () => t.stages[currentIndex(t)];
  const requireCurrent = (key: string) => {
    const c = current();
    if (!c || c.key !== key) fail(`${key} isn't the stage that runs now`);
    return c!;
  };
  const requireActive = () => t.status === 'active' || fail(`A ${t.status.replace(/_/g, ' ')} task doesn't run stages`);
  // A queued stage has no PTY yet, but still has to leave the queue.
  const kill = (s: StageState) => {
    if (s.live || s.status === 'queued') effects.push({ kind: 'kill', stageKey: s.key });
    s.live = false;
  };
  const queue = (s: StageState, feedback?: string) => {
    const mode = s.hasSession ? 'resume' : 'start';
    s.status = 'queued';
    if (s.hasChecks && mode === 'start') effects.push({ kind: 'runChecks', stageKey: s.key });
    effects.push({ kind: 'spawn', stageKey: s.key, mode, ...(feedback ? { feedbackFile: feedback } : {}) });
  };
  // After an approval or a skip: the next stage launches, or the task is ready to ship.
  const advance = () => {
    const next = current();
    if (next) queue(next);
    else t.status = 'ready_to_ship';
  };
  const requireFeedback = (text: string) => text.trim() !== '' || fail('Write what should change first');

  switch (action.type) {
    case 'startTask': {
      if (t.status !== 'draft') fail('This task has already started');
      const first = current() ?? fail('This task has no stages to run');
      t.status = 'active';
      queue(first);
      break;
    }
    case 'launchStage': {
      requireActive();
      const s = requireCurrent(action.stageKey);
      const reopen = s.status === 'awaiting_approval' && !s.live;
      if (s.status !== 'pending' && s.status !== 'interrupted' && !reopen) fail(`${s.key} is already ${s.status.replace(/_/g, ' ')}`);
      queue(s);
      break;
    }
    case 'slotFree': {
      const s = byKey(action.stageKey);
      if (s.status !== 'queued') fail(`${s.key} isn't queued`);
      s.status = 'running';
      s.live = true;
      break;
    }
    case 'hook': {
      const s = byKey(action.stageKey);
      // Lines for a stage that no longer holds a session (approved, reset) never move it.
      if (![...HOLDING, 'awaiting_approval'].includes(s.status)) break;
      if (action.event === 'UserPromptSubmit') s.status = 'running';
      else if (action.event === 'Stop') {
        if (action.backgroundRunning) s.status = 'running';
        else if (action.artifactReady) {
          if (s.status !== 'awaiting_approval') effects.push({ kind: 'notify', reason: 'awaiting_approval', stageKey: s.key });
          s.status = 'awaiting_approval';
        } else s.status = 'idle';
      }
      break;
    }
    case 'approve': {
      requireActive();
      const s = requireCurrent(action.stageKey);
      if (s.status !== 'awaiting_approval') fail(`${s.key} isn't waiting for approval`);
      s.status = 'approved';
      s.approvedHash = action.artifactHash;
      effects.push({ kind: 'snapshotArtifact', stageKey: s.key });
      kill(s);
      advance();
      break;
    }
    case 'reject': {
      requireActive();
      requireFeedback(action.feedback);
      const s = requireCurrent(action.stageKey);
      if (s.status !== 'awaiting_approval') fail(`${s.key} isn't waiting for approval`);
      s.round += 1;
      kill(s);
      effects.push({ kind: 'writeFeedback', stageKey: s.key, round: s.round, text: action.feedback });
      queue(s, feedbackFile(s.key, s.round));
      break;
    }
    case 'sendBack': {
      if (t.status !== 'active' && t.status !== 'ready_to_ship') fail(`A ${t.status.replace(/_/g, ' ')} task can't send work back`);
      requireFeedback(action.feedback);
      const to = t.stages.findIndex((s) => s.key === action.toStageKey);
      const target = t.stages[to] ?? fail(`There's no ${action.toStageKey} stage`);
      if (target.status !== 'approved') fail(`${target.key} hasn't been approved, so there's nothing to send back to`);
      const cur = currentIndex(t);
      if (cur !== -1 && to > cur) fail(`${target.key} comes after the stage that runs now`);
      for (const s of t.stages.slice(to + 1)) {
        kill(s);
        if (s.status === 'skipped') continue;
        // Later stages start over: a fresh session, no approval.
        Object.assign(s, { status: 'pending', approvedHash: null, hasSession: false });
      }
      t.status = 'active';
      target.round += 1;
      target.approvedHash = null;
      effects.push({ kind: 'writeFeedback', stageKey: target.key, round: target.round, text: action.feedback });
      queue(target, feedbackFile(target.key, target.round));
      break;
    }
    case 'skip': {
      requireActive();
      const s = requireCurrent(action.stageKey);
      kill(s);
      s.status = 'skipped';
      advance();
      break;
    }
    case 'appRestart':
      for (const s of t.stages) {
        s.live = false;
        if (HOLDING.includes(s.status)) s.status = 'interrupted';
      }
      break;
    case 'pushed':
      if (t.status !== 'ready_to_ship') fail('Only a task that is ready to ship can be pushed');
      t.status = 'pushed';
      break;
    case 'finish':
      if (t.status !== 'pushed' && t.status !== 'ready_to_ship') fail('Only a pushed or ready-to-ship task can be marked done');
      t.status = 'done';
      effects.push({ kind: 'cleanup', keepBranch: true });
      break;
    case 'abandon':
      if (t.status === 'done' || t.status === 'abandoned') fail(`A ${t.status} task can't be abandoned`);
      for (const s of t.stages) {
        kill(s);
        if (HOLDING.includes(s.status)) s.status = 'interrupted';
      }
      t.status = 'abandoned';
      effects.push({ kind: 'cleanup', keepBranch: true });
      break;
  }
  return { task: t, effects };
}

/** Stages Send back can target: approved ones before the stage that runs now (any approved one once all are done). */
export function sendBackTargets(t: TaskState): string[] {
  const cur = currentIndex(t);
  return t.stages.filter((s, i) => s.status === 'approved' && (cur === -1 || i < cur)).map((s) => s.key);
}

/** The actions I can take now, which decide the buttons the task workspace shows. */
export function legalActions(t: TaskState): TaskActionType[] {
  const c = t.stages[currentIndex(t)];
  const back = sendBackTargets(t)[0];
  const probes: (Action | undefined)[] = [
    { type: 'startTask' },
    c && { type: 'launchStage', stageKey: c.key },
    c && { type: 'approve', stageKey: c.key, artifactHash: '' },
    c && { type: 'reject', stageKey: c.key, feedback: '?' },
    back !== undefined ? { type: 'sendBack', toStageKey: back, feedback: '?' } : undefined,
    c && { type: 'skip', stageKey: c.key },
    { type: 'pushed' },
    { type: 'finish' },
    { type: 'abandon' },
  ];
  return probes
    .filter((p): p is Action => {
      if (!p) return false;
      try {
        reduce(t, p);
        return true;
      } catch (e) {
        if (e instanceof IllegalAction) return false;
        throw e;
      }
    })
    .map((p) => p.type as TaskActionType);
}
