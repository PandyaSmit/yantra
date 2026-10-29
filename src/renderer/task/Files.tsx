import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Plus,
  RefreshCw,
  Trash,
  Upload,
} from 'lucide-react';
import { isEditable, type FileContent, type FileNode, type TaskDetail } from '@shared/tasks';
import { Button, ConfirmDialog, EmptyState, IconButton, Markdown, Skeleton, Tabs, Tag, Textarea, useToast } from '../ui';
import { errorMessage, navigate } from '../actions';
import { fileSize, fullDate, relativeTime } from '../lib/format';
import { SAVE_LABEL, useAutosave } from '../lib/useAutosave';
import { useStore } from '../store';
import { useTaskFiles } from './useTask';
import t from './task.module.css';

const flatten = (nodes: FileNode[]): FileNode[] => nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name);

/** The task folder: a tree on the left, the selected file on the right. Files dropped anywhere here go to resources/. */
export function Files({ task }: { task: TaskDetail }) {
  const toast = useToast();
  const { tree, error, refresh } = useTaskFiles(task.id);
  const selected = useStore((s) => s.route.file) ?? 'brief.md';
  const [over, setOver] = useState(false);
  const nodes = useMemo(() => new Map(flatten(tree ?? []).map((n) => [n.path, n])), [tree]);
  const select = (path: string) => navigate({ file: path });

  const add = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const names = await window.api.invoke['tasks:addResources']({ id: task.id, paths });
      toast({ tone: 'success', title: names.length === 1 ? `Added resources/${names[0]}` : `Added ${names.length} files to resources/` });
      await refresh();
      select(`resources/${names[0]}`);
    } catch (e) {
      toast({ tone: 'error', title: 'Could not add the files', description: errorMessage(e) });
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void add([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean));
  };

  return (
    <div
      className={t.files}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <aside className={t.treePane} aria-label="Task folder">
        <div className={t.paneHead}>
          <span className={t.paneTitle}>Task folder</span>
          <span className={t.spacer} />
          <IconButton
            icon={Plus}
            label="Add files to resources/"
            size="sm"
            onClick={async () => void add(await window.api.invoke['dialog:pickFiles']({ title: `Add resources to ${task.issueKey}` }))}
          />
          <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={() => void refresh()} />
          <IconButton
            icon={FolderOpen}
            label="Open task folder"
            size="sm"
            onClick={() => void window.api.invoke['tasks:reveal']({ id: task.id, what: 'folder' }).catch((e: unknown) => toast({ tone: 'error', title: 'Could not open', description: errorMessage(e) }))}
          />
        </div>
        <div className={t.tree} role="tree" aria-label="Files">
          {tree === null ? (
            error ? (
              <div className={t.treeError}>{error}</div>
            ) : (
              [1, 2, 3, 4].map((i) => <Skeleton key={i} height={22} style={{ margin: '4px 8px' }} />)
            )
          ) : tree.length === 0 ? (
            <div className={t.treeError}>The task folder is empty or missing. Finish setup to create it.</div>
          ) : (
            <Tree nodes={tree} depth={0} selected={selected} onSelect={select} />
          )}
        </div>
        <div className={t.treeHint}>
          <Upload size={13} aria-hidden />
          <span>
            Drop files here to add them to <span className="mono">resources/</span>
          </span>
        </div>
      </aside>

      <section className={t.viewer} aria-label={selected}>
        {tree === null ? (
          <div className={t.viewerPad}>
            <Skeleton width="40%" />
            <Skeleton height={240} style={{ marginTop: 16 }} />
          </div>
        ) : nodes.get(selected)?.kind === 'file' ? (
          <Viewer key={selected} task={task} node={nodes.get(selected)!} onRemoved={() => void refresh().then(() => select('brief.md'))} />
        ) : (
          <EmptyState
            icon={FileText}
            title={nodes.has(selected) ? 'Pick a file' : `${selected} isn't here`}
            hint={nodes.has(selected) ? 'Choose a file in the tree to view it.' : 'It may have been moved or deleted.'}
            action={!nodes.has(selected) && nodes.has('brief.md') ? <Button onClick={() => select('brief.md')}>Open brief.md</Button> : undefined}
          />
        )}
      </section>

      {over && (
        <div className={t.dropOverlay} aria-hidden>
          <Upload size={22} />
          <div>
            Drop to add to <span className="mono">resources/</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Tree({ nodes, depth, selected, onSelect }: { nodes: FileNode[]; depth: number; selected: string; onSelect: (p: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(nodes.filter((n) => n.kind === 'dir' && n.name === 'log').map((n) => n.path)));
  return (
    <ul className={t.treeList} role="group">
      {nodes.map((n) => {
        const open = !collapsed.has(n.path);
        const Icon = n.kind === 'dir' ? (open ? FolderOpen : Folder) : isImage(n.name) ? FileImage : n.name.endsWith('.md') ? FileText : File;
        const toggle = () =>
          setCollapsed((c) => {
            const next = new Set(c);
            if (next.has(n.path)) next.delete(n.path);
            else next.add(n.path);
            return next;
          });
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.kind === 'dir' ? open : undefined} aria-selected={n.path === selected}>
            <button
              type="button"
              className={t.treeItem}
              data-selected={n.path === selected || undefined}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => (n.kind === 'dir' ? toggle() : onSelect(n.path))}
              title={n.path}
            >
              {n.kind === 'dir' ? (
                open ? (
                  <ChevronDown size={12} className={t.chevron} aria-hidden />
                ) : (
                  <ChevronRight size={12} className={t.chevron} aria-hidden />
                )
              ) : (
                <span className={t.chevron} />
              )}
              <Icon size={14} className={t.treeIcon} aria-hidden />
              <span className={t.treeName}>{n.name}</span>
              {n.kind === 'dir' && n.children && <span className={t.treeCount}>{n.children.length || ''}</span>}
            </button>
            {n.kind === 'dir' && open && n.children && n.children.length > 0 && (
              <Tree nodes={n.children} depth={depth + 1} selected={selected} onSelect={onSelect} />
            )}
            {n.kind === 'dir' && open && n.children?.length === 0 && (
              <div className={t.treeEmpty} style={{ paddingLeft: 36 + depth * 14 }}>
                {n.name === 'resources' ? 'Empty: drop specs, screenshots, notes' : 'Empty'}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Viewer({ task, node, onRemoved }: { task: TaskDetail; node: FileNode; onRemoved: () => void }) {
  const toast = useToast();
  const [content, setContent] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const platform = useStore((s) => s.info?.platform);
  const owner = task.stages.find((s) => s.artifact === node.path);
  const full = `${task.taskDir}/${node.path}`.replace(/[\\/]/g, platform === 'win32' ? '\\' : '/');

  useEffect(() => {
    let live = true;
    window.api.invoke['tasks:readFile']({ id: task.id, path: node.path }).then(
      (c) => live && (setContent(c), setError(null)),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [task.id, node.path, node.mtime]);

  const fail = (title: string) => (e: unknown) => toast({ tone: 'error', title, description: errorMessage(e) });
  const openExternally = () => void window.api.invoke['shell:openPath']({ path: full }).catch(fail('Could not open the file'));

  return (
    <div className={t.viewerInner}>
      <div className={t.viewerHead}>
        <span className={`${t.viewerPath} mono`}>{node.path}</span>
        <span className={t.viewerMeta} title={fullDate(node.mtime)}>
          {fileSize(node.size)} · {relativeTime(node.mtime)}
        </span>
        {owner?.status === 'approved' && (
          <span title={owner.approvedAt ? `Approved ${fullDate(owner.approvedAt)}` : undefined}>
            {owner.modified ? <Tag tone="warn">Modified since approval</Tag> : <Tag tone="ok">Approved</Tag>}
          </span>
        )}
        {owner?.status === 'awaiting_approval' && <Tag tone="warn">Waiting for your approval</Tag>}
        <span className={t.spacer} />
        {node.path === 'issue.md' && (
          <Button
            size="sm"
            icon={RefreshCw}
            onClick={() =>
              void window.api.invoke['tasks:refreshIssue']({ id: task.id })
                .then(() => toast({ tone: 'success', title: 'issue.md refreshed from the board' }))
                .catch(fail('Could not refresh issue.md'))
            }
          >
            Refresh from board
          </Button>
        )}
        <IconButton icon={ExternalLink} label="Open with default app" size="sm" onClick={openExternally} />
        <IconButton
          icon={FolderSearch}
          label="Show in folder"
          size="sm"
          onClick={() => void window.api.invoke['tasks:reveal']({ id: task.id, what: 'file', path: node.path }).catch(fail('Could not show the file'))}
        />
        {node.path.startsWith('resources/') && <IconButton icon={Trash} label={`Remove ${node.name}`} size="sm" onClick={() => setRemoving(true)} />}
      </div>

      {error ? (
        <EmptyState icon={File} title="Couldn't read this file" hint={error} />
      ) : !content ? (
        <div className={t.viewerPad}>
          <Skeleton height={200} />
        </div>
      ) : content.kind === 'text' && isEditable(node.path) ? (
        <BriefEditor task={task} path={node.path} text={content.text} />
      ) : content.kind === 'text' && node.name.endsWith('.md') ? (
        <div className={t.viewerScroll}>
          <div className={t.doc}>
            <Markdown empty="This file is empty.">{content.text}</Markdown>
          </div>
        </div>
      ) : content.kind === 'text' ? (
        <pre className={t.textView}>{content.text || ' '}</pre>
      ) : content.kind === 'image' ? (
        <div className={t.imageView}>
          <img src={content.dataUrl} alt={node.name} />
        </div>
      ) : (
        <EmptyState
          icon={File}
          title={content.kind === 'binary' ? 'No preview for this file' : 'Too large to preview'}
          hint={`${node.name} · ${fileSize(content.size)}`}
          action={<Button onClick={openExternally}>Open with default app</Button>}
        />
      )}

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${node.name}?`}
        consequence="The file is deleted from this task's resources/. Issue attachments on the board are untouched."
        confirmLabel="Remove file"
        danger
        onConfirm={async () => {
          try {
            await window.api.invoke['tasks:removeResource']({ id: task.id, path: node.path });
            onRemoved();
          } catch (e) {
            fail('Could not remove the file')(e);
          }
        }}
      />
    </div>
  );
}

/** brief.md: Write / Preview, autosaved like the issue description. */
function BriefEditor({ task, path, text }: { task: TaskDetail; path: string; text: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const save = async (next: string) => {
    try {
      await window.api.invoke['tasks:writeFile']({ id: task.id, path, text: next });
      return true;
    } catch (e) {
      toast({ tone: 'error', title: `Could not save ${path}`, description: errorMessage(e) });
      return false;
    }
  };
  const { text: value, setText, state } = useAutosave(text, save);

  return (
    <div className={t.editor}>
      <div className={t.editorBar}>
        <Tabs
          label="Brief mode"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
        <span className={t.saveState} data-state={state} aria-live="polite">
          {SAVE_LABEL[state]}
        </span>
        <span className={t.spacer} />
        <span className={t.editorHint}>Every stage reads this. Goal, constraints, acceptance criteria, pointers.</span>
      </div>
      {tab === 'write' ? (
        <Textarea className={t.editorInput} aria-label={`${path} (Markdown)`} value={value} onChange={(e) => setText(e.target.value)} spellCheck />
      ) : (
        <div className={t.viewerScroll} onDoubleClick={() => setTab('write')} title="Double-click to edit">
          <div className={t.doc}>
            <Markdown empty="The brief is empty.">{value}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
