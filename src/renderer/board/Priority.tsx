import { CircleAlert, Minus, SignalHigh, SignalLow, SignalMedium, type LucideIcon } from 'lucide-react';
import { PRIORITIES, PRIORITY_LABEL, type Priority } from '@shared/board';
import { Menu, MenuItem } from '../ui';
import b from './board.module.css';

const ICON: Record<Priority, { icon: LucideIcon; color: string }> = {
  0: { icon: Minus, color: 'var(--text-faint)' },
  1: { icon: SignalLow, color: 'var(--text-muted)' },
  2: { icon: SignalMedium, color: 'var(--text-muted)' },
  3: { icon: SignalHigh, color: 'var(--text)' },
  4: { icon: CircleAlert, color: 'var(--danger)' },
};

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const { icon: Icon, color } = ICON[priority];
  return <Icon size={size} color={color} strokeWidth={priority === 4 ? 2.4 : 2} aria-label={PRIORITY_LABEL[priority]} role="img" />;
}

/** A pill that opens a priority menu. */
export function PriorityMenu({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className={b.propPill} aria-label={`Priority: ${PRIORITY_LABEL[value]}`}>
          <PriorityIcon priority={value} />
          {PRIORITY_LABEL[value]}
        </button>
      }
    >
      {PRIORITIES.map((p) => (
        <MenuItem key={p} onSelect={() => onChange(p)} shortcut={p === value ? '✓' : undefined}>
          <PriorityIcon priority={p} />
          {PRIORITY_LABEL[p]}
        </MenuItem>
      ))}
    </Menu>
  );
}
