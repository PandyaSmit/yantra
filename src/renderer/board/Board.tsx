import { useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { FileText, Lightbulb, MoreHorizontal, Plus, RefreshCw, SearchX, Tags, X } from 'lucide-react';
import { checkMove, COLUMN_LABEL, COLUMNS, filterCards, isFiltering, LOCKED_REASON, NO_FILTERS, type Card, type ColumnKey } from '@shared/board';
import type { Project } from '@shared/schemas';
import { Button, EmptyState, IconButton, Kbd, Menu, MenuItem, Skeleton, Tooltip, useToast } from '../ui';
import { errorMessage, reloadConfig } from '../actions';
import { store, useStore } from '../store';
import { Column } from './Column';
import { FilterBar, useFilters } from './FilterBar';
import { CardView } from './IssueCard';
import { IssueDrawer } from './IssueDrawer';
import { LabelsDialog } from './LabelsDialog';
import { NewIssueDialog } from './NewIssueDialog';
import { StartTaskDialog } from './StartTaskDialog';
import { useBoard } from './useBoard';
import b from './board.module.css';

type Lists = Record<ColumnKey, number[]>;
const TIP_KEY = 'yantra.tip.dragToStart';

// Left/Right jump to the top of the neighbouring column; the sortable default runs closestCorners
// over everything to that side and can skip past an empty column. Up/Down keep the sortable default.
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  const { collisionRect, droppableRects } = args.context;
  if (!step || !collisionRect) return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const rects = COLUMNS.map((c) => droppableRects.get(`col:${c}`));
  const mid = collisionRect.left + collisionRect.width / 2;
  const here = rects.findIndex((r) => r && mid >= r.left && mid <= r.right);
  const next = rects[(here < 0 ? 0 : here) + step];
  return next ? { x: next.left + 8, y: next.top + 8 } : args.currentCoordinates;
};

const group = (cards: Card[]): Lists => {
  const lists = Object.fromEntries(COLUMNS.map((c) => [c, [] as number[]])) as Lists;
  for (const c of cards) lists[c.column].push(c.id);
  return lists;
};

export function Board() {
  const project = useStore((s) => s.config?.projects.find((p) => p.slug === s.route.project));
  if (!project) return null;
  return <ProjectBoard key={project.slug} project={project} />;
}

