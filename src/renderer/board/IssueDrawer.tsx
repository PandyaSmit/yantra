import { useEffect, useRef, useState, type DragEvent } from 'react';
import * as RD from '@radix-ui/react-dialog';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  ChevronDown,
  Copy,
  File,
  FolderOpen,
  MoreHorizontal,
  Paperclip,
  Play,
  Tag as TagIcon,
  Trash,
  Upload,
  X,
} from 'lucide-react';
import { checkMove, COLUMN_LABEL, COLUMNS, type Card, type IssueDetail, type LabelInfo, type UpdateIssue } from '@shared/board';
import type { Project } from '@shared/schemas';
import { Button, ConfirmDialog, EmptyState, IconButton, Kbd, Markdown, Menu, MenuItem, MenuSeparator, Skeleton, Tabs, Tag, Textarea, Tooltip, useToast } from '../ui';
import { closeIssue, errorMessage, openTask } from '../actions';
import { fileSize, fullDate, relativeTime, shortDate } from '../lib/format';
import { SAVE_LABEL, useAutosave } from '../lib/useAutosave';
import { LabelChips, LabelPicker } from './LabelPicker';
import { PriorityMenu } from './Priority';
import { useIssue } from './useBoard';
import b from './board.module.css';

interface Props {
  id: number;
  project: Project;
  labels: LabelInfo[];
  onStartTask: (card: Card) => void;
}

