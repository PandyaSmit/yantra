import { useState, type ReactElement } from 'react';
import { Check, Plus } from 'lucide-react';
import type { LabelInfo } from '@shared/board';
import { PALETTE, type PaletteName } from '@shared/palette';
import { ColorSwatches, Input, Popover, useToast } from '../ui';
import { errorMessage } from '../actions';
import b from './board.module.css';

interface Props {
  trigger: ReactElement;
  labels: LabelInfo[];
  selected: number[];
  onChange: (ids: number[]) => void;
  /** When set, a label that doesn't exist yet can be created from the search text. */
  projectSlug?: string;
}

/** Search, toggle and (optionally) create labels. */
export function LabelPicker({ trigger, labels, selected, onChange, projectSlug }: Props) {
  return (
    <Popover trigger={trigger}>
      <LabelList labels={labels} selected={selected} onChange={onChange} projectSlug={projectSlug} />
    </Popover>
  );
}

function LabelList({ labels, selected, onChange, projectSlug }: Omit<Props, 'trigger'>) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<PaletteName>(PALETTE[(labels.length + 6) % PALETTE.length]!);
  const q = query.trim();
  const shown = labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
  const exact = labels.some((l) => l.name.toLowerCase() === q.toLowerCase());
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const create = async () => {
    if (!projectSlug || !q || exact) return;
    try {
      const label = await window.api.invoke['labels:upsert']({ projectSlug, name: q, color });
      onChange([...selected, label.id]);
      setQuery('');
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create the label', description: errorMessage(e) });
    }
  };

  return (
    <div className={b.labelPicker}>
      <Input
        autoFocus
        aria-label="Search labels"
        placeholder={projectSlug ? 'Search or create…' : 'Search labels…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const match = labels.find((l) => l.name.toLowerCase() === q.toLowerCase()) ?? (projectSlug ? undefined : shown.length === 1 ? shown[0] : undefined);
          if (match) toggle(match.id);
          else void create();
        }}
      />
      <div className={b.labelOptions} role="group" aria-label="Labels">
        {shown.map((l) => {
          const on = selected.includes(l.id);
          return (
            <button key={l.id} type="button" role="menuitemcheckbox" aria-checked={on} className={b.labelOption} onClick={() => toggle(l.id)}>
              <span className={b.labelCheck}>{on && <Check size={12} strokeWidth={3} />}</span>
              <span className={b.labelDot} style={{ background: `var(--${l.color})` }} />
              <span className={b.labelName}>{l.name}</span>
            </button>
          );
        })}
        {!shown.length && !q && <div className={b.labelEmpty}>{projectSlug ? 'No labels yet. Type a name to create one.' : 'No labels yet.'}</div>}
        {!shown.length && q && !projectSlug && <div className={b.labelEmpty}>No label matches.</div>}
      </div>
      {projectSlug && q && !exact && (
        <div className={b.labelCreate}>
          <ColorSwatches label="New label colour" value={color} onChange={setColor} />
          <button type="button" className={b.labelOption} onClick={create}>
            <Plus size={14} />
            Create <strong>{q}</strong>
          </button>
        </div>
      )}
    </div>
  );
}

/** Label chips, in the label list's order. */
export function LabelChips({ labels, ids, max }: { labels: LabelInfo[]; ids: number[]; max?: number }) {
  const chosen = labels.filter((l) => ids.includes(l.id));
  const shown = max ? chosen.slice(0, max) : chosen;
  if (!chosen.length) return null;
  return (
    <span className={b.chips}>
      {shown.map((l) => (
        <span key={l.id} className={b.chip} style={{ background: `var(--${l.color}-bg)`, color: `var(--${l.color}-fg)` }}>
          {l.name}
        </span>
      ))}
      {chosen.length > shown.length && <span className={b.chipMore}>+{chosen.length - shown.length}</span>}
    </span>
  );
}
