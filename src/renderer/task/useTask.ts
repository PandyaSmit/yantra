import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileNode, TaskDetail, TaskProgress } from '@shared/tasks';
import { errorMessage } from '../actions';

/** One task, refetched when main reports a change to it. */
export function useTask(id: number) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const issueId = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const t = await window.api.invoke['tasks:get']({ id });
      if (mine === seq.current) {
        issueId.current = t.issueId;
        setTask(t);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    setTask(null);
    void refresh();
    const offs = [
      window.api.on('task:changed', (e) => e.taskId === id && void refresh()),
      // Issue edits change the title shown in the header.
      window.api.on('board:changed', (e) => e.issueId !== undefined && e.issueId === issueId.current && void refresh()),
    ];
    return () => offs.forEach((off) => off());
  }, [id, refresh]);

  return { task, error, refresh };
}

/** The task folder's tree. Refetched on demand, on task changes and when the window regains focus. */
export function useTaskFiles(id: number) {
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTree(await window.api.invoke['tasks:files']({ id }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    setTree(null);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const off = window.api.on('task:changed', (e) => e.taskId === id && void refresh());
    return () => {
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, [id, refresh]);

  return { tree, error, refresh };
}

export type StepState = TaskProgress['state'] | 'pending';

/** Creation progress and setup output for one issue, as main reports them. */
export function useCreationProgress(issueId: number | null) {
  const [steps, setSteps] = useState<Record<string, { state: StepState; detail?: string }>>({});
  const [log, setLog] = useState('');

  useEffect(() => {
    setSteps({});
    setLog('');
    if (issueId === null) return;
    const offs = [
      window.api.on('task:progress', (p) => p.issueId === issueId && setSteps((s) => ({ ...s, [p.step]: { state: p.state, detail: p.detail } }))),
      window.api.on('task:log', (l) => l.issueId === issueId && setLog((x) => (x + l.chunk).slice(-200_000))),
    ];
    return () => offs.forEach((off) => off());
  }, [issueId]);

  const reset = useCallback(() => {
    setSteps({});
    setLog('');
  }, []);
  return { steps, log, reset };
}
