import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import s from './ui.module.css';

/** Icon, one-line title, one-line hint, optional action. Every view has one. */
export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>
        <Icon size={22} aria-hidden />
      </div>
      <div className={s.emptyTitle}>{title}</div>
      {hint && <div className={s.emptyHint}>{hint}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, style }: { width?: CSSProperties['width']; height?: number; style?: CSSProperties }) {
  return <div className={s.skeleton} style={{ width, height, ...style }} aria-hidden />;
}
