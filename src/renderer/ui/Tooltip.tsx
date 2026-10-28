import type { ReactElement, ReactNode } from 'react';
import * as RT from '@radix-ui/react-tooltip';
import { Kbd } from './Kbd';
import s from './ui.module.css';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RT.Provider delayDuration={400} skipDelayDuration={200}>
    {children}
  </RT.Provider>
);

interface TooltipProps {
  content: ReactNode;
  shortcut?: string[];
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}

export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side={side} sideOffset={6} className={s.tooltip}>
          {content}
          {shortcut && <Kbd keys={shortcut} />}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
