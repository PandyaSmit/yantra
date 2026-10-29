import { useEffect, useRef, useState } from 'react';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export const SAVE_LABEL: Record<SaveState, string> = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', error: 'Not saved' };

/**
 * Text that saves itself `delay` ms after typing stops, and once more on unmount if anything is
 * unsaved. A new `remote` value (a change from elsewhere) replaces the text only when there are
 * no unsaved edits here.
 */
export function useAutosave(remote: string, save: (text: string) => Promise<boolean>, delay = 600) {
  const [text, setText] = useState(remote);
  const [state, setState] = useState<SaveState>('saved');
  const saved = useRef(remote);
  const latest = useRef(text);
  latest.current = text;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (remote !== saved.current && latest.current === saved.current) {
      saved.current = remote;
      setText(remote);
    }
  }, [remote]);

  useEffect(() => {
    if (text === saved.current) return;
    setState('pending');
    const t = setTimeout(async () => {
      setState('saving');
      const ok = await saveRef.current(text);
      if (ok) saved.current = text;
      setState(!ok ? 'error' : latest.current === text ? 'saved' : 'pending');
    }, delay);
    return () => clearTimeout(t);
  }, [text, delay]);

  useEffect(
    () => () => {
      if (latest.current !== saved.current) void saveRef.current(latest.current);
    },
    [],
  );

  return { text, setText, state };
}
