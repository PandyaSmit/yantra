import s from './ui.module.css';

/** Renders a shortcut, e.g. <Kbd keys={['Ctrl', 'K']} />. */
export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className={s.kbdGroup}>
      {keys.map((k) => (
        <kbd key={k} className={s.kbd}>
          {k}
        </kbd>
      ))}
    </span>
  );
}
