import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardData, IssueDetail } from '@shared/board';
import { errorMessage } from '../actions';

/** A project's board, refetched whenever main reports a change for that project. */
export function useBoard(projectSlug: string) {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await window.api.invoke['board:list']({ projectSlug });
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    }
  }, [projectSlug]);

  useEffect(() => {
    setData(null);
    void refresh();
    return window.api.on('board:changed', (e) => {
      if (e.projectSlug === projectSlug) void refresh();
    });
  }, [projectSlug, refresh]);

  return { data, setData, error, refresh };
}

/** One issue with comments, attachments and task history; refetched on changes to that project. */
export function useIssue(id: number, projectSlug: string | undefined) {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIssue(await window.api.invoke['issues:get']({ id }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    setIssue(null);
    void refresh();
    return window.api.on('board:changed', (e) => {
      if (e.issueId === id || (e.issueId === undefined && e.projectSlug === projectSlug)) void refresh();
    });
  }, [id, projectSlug, refresh]);

  return { issue, error, refresh };
}