/** The issue drawer: slides in from the right, Esc or the overlay closes it. */
export function IssueDrawer({ id, project, labels, onStartTask }: Props) {
  const { issue, error } = useIssue(id, project.slug);
  return (
    <RD.Root open onOpenChange={(o) => !o && closeIssue()}>
      <RD.Portal>
        <RD.Overlay className={b.drawerOverlay} />
        <RD.Content
          className={b.drawer}
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            // Back to the card, even when the drawer was opened from the palette or a click.
            const card = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
            if (card) {
              e.preventDefault();
              card.focus();
            }
          }}
        >
          {issue ? (
            <DrawerBody key={issue.id} issue={issue} labels={labels} onStartTask={onStartTask} />
          ) : error ? (
            <>
              <RD.Title className="visually-hidden">Issue not found</RD.Title>
              <div className={b.drawerTopbar}>
                <span />
                <RD.Close asChild>
                  <IconButton icon={X} label="Close" />
                </RD.Close>
              </div>
              <EmptyState icon={File} title="Issue not found" hint={error} />
            </>
          ) : (
            <div className={b.drawerScroll}>
              <RD.Title className="visually-hidden">Loading issue</RD.Title>
              <Skeleton width="30%" />
              <Skeleton height={28} style={{ marginTop: 16 }} />
              <Skeleton height={120} style={{ marginTop: 24 }} />
            </div>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function DrawerBody({ issue, labels, onStartTask }: { issue: IssueDetail; labels: LabelInfo[]; onStartTask: (c: Card) => void }) {
  const toast = useToast();
  const update = async (patch: Omit<UpdateIssue, 'id'>) => {
    try {
      await window.api.invoke['issues:update']({ id: issue.id, ...patch });
      return true;
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
      return false;
    }
  };
  const call = async (fn: () => Promise<unknown>, failTitle: string) => {
    try {
      await fn();
    } catch (e) {
      toast({ tone: 'error', title: failTitle, description: errorMessage(e) });
    }
  };

  const moveTo = (col: (typeof COLUMNS)[number]) => {
    const check = checkMove(issue, col);
    if (!check.ok && 'startTask' in check) return onStartTask(issue);
    void call(() => window.api.invoke['issues:move']({ issueId: issue.id, toColumn: col }), `Could not move ${issue.key}`);
  };

  return (
    <>
      <div className={b.drawerTopbar}>
        <span className={b.drawerKey}>{issue.key}</span>
        <span className={b.drawerMeta}>
          <Tooltip content={fullDate(issue.createdAt)}>
            <span>Created {shortDate(issue.createdAt)}</span>
          </Tooltip>
          {' · '}
          <Tooltip content={fullDate(issue.updatedAt)}>
            <span>Updated {relativeTime(issue.updatedAt)}</span>
          </Tooltip>
        </span>
        <span className={b.spacer} />
        <Menu trigger={<IconButton icon={MoreHorizontal} label="Issue actions" />}>
          <MenuItem
            icon={Copy}
            onSelect={() =>
              void navigator.clipboard.writeText(issue.key).then(
                () => toast({ title: `Copied ${issue.key}` }),
                () => toast({ tone: 'error', title: 'Could not copy' }),
              )
            }
          >
            Copy key
          </MenuItem>
          <MenuItem icon={FolderOpen} onSelect={() => void call(() => window.api.invoke['issues:revealAttachments']({ id: issue.id }), 'Could not open the folder')}>
            Reveal attachments folder
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={issue.archived ? ArchiveRestore : Archive}
            onSelect={() =>
              void call(async () => {
                await window.api.invoke['issues:archive']({ id: issue.id, archived: !issue.archived });
                if (!issue.archived) {
                  closeIssue();
                  toast({
                    title: `${issue.key} archived`,
                    description: 'Hidden from the board. The Archived filter shows it again.',
                    action: { label: 'Undo', onClick: () => void window.api.invoke['issues:archive']({ id: issue.id, archived: false }) },
                  });
                }
              }, 'Could not archive')
            }
          >
            {issue.archived ? 'Unarchive' : 'Archive'}
          </MenuItem>
        </Menu>
        <RD.Close asChild>
          <IconButton icon={X} label="Close" shortcut={['Esc']} />
        </RD.Close>
      </div>

      <div className={b.drawerScroll}>
        {issue.archived && (
          <div className={b.archivedBanner}>
            <Archive size={16} />
            <span>This issue is archived and hidden from the board.</span>
            <Button size="sm" onClick={() => void call(() => window.api.invoke['issues:archive']({ id: issue.id, archived: false }), 'Could not unarchive')}>
              Unarchive
            </Button>
          </div>
        )}

        <TitleEditor title={issue.title} onSave={(title) => update({ title })} />

        <div className={b.props}>
          <Menu
            align="start"
            trigger={
              <button type="button" className={b.propPill} aria-label={`Column: ${COLUMN_LABEL[issue.column]}`}>
                <span className={b.columnDot} data-col={issue.column} />
                {COLUMN_LABEL[issue.column]}
                <ChevronDown size={12} />
              </button>
            }
          >
            {COLUMNS.map((col) => {
              const check = checkMove(issue, col);
              return (
                <MenuItem key={col} disabled={!check.ok && 'reason' in check} onSelect={() => moveTo(col)} shortcut={col === issue.column ? '✓' : undefined}>
                  {COLUMN_LABEL[col]}
                  {col === 'in_progress' && !issue.task ? ' (starts a task)' : ''}
                </MenuItem>
              );
            })}
          </Menu>
          <PriorityMenu value={issue.priority} onChange={(priority) => void update({ priority })} />
          <LabelPicker
            labels={labels}
            selected={issue.labelIds}
            onChange={(labelIds) => void update({ labelIds })}
            projectSlug={issue.projectSlug}
            trigger={
              <button type="button" className={b.propPill} aria-label="Labels">
                <TagIcon size={14} />
                {issue.labelIds.length ? <LabelChips labels={labels} ids={issue.labelIds} /> : 'Add labels'}
              </button>
            }
          />
        </div>

        <TaskPanel issue={issue} onStartTask={() => onStartTask(issue)} />

        <BodyEditor issue={issue} onSave={(body) => update({ body })} />

        <Attachments issue={issue} />

        <Comments issue={issue} />
      </div>
    </>
  );
}

function TitleEditor({ title, onSave }: { title: string; onSave: (t: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);

  const commit = async () => {
    const t = draft.trim();
    if (!t || t === title) {
      setDraft(title);
      setEditing(false);
      return;
    }
    if (await onSave(t)) setEditing(false);
  };

  return (
    <>
      <RD.Title className="visually-hidden">
        {title}
      </RD.Title>
      {editing ? (
        <textarea
          className={b.titleInput}
          aria-label="Issue title"
          autoFocus
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\n/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h2 className={b.titleHeading}>
          <button type="button" className={b.titleButton} onClick={() => setEditing(true)} title="Click to edit">
            {title}
          </button>
        </h2>
      )}
    </>
  );
}

function TaskPanel({ issue, onStartTask }: { issue: IssueDetail; onStartTask: () => void }) {
  const past = issue.tasks.filter((t) => t.status === 'abandoned');
  return (
    <section className={b.section}>
      <h3 className={b.sectionTitle}>Task</h3>
      {issue.task ? (
        <div className={b.taskBox}>
          <Tag tone="accent">{issue.task.status.replace(/_/g, ' ')}</Tag>
          <span className={b.muted}>The card's column follows this task.</span>
          <Button
            size="sm"
            variant="primary"
            icon={ArrowUpRight}
            style={{ marginLeft: 'auto' }}
            onClick={() => openTask({ id: issue.task!.id, key: issue.key, title: issue.title, projectSlug: issue.projectSlug })}
          >
            Open task
          </Button>
        </div>
      ) : (
        <div className={b.taskBox}>
          <span className={b.muted}>No task yet. Starting one creates a branch, a worktree and a task folder.</span>
          <Button size="sm" variant="primary" icon={Play} onClick={onStartTask} style={{ marginLeft: 'auto' }}>
            Start task
          </Button>
        </div>
      )}
      {past.length > 0 && (
        <ul className={b.history}>
          {past.map((t) => (
            <li key={t.id}>
              <Tag>abandoned</Tag> {t.template} · started {shortDate(t.createdAt)}
              {t.closedAt ? ` · closed ${shortDate(t.closedAt)}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Markdown body with Write / Preview, autosaved 600 ms after typing stops (and on close). */
function BodyEditor({ issue, onSave }: { issue: IssueDetail; onSave: (body: string) => Promise<boolean> }) {
  const [tab, setTab] = useState<'write' | 'preview'>(issue.body.trim() ? 'preview' : 'write');
  const { text: body, setText: setBody, state } = useAutosave(issue.body, onSave);
  const status = SAVE_LABEL[state];

  return (
    <section className={b.section}>
      <div className={b.sectionHead}>
        <h3 className={b.sectionTitle}>Description</h3>
        <span className={b.saveState} data-state={state} aria-live="polite">
          {body.trim() || state !== 'saved' ? status : ''}
        </span>
        <span className={b.spacer} />
        <Tabs
          label="Description mode"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
      </div>
      {tab === 'write' ? (
        <Textarea
          className={b.bodyInput}
          aria-label="Description (Markdown)"
          rows={10}
          autoFocus={!issue.body.trim()}
          placeholder={'What needs doing, and what does done look like?\n\nMarkdown works: lists, `code`, [links](https://…), tables.'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      ) : (
        <div className={b.bodyPreview} onDoubleClick={() => setTab('write')} title="Double-click to edit">
          <Markdown empty="No description. Switch to Write to add one.">{body}</Markdown>
        </div>
      )}
    </section>
  );
}

function Attachments({ issue }: { issue: IssueDetail }) {
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [removing, setRemoving] = useState<IssueDetail['attachments'][number] | null>(null);

  const attach = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      await window.api.invoke['issues:attach']({ issueId: issue.id, paths });
      toast({ tone: 'success', title: paths.length === 1 ? 'File attached' : `${paths.length} files attached` });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not attach', description: errorMessage(e) });
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void attach([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean));
  };
  const open = (path: string) =>
    window.api.invoke['shell:openPath']({ path }).catch((e: unknown) => toast({ tone: 'error', title: 'Could not open the file', description: errorMessage(e) }));

  return (
    <section className={b.section}>
      <div className={b.sectionHead}>
        <h3 className={b.sectionTitle}>Attachments</h3>
        {issue.attachments.length > 0 && <span className={b.sectionCount}>{issue.attachments.length}</span>}
      </div>
      {issue.attachments.length > 0 && (
        <ul className={b.files}>
          {issue.attachments.map((a) => (
            <li key={a.id} className={b.file}>
              <Paperclip size={14} aria-hidden />
              <button type="button" className={b.fileName} onClick={() => void open(a.path)} title={`Open ${a.fileName}`}>
                {a.fileName}
              </button>
              <span className={b.fileMeta}>
                {fileSize(a.size)} · {relativeTime(a.createdAt)}
              </span>
              <IconButton icon={Trash} label={`Remove ${a.fileName}`} size="sm" onClick={() => setRemoving(a)} />
            </li>
          ))}
        </ul>
      )}
      <div
        className={b.dropZone}
        data-over={over || undefined}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Upload size={16} aria-hidden />
        <span>
          Drop files here, or{' '}
          <button
            type="button"
            className={b.linkButton}
            onClick={async () => void attach(await window.api.invoke['dialog:pickFiles']({ title: `Attach files to ${issue.key}` }))}
          >
            choose files
          </button>
        </span>
      </div>
      <div className={b.hint}>Copied into YANTRA's issue folder, then into the task's resources when a task starts.</div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.fileName}?`}
        consequence="YANTRA deletes its copy of the file. The original you attached from is untouched."
        confirmLabel="Remove attachment"
        danger
        onConfirm={async () => {
          if (!removing) return;
          try {
            await window.api.invoke['issues:detach']({ attachmentId: removing.id });
          } catch (e) {
            toast({ tone: 'error', title: 'Could not remove', description: errorMessage(e) });
          }
        }}
      />
    </section>
  );
}

function Comments({ issue }: { issue: IssueDetail }) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await window.api.invoke['comments:add']({ issueId: issue.id, body: draft });
      setDraft('');
    } catch (e) {
      toast({ tone: 'error', title: 'Could not post', description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={b.section}>
      <div className={b.sectionHead}>
        <h3 className={b.sectionTitle}>Comments</h3>
        {issue.comments.length > 0 && <span className={b.sectionCount}>{issue.comments.length}</span>}
      </div>
      {issue.comments.length > 0 && (
        <ol className={b.comments}>
          {issue.comments.map((c) => (
            <li key={c.id} className={b.comment}>
              <Tooltip content={fullDate(c.createdAt)}>
                <time className={b.commentTime} dateTime={new Date(c.createdAt).toISOString()}>
                  {relativeTime(c.createdAt)}
                </time>
              </Tooltip>
              <Markdown>{c.body}</Markdown>
            </li>
          ))}
        </ol>
      )}
      <div className={b.composer}>
        <Textarea
          aria-label="New comment"
          rows={3}
          placeholder="Add a note for yourself or the agent…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void post();
            }
          }}
        />
        <div className={b.composerFoot}>
          <span className={b.hint}>
            <Kbd keys={['Ctrl', 'Enter']} /> to post
          </span>
          <Button size="sm" loading={busy} disabled={!draft.trim()} onClick={post}>
            Comment
          </Button>
        </div>
      </div>
    </section>
  );
}
