import { useState, type ReactNode } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button, IconButton } from './Button';
import s from './ui.module.css';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, icon, footer, wide, children }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={s.overlay} />
        <RD.Content className={[s.dialog, wide && s.dialogWide].filter(Boolean).join(' ')} aria-describedby={undefined}>
          <div className={s.dialogHeader}>
            {icon}
            <div>
              <RD.Title className={s.dialogTitle}>{title}</RD.Title>
              {description && <RD.Description className={s.dialogDescription}>{description}</RD.Description>}
            </div>
            <RD.Close asChild>
              <IconButton icon={X} label="Close" size="sm" className={s.dialogClose} />
            </RD.Close>
          </div>
          {children}
          {footer && <div className={s.dialogFooter}>{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Say what happens, in plain words: "The project leaves YANTRA. Its repo and data stay on disk." */
  consequence: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

/** Confirmation for destructive or hard-to-undo actions. The confirm button names the action. */
export function ConfirmDialog({ open, onOpenChange, title, consequence, confirmLabel, danger, onConfirm }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={consequence}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={confirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
