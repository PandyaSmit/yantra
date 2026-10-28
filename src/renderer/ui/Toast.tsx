import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Button, IconButton } from './Button';
import s from './ui.module.css';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
  /** ms; errors stay a little longer. */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(ToastContext);

const ICON = {
  info: <Info size={16} color="var(--accent)" />,
  success: <CircleCheck size={16} color="var(--ok)" />,
  error: <CircleAlert size={16} color="var(--danger)" />,
};

/** Stacked bottom-right, above the status bar. Auto-dismiss after 5 s (8 s for errors); hovering pauses. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback(
    (t: ToastItem) => {
      const ms = t.duration ?? (t.tone === 'error' ? 8000 : 5000);
      timers.current.set(t.id, setTimeout(() => dismiss(t.id), ms));
    },
    [dismiss],
  );

  const push = useCallback(
    (t: ToastInput) => {
      const item = { ...t, id: nextId.current++ };
      setItems((xs) => [...xs.slice(-3), item]);
      schedule(item);
    },
    [schedule],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={s.toasts} role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={s.toast}
            onMouseEnter={() => clearTimeout(timers.current.get(t.id))}
            onMouseLeave={() => schedule(t)}
          >
            <span className={s.toastIcon}>{ICON[t.tone ?? 'info']}</span>
            <div className={s.toastBody}>
              <div className={s.toastTitle}>{t.title}</div>
              {t.description && <div className={s.toastDescription}>{t.description}</div>}
              {t.action && (
                <div className={s.toastAction}>
                  <Button
                    size="sm"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </Button>
                </div>
              )}
            </div>
            <IconButton icon={X} label="Dismiss" size="sm" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
