import { describe, expect, it } from 'vitest';
import type { StageStatus } from '@shared/types';
import { IllegalAction, legalActions, reduce, sendBackTargets, type Action, type StageState, type TaskState } from './machine';

const stage = (key: string, status: StageStatus = 'pending', extra: Partial<StageState> = {}): StageState => ({
  key,
  status,
  round: 1,
  hasSession: status !== 'pending',
  live: ['running', 'idle', 'awaiting_approval'].includes(status),
  hasChecks: key === 'review',
  approvedHash: status === 'approved' ? `h-${key}` : null,
  ...extra,
});
const task = (status: TaskState['status'], ...stages: StageState[]): TaskState => ({ status, stages });
const standard = (...statuses: StageStatus[]) =>
  task('active', ...['research', 'plan', 'code', 'review'].map((k, i) => stage(k, statuses[i] ?? 'pending')));
const statuses = (t: TaskState) => t.stages.map((s) => s.status);
const illegal = (t: TaskState, a: Action) => expect(() => reduce(t, a)).toThrow(IllegalAction);

describe('starting and launching', () => {
  it('startTask: draft → active, the first stage queued and spawned fresh', () => {
    const { task: t, effects } = reduce(task('draft', stage('research'), stage('plan')), { type: 'startTask' });
    expect(t.status).toBe('active');
    expect(statuses(t)).toEqual(['queued', 'pending']);
    expect(effects).toEqual([{ kind: 'spawn', stageKey: 'research', mode: 'start' }]);
    illegal(t, { type: 'startTask' });
  });

  it('launchStage: pending starts, interrupted resumes, and checks run only before a fresh start', () => {
    const review = standard('approved', 'approved', 'approved', 'pending');
    expect(reduce(review, { type: 'launchStage', stageKey: 'review' }).effects).toEqual([
      { kind: 'runChecks', stageKey: 'review' },
      { kind: 'spawn', stageKey: 'review', mode: 'start' },
    ]);
    const interrupted = standard('approved', 'approved', 'approved', 'interrupted');
    expect(reduce(interrupted, { type: 'launchStage', stageKey: 'review' }).effects).toEqual([{ kind: 'spawn', stageKey: 'review', mode: 'resume' }]);
  });

  it('launchStage: only the current stage, only when it is not already holding a session', () => {
    illegal(standard('pending'), { type: 'launchStage', stageKey: 'plan' });
    illegal(standard('running'), { type: 'launchStage', stageKey: 'research' });
    illegal(task('draft', stage('research')), { type: 'launchStage', stageKey: 'research' });
    // Awaiting approval with no PTY (after End session) can be reopened; with one it can't.
    const ended = task('active', stage('research', 'awaiting_approval', { live: false }));
    expect(statuses(reduce(ended, { type: 'launchStage', stageKey: 'research' }).task)).toEqual(['queued']);
    illegal(standard('awaiting_approval'), { type: 'launchStage', stageKey: 'research' });
  });

  it('slotFree: queued → running', () => {
    const t = reduce(standard('queued'), { type: 'slotFree', stageKey: 'research' }).task;
    expect(t.stages[0]).toMatchObject({ status: 'running', live: true });
    illegal(t, { type: 'slotFree', stageKey: 'research' });
  });
});

describe('hooks', () => {
  const hook = (event: 'UserPromptSubmit' | 'Stop' | 'SessionEnd', o: { artifactReady?: boolean; backgroundRunning?: boolean } = {}): Action => ({
    type: 'hook',
    event,
    stageKey: 'research',
    artifactReady: o.artifactReady ?? false,
    backgroundRunning: o.backgroundRunning ?? false,
  });

  it('Stop with background work keeps running; without, idle or awaiting approval (notified once)', () => {
    expect(statuses(reduce(standard('running'), hook('Stop', { backgroundRunning: true, artifactReady: true })).task)[0]).toBe('running');
    expect(statuses(reduce(standard('running'), hook('Stop')).task)[0]).toBe('idle');
    const ready = reduce(standard('running'), hook('Stop', { artifactReady: true }));
    expect(ready.task.stages[0]!.status).toBe('awaiting_approval');
    expect(ready.effects).toEqual([{ kind: 'notify', reason: 'awaiting_approval', stageKey: 'research' }]);
    expect(reduce(ready.task, hook('Stop', { artifactReady: true })).effects).toEqual([]);
  });

  it('UserPromptSubmit runs again; SessionEnd and lines for a finished stage change nothing', () => {
    expect(statuses(reduce(standard('awaiting_approval'), hook('UserPromptSubmit')).task)[0]).toBe('running');
    expect(statuses(reduce(standard('idle'), hook('SessionEnd')).task)[0]).toBe('idle');
    expect(statuses(reduce(standard('approved'), hook('UserPromptSubmit')).task)[0]).toBe('approved');
  });
});

