import type { ReactNode } from 'react';
import { Bell, Check, Circle, CircleAlert, Clock, Pause, SkipForward, type LucideIcon } from 'lucide-react';
import type { PaletteName } from '@shared/palette';
import type { StageStatus } from '@shared/types';
import s from './ui.module.css';

/** A palette-coloured chip, used for labels and keys. */
export function Badge({ color = 'slate', dot, children }: { color?: PaletteName; dot?: boolean; children: ReactNode }) {
  return (
    <span className={s.badge} style={{ background: `var(--${color}-bg)`, color: `var(--${color}-fg)` }}>
      {dot && <span className={s.badgeDot} />}
      {children}
    </span>
  );
}

/** The status language from SPEC.md: one colour, icon and label per stage status, used everywhere. */
export const STATUS_STYLE: Record<StageStatus, { label: string; color: string; soft: string; icon: LucideIcon | 'dot' }> = {
  pending: { label: 'Not started', color: 'var(--text-muted)', soft: 'var(--hover)', icon: Circle },
  queued: { label: 'Queued', color: 'var(--text-muted)', soft: 'var(--hover)', icon: Clock },
  running: { label: 'Running', color: 'var(--running)', soft: 'var(--running-soft)', icon: 'dot' },
  idle: { label: 'Idle', color: 'var(--idle)', soft: 'var(--idle-soft)', icon: Pause },
  awaiting_approval: { label: 'Needs you', color: 'var(--needs-you)', soft: 'var(--needs-you-soft)', icon: Bell },
  approved: { label: 'Approved', color: 'var(--ok)', soft: 'var(--ok-soft)', icon: Check },
  skipped: { label: 'Skipped', color: 'var(--text-muted)', soft: 'var(--hover)', icon: SkipForward },
  interrupted: { label: 'Interrupted', color: 'var(--danger)', soft: 'var(--danger-soft)', icon: CircleAlert },
};

export function StatusIcon({ status, size = 12 }: { status: StageStatus; size?: number }) {
  const st = STATUS_STYLE[status];
  if (st.icon === 'dot')
    return (
      <span
        className={s.pulse}
        style={{ width: size - 4, height: size - 4, borderRadius: 999, background: st.color, display: 'inline-block' }}
        aria-hidden
      />
    );
  const Icon = st.icon;
  return <Icon size={size} color={st.color} strokeWidth={2.4} aria-hidden />;
}

export function Pill({ status, children }: { status: StageStatus; children?: ReactNode }) {
  const st = STATUS_STYLE[status];
  return (
    <span className={s.pill} style={{ background: st.soft, color: st.color }}>
      <StatusIcon status={status} />
      {children ?? st.label}
    </span>
  );
}

/** A neutral pill for non-stage states (task status, "Draft"…). */
export function Tag({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  const map = {
    neutral: ['var(--hover)', 'var(--text-muted)'],
    accent: ['var(--accent-soft)', 'var(--accent)'],
    ok: ['var(--ok-soft)', 'var(--ok)'],
    warn: ['var(--needs-you-soft)', 'var(--needs-you)'],
    danger: ['var(--danger-soft)', 'var(--danger)'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <span className={s.pill} style={{ background: bg, color: fg, paddingLeft: 8 }}>
      {children}
    </span>
  );
}