function ProjectBoard({ project }: { project: Project }) {
  const toast = useToast();
  const { data, error, refresh } = useBoard(project.slug);
  const [refreshing, setRefreshing] = useState(false);
  const [filters] = useFilters(project.slug);
  const openId = useStore((s) => s.route.issue);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [startTask, setStartTask] = useState<Card | null>(null);
  const [tip, setTip] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== 'dismissed';
    } catch {
      return true;
    }
  });

  // While dragging (and until main confirms the drop) the board shows these lists instead of the data.
  const [lists, setLists] = useState<Lists | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  const cards = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const visible = useMemo(() => filterCards(data?.cards ?? [], filters), [data, filters]);
  const base = useMemo(() => group(visible), [visible]);
  const totals = useMemo(() => group((data?.cards ?? []).filter((c) => !c.archived || filters.showArchived)), [data, filters.showArchived]);
  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of data?.cards ?? []) for (const l of c.labelIds) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  }, [data]);
  const shown = lists ?? base;
  const labels = data?.labels ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  // Pick the column first (pointer inside it, else largest overlap), then the nearest card in it.
  // Plain closestCorners loses to nearby cards when the target column is tall and empty.
  const collision: CollisionDetection = (args) => {
    const columns = args.droppableContainers.filter((c) => typeof c.id === 'string' && c.id.startsWith('col:'));
    const byPointer = pointerWithin({ ...args, droppableContainers: columns });
    const hit = (byPointer.length ? byPointer : rectIntersection({ ...args, droppableContainers: columns }))[0];
    if (!hit) return [];
    const ids = shown[(hit.id as string).slice(4) as ColumnKey];
    const inColumn = args.droppableContainers.filter((c) => typeof c.id === 'number' && ids.includes(c.id));
    return inColumn.length ? closestCenter({ ...args, droppableContainers: inColumn }) : [hit];
  };

  const columnOf = (id: UniqueIdentifier, from: Lists): ColumnKey | undefined => {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4) as ColumnKey;
    return COLUMNS.find((c) => from[c].includes(id as number));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !lists) return;
    const from = columnOf(active.id, lists);
    const to = columnOf(over.id, lists);
    const card = cards.get(active.id as number);
    if (!from || !to || from === to || !card) return;
    const check = checkMove(card, to);
    if (!check.ok && 'reason' in check) return; // task cards stay in their column
    setLists((prev) => {
      if (!prev) return prev;
      const target = prev[to].filter((x) => x !== card.id);
      const at = typeof over.id === 'number' ? target.indexOf(over.id) : -1;
      target.splice(at >= 0 ? at : target.length, 0, card.id);
      return { ...prev, [from]: prev[from].filter((x) => x !== card.id), [to]: target };
    });
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const card = cards.get(active.id as number);
    if (!over || !lists || !card) return setLists(null);

    const col = columnOf(active.id, lists)!;
    const overCol = columnOf(over.id, lists);
    if (card.task && overCol && overCol !== card.column) toast({ title: `${card.key} stays in ${COLUMN_LABEL[card.column]}`, description: LOCKED_REASON });

    let list = lists[col];
    if (overCol === col && typeof over.id === 'number' && over.id !== card.id) list = arrayMove(list, list.indexOf(card.id), list.indexOf(over.id));
    const finalLists = { ...lists, [col]: list };
    const i = list.indexOf(card.id);
    const afterId = list[i - 1];
    const beforeId = list[i + 1];

    const check = checkMove(card, col);
    if (!check.ok) {
      if ('startTask' in check) {
        setLists(finalLists);
        setStartTask(card);
      } else setLists(null);
      return;
    }
    const b0 = base[col];
    if (col === card.column && b0[b0.indexOf(card.id) - 1] === afterId && b0[b0.indexOf(card.id) + 1] === beforeId) return setLists(null);

    setLists(finalLists);
    try {
      await window.api.invoke['issues:move']({ issueId: card.id, toColumn: col, afterId, beforeId });
      await refresh();
    } catch (e) {
      toast({ tone: 'error', title: `Could not move ${card.key}`, description: errorMessage(e) });
    } finally {
      setLists(null);
    }
  };

  const keyOf = (id: UniqueIdentifier) => cards.get(id as number)?.key ?? 'card';
  const where = (id: UniqueIdentifier | undefined) => {
    if (id === undefined || !lists) return '';
    const col = columnOf(id, lists);
    return col ? ` over ${COLUMN_LABEL[col]}` : '';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${keyOf(active.id)}. Arrow keys move it, Space drops it, Escape cancels.`,
    onDragOver: ({ active, over }) => `${keyOf(active.id)} is${where(over?.id) || ' not over a column'}.`,
    onDragEnd: ({ active, over }) => `Dropped ${keyOf(active.id)}${where(over?.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${keyOf(active.id)} went back.`,
  };

  const dismissTip = () => {
    setTip(false);
    try {
      localStorage.setItem(TIP_KEY, 'dismissed');
    } catch {
      /* convenience only */
    }
  };

  const activeCard = activeId !== null ? cards.get(activeId) : undefined;
  const nothingYet = data !== null && data.cards.length === 0;
  const noMatches = data !== null && !nothingYet && visible.length === 0 && isFiltering(filters);

  return (
    <div className={b.board}>
      <div className={b.header}>
        <span className={b.strip} style={{ background: `var(--${project.color})` }} />
        <div className={b.headerText}>
          <h1 className={b.title}>{project.name}</h1>
          <div className={b.meta}>
            <span className="mono">{project.key}</span> · {project.defaultBranch} · <span className="mono">{project.repoPath}</span>
          </div>
        </div>
        <div className={b.headerActions}>
          <IconButton
            icon={RefreshCw}
            label="Refresh board"
            className={refreshing ? b.spinning : undefined}
            onClick={() => {
              setRefreshing(true);
              void Promise.all([refresh(), reloadConfig()]).finally(() => setTimeout(() => setRefreshing(false), 400));
            }}
          />
          <Menu trigger={<IconButton icon={MoreHorizontal} label="Board options" />}>
            <MenuItem icon={Tags} onSelect={() => setLabelsOpen(true)}>
              Manage labels
            </MenuItem>
          </Menu>
          <Tooltip content="New issue" shortcut={['C']}>
            <Button variant="primary" icon={Plus} onClick={() => store.set({ newIssue: { column: 'backlog' } })}>
              New issue
            </Button>
          </Tooltip>
        </div>
      </div>

      <FilterBar projectSlug={project.slug} labels={labels} shown={visible.length} total={data?.cards.length ?? 0} />

      {tip && !nothingYet && (
        <div className={b.tip}>
          <Lightbulb size={16} />
          <span>
            Drag a card to <strong>In Progress</strong> to start a task. With the keyboard: focus a card, <Kbd keys={['Space']} />, arrows,{' '}
            <Kbd keys={['Space']} />.
          </span>
          <IconButton icon={X} label="Dismiss tip" size="sm" onClick={dismissTip} />
        </div>
      )}

      {error && !data && <EmptyState icon={SearchX} title="Couldn't load the board" hint={error} action={<Button onClick={() => void refresh()}>Try again</Button>} />}

      {!error || data ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          accessibility={{ announcements }}
          onDragStart={({ active }) => {
            setActiveId(active.id as number);
            setLists(base);
          }}
          onDragOver={onDragOver}
          onDragEnd={(e) => void onDragEnd(e)}
          onDragCancel={() => {
            setActiveId(null);
            setLists(null);
          }}
        >
          <div className={b.columns}>
            {data
              ? COLUMNS.map((col) => (
                  <Column
                    key={col}
                    column={col}
                    ids={shown[col]}
                    cards={cards}
                    labels={labels}
                    projectSlug={project.slug}
                    openId={openId}
                    total={totals[col].length}
                    filtering={isFiltering({ ...filters, showArchived: false })}
                  />
                ))
              : COLUMNS.map((col) => (
                  <section key={col} className={b.column} aria-busy>
                    <header className={b.columnHeader}>
                      <Skeleton width={80} />
                    </header>
                    <div className={b.columnBody}>
                      <Skeleton height={64} />
                      <Skeleton height={64} />
                    </div>
                  </section>
                ))}
            {nothingYet && (
              <div className={b.boardEmpty}>
                <EmptyState
                  icon={FileText}
                  title="No issues yet"
                  hint={
                    <>
                      Press <Kbd keys={['C']} /> to write one, or use Add issue under a column.
                    </>
                  }
                  action={
                    <Button variant="primary" icon={Plus} onClick={() => store.set({ newIssue: { column: 'backlog' } })}>
                      New issue
                    </Button>
                  }
                />
              </div>
            )}
            {noMatches && (
              <div className={b.boardEmpty}>
                <EmptyState
                  icon={SearchX}
                  title="No issues match"
                  hint="Try fewer filters."
                  action={<Button onClick={() => store.set((s) => ({ filters: { ...s.filters, [project.slug]: NO_FILTERS } }))}>Clear filters</Button>}
                />
              </div>
            )}
          </div>
          <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activeCard ? <CardView card={activeCard} labels={labels} overlay /> : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {openId !== undefined && (
        <IssueDrawer id={openId} project={project} labels={labels} onStartTask={(c) => setStartTask(c)} />
      )}
      <NewIssueDialog project={project} labels={labels} />
      <LabelsDialog open={labelsOpen} onOpenChange={setLabelsOpen} projectSlug={project.slug} labels={labels} usage={usage} />
      <StartTaskDialog
        card={startTask}
        onClose={() => {
          setStartTask(null);
          setLists(null); // a dragged card goes back where it was
        }}
      />
    </div>
  );
}
