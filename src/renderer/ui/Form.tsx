import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { PALETTE, type PaletteName } from '@shared/palette';
import s from './ui.module.css';

/** Label + control + hint/error. The child receives the generated id via render prop. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <div id={`${id}-error`} className={s.error}>
          {error}
        </div>
      ) : (
        hint && (
          <div id={`${id}-hint`} className={s.hint}>
            {hint}
          </div>
        )
      )}
    </div>
  );
}

const cls = (base: string | undefined, props: { 'aria-invalid'?: unknown; className?: string }, mono?: boolean) =>
  [base, props['aria-invalid'] && s.invalid, mono && s.monoInput, props.className].filter(Boolean).join(' ');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input(
  { mono, ...props },
  ref,
) {
  return <input ref={ref} {...props} className={cls(s.input, props, mono)} spellCheck={props.spellCheck ?? false} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  function Textarea({ mono, ...props }, ref) {
    return <textarea ref={ref} rows={3} {...props} className={cls(s.textarea, props, mono)} spellCheck={props.spellCheck ?? false} />;
  },
);

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cls(s.select, props)} />;
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={s.switchRow}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={s.switch}
        onClick={() => onChange(!checked)}
      />
      <div>
        <label htmlFor={id} className={s.label}>
          {label}
        </label>
        {hint && <div className={s.hint}>{hint}</div>}
      </div>
    </div>
  );
}

export function ColorSwatches({ value, onChange, label }: { value: PaletteName; onChange: (c: PaletteName) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={s.swatches}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          title={c}
          className={s.swatch}
          style={{ background: `var(--${c})` }}
          onClick={() => onChange(c)}
        >
          {c === value && <Check size={14} strokeWidth={3} className={s.swatchCheck} aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/** The coloured square with a project's initial, used in the sidebar, palette and headers. */
export function ProjectMark({ name, color, size = 18 }: { name: string; color: PaletteName; size?: number }) {
  return (
    <span className={s.mark} style={{ width: size, height: size, background: `var(--${color})`, fontSize: Math.round(size * 0.55) }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
