import { useState } from 'react';
import { Archive, Copy, FileText, MoreHorizontal, Pencil, Play, Plus, Settings2, Trash } from 'lucide-react';
import { PALETTE, type PaletteName } from '@shared/palette';
import { STAGE_STATUSES } from '@shared/types';
import {
  Badge,
  Button,
  ButtonRow,
  ColorSwatches,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Menu,
  MenuItem,
  MenuSeparator,
  Pill,
  Popover,
  ProjectMark,
  Select,
  Skeleton,
  Switch,
  Tabs,
  Tag,
  Textarea,
  Tooltip,
  useToast,
} from '../ui';
import v from './views.module.css';

const TOKENS = ['bg', 'surface', 'card', 'elevated', 'border', 'text', 'text-muted', 'accent', 'running', 'needs-you', 'ok', 'danger', 'idle', 'hover', 'active'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={v.devSection}>
      <h3 className={v.devSectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** One full gallery of primitives, rendered under a forced theme. */
function Panel({ theme }: { theme: 'light' | 'dark' }) {
  const toast = useToast();
  const [tab, setTab] = useState<'terminal' | 'files' | 'diff' | 'metrics'>('terminal');
  const [color, setColor] = useState<PaletteName>('indigo');
  const [on, setOn] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className={v.devPanel} data-theme={theme}>
      <h2 style={{ marginBottom: 'var(--s5)' }}>{theme === 'light' ? 'Light' : 'Dark'}</h2>

      <Section title="Tokens">
        <div className={v.swatchRow}>
          {TOKENS.map((t) => (
            <div key={t}>
              <div className={v.tokenSwatch} style={{ background: `var(--${t})` }} />
              <div className={v.tokenName}>{t}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className={v.stackSm}>
          <h1>Heading one, 20px</h1>
          <h2>Heading two, 16px</h2>
          <p>Body text, 13px Inter. The quick brown fox jumps over the lazy dog.</p>
          <p className={`${v.muted} ${v.small}`}>Meta text, 12px muted</p>
          <p className="mono">PAY-12 · yantra/PAY-12-fix-retry · D:\projects\payments</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className={v.stackSm}>
          <ButtonRow>
            <Button variant="primary" icon={Play}>
              Approve
            </Button>
            <Button icon={Plus}>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={Trash}>
              Delete
            </Button>
          </ButtonRow>
          <ButtonRow>
            <Button size="sm" variant="primary">
              Small
            </Button>
            <Button size="sm" loading>
              Loading
            </Button>
            <Button size="sm" disabled>
              Disabled
            </Button>
            <IconButton icon={Pencil} label="Edit" />
            <IconButton icon={Copy} label="Copy" shortcut={['Ctrl', 'C']} />
            <IconButton icon={Settings2} label="Settings" active />
          </ButtonRow>
        </div>
      </Section>

      <Section title="Status language">
        <div className={v.row} style={{ flexWrap: 'wrap' }}>
          {STAGE_STATUSES.map((st) => (
            <Pill key={st} status={st} />
          ))}
        </div>
        <div className={v.row} style={{ flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
          <Tag>Draft</Tag>
          <Tag tone="accent">Active</Tag>
          <Tag tone="ok">Pushed</Tag>
          <Tag tone="danger">Abandoned</Tag>
        </div>
      </Section>

      <Section title="Palette">
        <div className={v.row} style={{ flexWrap: 'wrap' }}>
          {PALETTE.map((c) => (
            <Badge key={c} color={c} dot>
              {c}
            </Badge>
          ))}
        </div>
        <div className={v.row} style={{ marginTop: 'var(--s3)' }}>
          <ColorSwatches label="Colour" value={color} onChange={setColor} />
          <ProjectMark name="Payments" color={color} size={28} />
        </div>
      </Section>

      <Section title="Form">
        <div className={v.stack}>
          <div className={v.grid2}>
            <Field label="Name" hint="Shown in the sidebar">
              {(p) => <Input {...p} placeholder="Payments API" />}
            </Field>
            <Field label="Key" error="PAY is already used">
              {(p) => <Input {...p} mono defaultValue="PAY" />}
            </Field>
          </div>
          <Field label="Template">
            {(p) => (
              <Select {...p} defaultValue="standard">
                <option>standard</option>
                <option>quick</option>
              </Select>
            )}
          </Field>
          <Field label="Notes">{(p) => <Textarea {...p} placeholder="Markdown is fine" />}</Field>
          <Switch checked={on} onChange={setOn} label="Trust new worktrees" hint="A switch with a hint" />
        </div>
      </Section>

      <Section title="Tabs, keys, menus">
        <Tabs
          label="Workspace"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'terminal', label: 'Terminal' },
            { value: 'files', label: 'Files', count: 4 },
            { value: 'diff', label: 'Diff' },
            { value: 'metrics', label: 'Metrics' },
          ]}
        />
        <div className={v.row} style={{ marginTop: 'var(--s3)' }}>
          <Kbd keys={['Ctrl', 'K']} />
          <Kbd keys={['G', 'B']} />
          <Menu trigger={<IconButton icon={MoreHorizontal} label="More" />}>
            <MenuItem icon={Pencil} onSelect={() => {}} shortcut="E">
              Edit
            </MenuItem>
            <MenuItem icon={Archive} onSelect={() => {}}>
              Archive
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash} danger onSelect={() => {}}>
              Delete
            </MenuItem>
          </Menu>
          <Popover trigger={<Button size="sm">Popover</Button>}>
            <div className={v.small}>Round 2 · 14m · 82k tokens</div>
          </Popover>
          <Tooltip content="Tooltip with shortcut" shortcut={['C']}>
            <Button size="sm" variant="ghost">
              Hover me
            </Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="Overlays and feedback">
        <ButtonRow>
          <Button size="sm" onClick={() => setDialog(true)}>
            Dialog
          </Button>
          <Button size="sm" onClick={() => setConfirm(true)}>
            Confirm
          </Button>
          <Button size="sm" onClick={() => toast({ title: 'Plan approved', description: 'Code stage is starting.' })}>
            Toast
          </Button>
          <Button size="sm" onClick={() => toast({ tone: 'success', title: 'Branch pushed' })}>
            Success
          </Button>
          <Button size="sm" onClick={() => toast({ tone: 'error', title: 'Push failed', description: 'The remote rejected the branch.' })}>
            Error
          </Button>
        </ButtonRow>
        <Dialog open={dialog} onOpenChange={setDialog} title="Start task" description="A dialog with a footer.">
          <p className={v.muted}>Dialog body.</p>
        </Dialog>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Abandon PAY-12?"
          consequence="The session ends and the worktree is removed. The task folder stays."
          confirmLabel="Abandon task"
          danger
          onConfirm={() => {}}
        />
      </Section>

      <Section title="Loading and empty">
        <div className={`${v.card} ${v.cardPad} ${v.stackSm}`}>
          <Skeleton width="40%" />
          <Skeleton />
          <Skeleton width="70%" />
        </div>
        <div className={v.card} style={{ marginTop: 'var(--s3)' }}>
          <EmptyState icon={FileText} title="No issues yet" hint="Press C to write one." action={<Button size="sm" variant="primary" icon={Plus}>New issue</Button>} />
        </div>
      </Section>
    </div>
  );
}

/** Every primitive in both themes, side by side. Reached from the command palette ("UI gallery"). */
export function DevUi() {
  return (
    <div className={v.devGrid}>
      <Panel theme="light" />
      <Panel theme="dark" />
    </div>
  );
}
