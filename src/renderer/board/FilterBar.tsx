import { useEffect, useRef } from 'react';
import { Archive, ChevronDown, Search, Tag as TagIcon, X } from 'lucide-react';
import { isFiltering, NO_FILTERS, PRIORITIES, PRIORITY_LABEL, type BoardFilters, type LabelInfo } from '@shared/board';
import { Kbd, Menu, MenuItem, MenuSeparator } from '../ui';
import { store, useStore } from '../store';
import { LabelPicker } from './LabelPicker';
import { PriorityIcon } from './Priority';
import b from './board.module.css';

export const FOCUS_SEARCH_EVENT = 'yantra:focus-search';

export function useFilters(projectSlug: string): [BoardFilters, (patch: Partial<BoardFilters>) => void] {
  const filters = useStore((s) => s.filters[projectSlug] ?? NO_FILTERS);
  const set = (patch: Partial<BoardFilters>) =>
    store.set((s) => ({ filters: { ...s.filters, [projectSlug]: { ...(s.filters[projectSlug] ?? NO_FILTERS), ...patch } } }));
  return [filters, set];
}

const HAS_TASK_LABEL = { any: 'Any', yes: 'With a task', no: 'Without a task' } as const;

export function FilterBar({ projectSlug, labels, shown, total }: { projectSlug: string; labels: LabelInfo[]; shown: number; total: number }) {
  const [f, set] = useFilters(projectSlug);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      search.current?.focus();
      search.current?.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  const chosenLabels = labels.filter((l) => f.labelIds.includes(l.id));
  const active = isFiltering(f);

  return (
    <div className={b.filterBar} role="search">
      <label className={b.search}>
        <Search size={14} aria-hidden />
        <input
          ref={search}
          className={b.searchInput}
          placeholder="Filter issues"
          aria-label="Filter issues by key, title or description"
          value={f.text}
          spellCheck={false}
          onChange={(e) => set({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              set({ text: '' });
              e.currentTarget.blur();
            }
          }}
        />
        {f.text ? (
          <button type="button" className={b.searchClear} aria-label="Clear search" onClick={() => set({ text: '' })}>
            <X size={12} />
          </button>
        ) : (
          <Kbd keys={['/']} />
        )}
      </label>

      <LabelPicker
        labels={labels}
        selected={f.labelIds}
        onChange={(labelIds) => set({ labelIds })}
        trigger={
          <button type="button" className={b.filterButton} data-active={chosenLabels.length > 0 || undefined}>
            <TagIcon size={14} />
            {chosenLabels.length === 0 ? 'Labels' : chosenLabels.length === 1 ? chosenLabels[0]!.name : `${chosenLabels.length} labels`}
            <ChevronDown size={12} />
          </button>
        }
      />

      <Menu
        align="start"
        trigger={
          <button type="button" className={b.filterButton} data-active={f.priority !== null || undefined}>
            {f.priority !== null ? <PriorityIcon priority={f.priority} /> : null}
            {f.priority === null ? 'Priority' : PRIORITY_LABEL[f.priority]}
            <ChevronDown size={12} />
          </button>
        }
      >
        <MenuItem onSelect={() => set({ priority: null })} shortcut={f.priority === null ? '✓' : undefined}>
          Any priority
        </MenuItem>
        <MenuSeparator />
        {PRIORITIES.map((p) => (
          <MenuItem key={p} onSelect={() => set({ priority: p })} shortcut={f.priority === p ? '✓' : undefined}>
            <PriorityIcon priority={p} />
            {PRIORITY_LABEL[p]}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        align="start"
        trigger={
          <button type="button" className={b.filterButton} data-active={f.hasTask !== 'any' || undefined}>
            {f.hasTask === 'any' ? 'Task' : HAS_TASK_LABEL[f.hasTask]}
            <ChevronDown size={12} />
          </button>
        }
      >
        {(['any', 'yes', 'no'] as const).map((v) => (
          <MenuItem key={v} onSelect={() => set({ hasTask: v })} shortcut={f.hasTask === v ? '✓' : undefined}>
            {HAS_TASK_LABEL[v]}
          </MenuItem>
        ))}
      </Menu>

      <button
        type="button"
        className={b.filterButton}
        aria-pressed={f.showArchived}
        data-active={f.showArchived || undefined}
        onClick={() => set({ showArchived: !f.showArchived })}
      >
        <Archive size={14} />
        Archived
      </button>

      {active && (
        <>
          <span className={b.filterCount}>
            {shown} of {total}
          </span>
          <button type="button" className={b.filterClear} onClick={() => store.set((s) => ({ filters: { ...s.filters, [projectSlug]: NO_FILTERS } }))}>
            Clear
          </button>
        </>
      )}
    </div>
  );
}
