import { describe, expect, it } from 'vitest';
import { checkMove, deriveColumn, filterCards, LOCKED_REASON, needsRenormalize, NO_FILTERS, positionBetween, TASK_STATUSES, type Card } from './board';

describe('deriveColumn', () => {
  it('uses the stored column without a task', () => {
    expect(deriveColumn('backlog', null)).toBe('backlog');
    expect(deriveColumn('done', null)).toBe('done');
  });
  it('follows the task status, ignoring the stored column', () => {
    const expected = { draft: 'in_progress', active: 'in_progress', ready_to_ship: 'review', pushed: 'review', done: 'done', abandoned: 'todo' };
    for (const status of TASK_STATUSES) expect(deriveColumn('backlog', { status })).toBe(expected[status]);
  });
});

describe('positionBetween', () => {
  it('starts an empty column at 1', () => expect(positionBetween(undefined, undefined)).toBe(1));
  it('goes one past the end or one before the start', () => {
    expect(positionBetween(3, undefined)).toBe(4);
    expect(positionBetween(undefined, 1)).toBe(0);
  });
  it('takes the midpoint between neighbours', () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(-2, 0)).toBe(-1);
  });
  it('keeps order through many inserts at the same spot until the gap is tiny', () => {
    let above = 1;
    const below = 2;
    let inserts = 0;
    while (!needsRenormalize(above, below)) {
      const p = positionBetween(above, below);
      expect(p).toBeGreaterThan(above);
      expect(p).toBeLessThan(below);
      above = p;
      inserts++;
    }
    expect(inserts).toBeGreaterThan(15); // ~20 halvings of a gap of 1 before 1e-6
  });
});

describe('needsRenormalize', () => {
  it('only when both neighbours exist and are closer than 1e-6', () => {
    expect(needsRenormalize(1, 2)).toBe(false);
    expect(needsRenormalize(1, 1 + 1e-7)).toBe(true);
    expect(needsRenormalize(1, 1)).toBe(true);
    expect(needsRenormalize(undefined, 1)).toBe(false);
    expect(needsRenormalize(1, undefined)).toBe(false);
  });
});

describe('checkMove', () => {
  const free = { column: 'todo' as const, task: null };
  const withTask = { column: 'in_progress' as const, task: { id: 1, status: 'active' as const } };
  it('lets task-less cards move freely, except into In Progress', () => {
    expect(checkMove(free, 'backlog')).toEqual({ ok: true });
    expect(checkMove(free, 'review')).toEqual({ ok: true });
    expect(checkMove(free, 'done')).toEqual({ ok: true });
    expect(checkMove(free, 'in_progress')).toEqual({ ok: false, startTask: true });
  });
  it('always allows reordering within the current column', () => {
    expect(checkMove(free, 'todo')).toEqual({ ok: true });
    expect(checkMove(withTask, 'in_progress')).toEqual({ ok: true });
  });
  it('locks task cards to their derived column', () => {
    expect(checkMove(withTask, 'todo')).toEqual({ ok: false, reason: LOCKED_REASON });
    expect(checkMove(withTask, 'done')).toEqual({ ok: false, reason: LOCKED_REASON });
  });
});

describe('filterCards', () => {
  const card = (over: Partial<Card>): Card => ({
    id: 1,
    projectSlug: 'p',
    number: 1,
    key: 'PAY-1',
    title: 'Fix webhook retry storm',
    body: 'Retries pile up after a 500',
    column: 'todo',
    priority: 0,
    position: 1,
    archived: false,
    labelIds: [],
    task: null,
    commentCount: 0,
    attachmentCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });
  const cards = [
    card({ id: 1 }),
    card({ id: 2, key: 'PAY-2', title: 'Export CSV', body: '', priority: 3, labelIds: [10, 11] }),
    card({ id: 3, key: 'PAY-3', title: 'Old idea', archived: true }),
    card({ id: 4, key: 'PAY-4', title: 'Running', task: { id: 9, status: 'active' }, labelIds: [10] }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) => filterCards(cards, { ...NO_FILTERS, ...f }).map((c) => c.id);

  it('hides archived cards unless asked', () => {
    expect(ids({})).toEqual([1, 2, 4]);
    expect(ids({ showArchived: true })).toEqual([1, 2, 3, 4]);
  });
  it('searches key, title and body, every word, case-insensitively', () => {
    expect(ids({ text: 'pay-2' })).toEqual([2]);
    expect(ids({ text: 'WEBHOOK 500' })).toEqual([1]);
    expect(ids({ text: 'webhook csv' })).toEqual([]);
  });
  it('requires every selected label', () => {
    expect(ids({ labelIds: [10] })).toEqual([2, 4]);
    expect(ids({ labelIds: [10, 11] })).toEqual([2]);
  });
  it('filters by priority and task presence', () => {
    expect(ids({ priority: 3 })).toEqual([2]);
    expect(ids({ hasTask: 'yes' })).toEqual([4]);
    expect(ids({ hasTask: 'no' })).toEqual([1, 2]);
  });
});