describe('approve, reject, send back, skip', () => {
  it('approve: snapshot, end the session, launch the next stage', () => {
    const { task: t, effects } = reduce(standard('awaiting_approval'), { type: 'approve', stageKey: 'research', artifactHash: 'abc' });
    expect(statuses(t)).toEqual(['approved', 'queued', 'pending', 'pending']);
    expect(t.stages[0]!.approvedHash).toBe('abc');
    expect(effects).toEqual([
      { kind: 'snapshotArtifact', stageKey: 'research' },
      { kind: 'kill', stageKey: 'research' },
      { kind: 'spawn', stageKey: 'plan', mode: 'start' },
    ]);
  });

  it('approve skips over skipped stages, and approving the last stage makes the task ready to ship', () => {
    const t = standard('approved', 'skipped', 'awaiting_approval');
    expect(reduce(t, { type: 'approve', stageKey: 'code', artifactHash: 'c' }).effects.at(-1)).toEqual({ kind: 'spawn', stageKey: 'review', mode: 'start' });
    const last = reduce(standard('approved', 'approved', 'approved', 'awaiting_approval'), { type: 'approve', stageKey: 'review', artifactHash: 'r' });
    expect(last.task.status).toBe('ready_to_ship');
    expect(last.effects).toEqual([
      { kind: 'snapshotArtifact', stageKey: 'review' },
      { kind: 'kill', stageKey: 'review' },
    ]);
  });

  it('approve is only legal from awaiting approval, on the current stage', () => {
    illegal(standard('idle'), { type: 'approve', stageKey: 'research', artifactHash: 'x' });
    illegal(standard('awaiting_approval'), { type: 'approve', stageKey: 'plan', artifactHash: 'x' });
  });

  it('reject: feedback file for round N+1, then the same session resumes with it', () => {
    const { task: t, effects } = reduce(standard('approved', 'awaiting_approval'), { type: 'reject', stageKey: 'plan', feedback: 'Smaller steps' });
    expect(t.stages[1]).toMatchObject({ status: 'queued', round: 2 });
    expect(effects).toEqual([
      { kind: 'kill', stageKey: 'plan' },
      { kind: 'writeFeedback', stageKey: 'plan', round: 2, text: 'Smaller steps' },
      { kind: 'spawn', stageKey: 'plan', mode: 'resume', feedbackFile: 'feedback/plan-round-2.md' },
    ]);
    illegal(standard('approved', 'awaiting_approval'), { type: 'reject', stageKey: 'plan', feedback: '  ' });
    illegal(standard('approved', 'running'), { type: 'reject', stageKey: 'plan', feedback: 'x' });
  });

  it('sendBack from Review to Code: Code round+1 resumes; Review starts over fresh', () => {
    const t = standard('approved', 'approved', 'approved', 'awaiting_approval');
    expect(sendBackTargets(t)).toEqual(['research', 'plan', 'code']);
    const { task: next, effects } = reduce(t, { type: 'sendBack', toStageKey: 'code', feedback: 'Handle the 429 case' });
    expect(statuses(next)).toEqual(['approved', 'approved', 'queued', 'pending']);
    expect(next.stages[2]).toMatchObject({ round: 2, approvedHash: null });
    expect(next.stages[3]).toMatchObject({ hasSession: false, approvedHash: null, round: 1 });
    expect(effects).toEqual([
      { kind: 'kill', stageKey: 'review' },
      { kind: 'writeFeedback', stageKey: 'code', round: 2, text: 'Handle the 429 case' },
      { kind: 'spawn', stageKey: 'code', mode: 'resume', feedbackFile: 'feedback/code-round-2.md' },
    ]);
  });

  it('sendBack resets every later stage and clears their approvals, keeping skips; legal from ready to ship', () => {
    const t = task('ready_to_ship', stage('research', 'approved'), stage('plan', 'approved'), stage('code', 'approved'), stage('review', 'skipped'));
    const next = reduce(t, { type: 'sendBack', toStageKey: 'plan', feedback: 'Wrong approach' }).task;
    expect(next.status).toBe('active');
    expect(statuses(next)).toEqual(['approved', 'queued', 'pending', 'skipped']);
    expect(next.stages[2]!.approvedHash).toBeNull();
  });

  it('sendBack only targets an approved stage before the current one', () => {
    const t = standard('approved', 'skipped', 'awaiting_approval');
    expect(sendBackTargets(t)).toEqual(['research']);
    illegal(t, { type: 'sendBack', toStageKey: 'plan', feedback: 'x' });
    illegal(t, { type: 'sendBack', toStageKey: 'review', feedback: 'x' });
    illegal(task('draft', stage('research', 'approved')), { type: 'sendBack', toStageKey: 'research', feedback: 'x' });
  });

  it('skip: ends a live session and moves on; skipping the last stage makes the task ready to ship', () => {
    const { task: t, effects } = reduce(standard('approved', 'idle'), { type: 'skip', stageKey: 'plan' });
    expect(statuses(t)).toEqual(['approved', 'skipped', 'queued', 'pending']);
    expect(effects).toEqual([
      { kind: 'kill', stageKey: 'plan' },
      { kind: 'spawn', stageKey: 'code', mode: 'start' },
    ]);
    expect(reduce(standard('approved', 'approved', 'approved', 'pending'), { type: 'skip', stageKey: 'review' }).task.status).toBe('ready_to_ship');
    illegal(standard('pending'), { type: 'skip', stageKey: 'plan' });
  });

  it('a queued stage that is skipped leaves the queue', () => {
    expect(reduce(standard('queued'), { type: 'skip', stageKey: 'research' }).effects[0]).toEqual({ kind: 'kill', stageKey: 'research' });
  });
});

