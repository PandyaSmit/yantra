import type { ReactElement, ReactNode } from 'react';
import * as RM from '@radix-ui/react-dropdown-menu';
import * as RP from '@radix-ui/react-popover';
import type { LucideIcon } from 'lucide-react';
import s from './ui.module.css';

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactElement; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <RM.Root>
      <RM.Trigger asChild>{trigger}</RM.Trigger>
      <RM.Portal>
        <RM.Content align={align} sideOffset={6} className={s.menu}>
          {children}
        </RM.Content>
      </RM.Portal>
    </RM.Root>
  );
}

export function MenuItem({
  icon: Icon,
  danger,
  shortcut,
  disabled,
  onSelect,
  children,
}: {
  icon?: LucideIcon;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <RM.Item
      className={[s.menuItem, danger && s.menuItemDanger].filter(Boolean).join(' ')}
      disabled={disabled}
      onSelect={onSelect}
    >
      {Icon && <Icon size={14} aria-hidden />}
      {children}
      {shortcut && <span className={s.menuShortcut}>{shortcut}</span>}
    </RM.Item>
  );
}

export const MenuSeparator = () => <RM.Separator className={s.menuSeparator} />;

export function Popover({ trigger, children, side = 'bottom' }: { trigger: ReactElement; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content side={side} sideOffset={6} className={s.popover}>
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
