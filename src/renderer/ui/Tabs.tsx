import { useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import s from './ui.module.css';

export interface TabItem<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

/** Accessible tab list: arrow keys / Home / End move between tabs (roving tabindex). */
export function Tabs<V extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = items.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next]!.value);
  };
  return (
    <div role="tablist" aria-label={label} className={s.tabs}>
      {items.map((t, i) => {
        const Icon = t.icon;
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={s.tab}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {t.label}
            {t.count !== undefined && <span className={s.tabCount}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