describe('restart, ship, done, abandon', () => {
  it('appRestart: running, idle and queued become interrupted; nothing restarts', () => {
    const t = task('active', stage('a', 'approved'), stage('b', 'running'), stage('c', 'queued'));
    const r = reduce(t, { type: 'appRestart' });
    expect(statuses(r.task)).toEqual(['approved', 'interrupted', 'interrupted']);
    expect(r.effects).toEqual([]);
    expect(statuses(reduce(standard('idle'), { type: 'appRestart' }).task)[0]).toBe('interrupted');
  });

  it('pushed and finish', () => {
    const ready = task('ready_to_ship', stage('code', 'approved'));
    const pushed = reduce(ready, { type: 'pushed' }).task;
    expect(pushed.status).toBe('pushed');
    expect(reduce(pushed, { type: 'finish' })).toEqual({ task: { ...pushed, status: 'done' }, effects: [{ kind: 'cleanup', keepBranch: true }] });
    expect(reduce(ready, { type: 'finish' }).task.status).toBe('done');
    illegal(standard('running'), { type: 'pushed' });
    illegal(standard('running'), { type: 'finish' });
  });

  it('abandon: anything but done; live sessions end', () => {
    const r = reduce(standard('approved', 'running'), { type: 'abandon' });
    expect(r.task.status).toBe('abandoned');
    expect(r.effects).toEqual([
      { kind: 'kill', stageKey: 'plan' },
      { kind: 'cleanup', keepBranch: true },
    ]);
    illegal(task('done', stage('code', 'approved')), { type: 'abandon' });
    illegal(r.task, { type: 'abandon' });
  });

  it('never mutates its input', () => {
    const t = standard('awaiting_approval');
    const copy = structuredClone(t);
    reduce(t, { type: 'approve', stageKey: 'research', artifactHash: 'x' });
    expect(t).toEqual(copy);
  });
});

describe('legalActions', () => {
  it('drives the buttons', () => {
    expect(legalActions(task('draft', stage('research')))).toEqual(['startTask', 'abandon']);
    expect(legalActions(standard('running'))).toEqual(['skip', 'abandon']);
    expect(legalActions(standard('interrupted'))).toEqual(['launchStage', 'skip', 'abandon']);
    expect(legalActions(standard('approved', 'awaiting_approval'))).toEqual(['approve', 'reject', 'sendBack', 'skip', 'abandon']);
    expect(legalActions(task('ready_to_ship', stage('code', 'approved')))).toEqual(['sendBack', 'pushed', 'finish', 'abandon']);
    expect(legalActions(task('done', stage('code', 'approved')))).toEqual([]);
  });
});
