import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
import s from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, disabled, className, children, type, ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 13 : 15;
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={[s.button, s[variant], size === 'sm' && s.sm, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={iconSize} className={s.spinner} aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} className={s.buttonIcon} aria-hidden />
      )}
      {children}
      {IconRight && <IconRight size={iconSize} className={s.buttonIcon} aria-hidden />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Required: becomes the tooltip and the accessible name. */
  label: string;
  shortcut?: string[];
  size?: 'sm' | 'md';
  active?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, size = 'md', active, tooltipSide, className, type, ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type ?? 'button'}
        aria-label={label}
        data-active={active || undefined}
        className={[s.iconButton, size === 'sm' && s.sm, className].filter(Boolean).join(' ')}
        {...rest}
      >
        <Icon size={size === 'sm' ? 14 : 16} aria-hidden />
      </button>
    </Tooltip>
  );
});

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>;
}
