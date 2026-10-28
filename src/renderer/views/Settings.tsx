import { useEffect, useState } from 'react';
import { Coins, FolderGit2, FolderOpen, Pencil, Plus, Settings2, Trash, TriangleAlert } from 'lucide-react';
import { fieldErrors, GeneralSettingsSchema, PriceSchema, type GeneralSettings, type Price, type Project } from '@shared/schemas';
import { Button, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, ProjectMark, Select, Switch, useToast } from '../ui';
import { errorMessage, generalOf, navigate, removeProject, runPreflight, saveGeneral, savePriceTable, upsertProject } from '../actions';
import { NO_PROJECTS, useStore, type SettingsSection } from '../store';
import { PreflightPanel } from './PreflightPanel';
import { ProjectForm, validateProject, type ProjectErrors } from './ProjectForm';
import v from './views.module.css';

const SECTIONS: { key: SettingsSection; label: string; icon: typeof Settings2 }[] = [
  { key: 'projects', label: 'Projects', icon: FolderGit2 },
  { key: 'general', label: 'General', icon: Settings2 },
  { key: 'pricing', label: 'Pricing', icon: Coins },
];

// Stable fallback, like NO_PROJECTS: a selector that returns a fresh {} re-renders forever.
const NO_PRICES: Record<string, Price> = {};

export function Settings() {
  const section = useStore((s) => s.route.section ?? 'projects');
  return (
    <div className={v.settings}>
      <nav className={v.settingsNav} aria-label="Settings sections">
        <h1 style={{ marginBottom: 'var(--s4)' }}>Settings</h1>
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={v.settingsNavItem}
            aria-current={section === key ? 'page' : undefined}
            onClick={() => navigate({ view: 'settings', section: key })}
          >
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </nav>
      <div>
        {section === 'projects' && <ProjectsSection />}
        {section === 'general' && <GeneralSection />}
        {section === 'pricing' && <PricingSection />}
      </div>
    </div>
  );
}

/* Projects ---------------------------------------------------------------- */

function ProjectsSection() {
  const projects = useStore((s) => s.config?.projects ?? NO_PROJECTS);
  const [editing, setEditing] = useState<Project | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const toast = useToast();

  return (
    <div className={v.stack}>
      <div className={v.sectionHeader}>
        <div>
          <h2>Projects</h2>
          <p className={v.pageSub}>Each project is one git repo with its own board.</p>
        </div>
        <div className={v.pageActions}>
          <Button icon={Plus} onClick={() => navigate({ view: 'add-project' })}>
            Add project
          </Button>
        </div>
      </div>
      <div className={v.card}>
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No projects"
            hint="Add a git repo to get a board for it."
            action={
              <Button variant="primary" icon={Plus} onClick={() => navigate({ view: 'add-project' })}>
                Add project
              </Button>
            }
          />
        ) : (
          projects.map((p) => (
            <div key={p.slug} className={v.projectRow}>
              <ProjectMark name={p.name} color={p.color} size={28} />
              <div className={v.projectInfo}>
                <div className={v.projectName}>
                  {p.name} <span className={`${v.code} ${v.muted}`}>{p.key}</span>
                </div>
                <div className={`${v.path} ${v.muted}`}>{p.repoPath}</div>
              </div>
              <IconButton icon={FolderOpen} label="Open folder" onClick={() => void window.api.invoke['shell:openPath']({ path: p.repoPath })} />
              <IconButton icon={Pencil} label="Edit project" onClick={() => setEditing(p)} />
              <IconButton icon={Trash} label="Remove project" onClick={() => setRemoving(p)} />
            </div>
          ))
        )}
      </div>

      {editing && <EditProjectDialog project={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'project'}?`}
        consequence="The project leaves YANTRA. Its repository is untouched and its data folder stays on disk."
        confirmLabel="Remove project"
        danger
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeProject(removing.slug);
            toast({ tone: 'success', title: `${removing.name} removed` });
          } catch (e) {
            toast({ tone: 'error', title: 'Could not remove the project', description: errorMessage(e) });
          }
        }}
      />
    </div>
  );
}

function EditProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const projects = useStore((s) => s.config?.projects ?? NO_PROJECTS);
  const others = projects.filter((p) => p.slug !== project.slug).map((p) => p.key);
  const [draft, setDraft] = useState(project);
  const [errors, setErrors] = useState<ProjectErrors>({});
  const [remotes, setRemotes] = useState<string[]>(project.remote ? [project.remote] : []);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    window.api.invoke['repo:inspect']({ path: project.repoPath }).then(
      (info) => info.ok && setRemotes(info.remotes),
      () => {},
    );
  }, [project.repoPath]);

  const save = async () => {
    const errs = validateProject(draft, others);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await upsertProject(draft);
      toast({ tone: 'success', title: 'Project saved' });
      onClose();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${project.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <ProjectForm value={draft} onChange={setDraft} errors={errors} remotes={remotes} />
    </Dialog>
  );
}

/* General ----------------------------------------------------------------- */

function GeneralSection() {
  const config = useStore((s) => s.config)!;
  const preflight = useStore((s) => s.preflight);
  const running = useStore((s) => s.preflightRunning);
  const [draft, setDraft] = useState<GeneralSettings>(() => generalOf(config));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const set = <K extends keyof GeneralSettings>(k: K, val: GeneralSettings[K]) => setDraft((d) => ({ ...d, [k]: val }));
  const saved = generalOf(config);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  // Theme changes from the top bar or palette land in the config; keep the form's copy in step.
  useEffect(() => setDraft((d) => ({ ...d, theme: config.theme })), [config.theme]);

  const save = async () => {
    const r = GeneralSettingsSchema.safeParse(draft);
    setErrors(r.success ? {} : fieldErrors(r.error));
    if (!r.success) return;
    setSaving(true);
    try {
      await saveGeneral(r.data);
      toast({
        tone: 'success',
        title: 'Settings saved',
        description: r.data.dataRoot !== saved.dataRoot ? 'Restart YANTRA to use the new data folder.' : undefined,
      });
      if (r.data.claudeBinary !== saved.claudeBinary) void runPreflight();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const pickDataRoot = async () => {
    const path = await window.api.invoke['dialog:pickFolder']({ title: 'Choose where YANTRA keeps its data' });
    if (path) set('dataRoot', path);
  };

  return (
    <div className={v.stack}>
      <div className={v.sectionHeader}>
        <div>
          <h2>General</h2>
          <p className={v.pageSub}>Claude, sessions, theme and storage.</p>
        </div>
      </div>

      <div className={`${v.card} ${v.section} ${v.stack}`}>
        <h3>Claude Code</h3>
        <Field label="Path to claude" error={errors.claudeBinary} hint="A name on PATH, or the full path to claude.exe">
          {(p) => (
            <div className={v.row}>
              <Input {...p} mono value={draft.claudeBinary} onChange={(e) => set('claudeBinary', e.target.value)} />
              <Button loading={running} onClick={() => void runPreflight(draft.claudeBinary)}>
                Test
              </Button>
            </div>
          )}
        </Field>
        <PreflightPanel result={preflight} running={running} onRetry={() => void runPreflight(draft.claudeBinary)} />
      </div>

      <div className={`${v.card} ${v.section} ${v.stack}`}>
        <h3>Sessions</h3>
        <div className={v.grid2}>
          <Field label="Live sessions at once" error={errors.maxConcurrentSessions} hint="More start queued until one ends (1 to 8)">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={8}
                value={draft.maxConcurrentSessions}
                onChange={(e) => set('maxConcurrentSessions', Number(e.target.value))}
              />
            )}
          </Field>
          <Field label="Default template" error={errors.defaultTemplate} hint="Picked first in the Start task dialog">
            {(p) => (
              <Select {...p} value={draft.defaultTemplate} onChange={(e) => set('defaultTemplate', e.target.value)}>
                {['standard', 'quick', 'research-only'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Switch
          checked={draft.trustWorktrees}
          onChange={(c) => set('trustWorktrees', c)}
          label="Trust new worktrees automatically"
          hint="Answers Claude's 'trust this folder' prompt for worktrees YANTRA creates. Off means you answer it in the terminal."
        />
      </div>

      <div className={`${v.card} ${v.section} ${v.stack}`}>
        <h3>Appearance and storage</h3>
        <div className={v.grid2}>
          <Field label="Theme">
            {(p) => (
              <Select {...p} value={draft.theme} onChange={(e) => set('theme', e.target.value as GeneralSettings['theme'])}>
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            )}
          </Field>
          <Field label="Data folder" error={errors.dataRoot} hint="Task folders, worktrees and the database">
            {(p) => (
              <div className={v.row}>
                <Input {...p} mono value={draft.dataRoot} onChange={(e) => set('dataRoot', e.target.value)} />
                <IconButton icon={FolderOpen} label="Choose folder" onClick={pickDataRoot} />
              </div>
            )}
          </Field>
        </div>
        {draft.dataRoot !== saved.dataRoot && (
          <div className={v.callout}>
            <TriangleAlert size={16} />
            <div>YANTRA uses the new data folder after a restart. Existing data isn't moved.</div>
          </div>
        )}
        <div className={v.sectionFooter}>
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Pricing ----------------------------------------------------------------- */

type Row = { model: string } & Record<keyof Price, string>;
const PRICE_FIELDS: { key: keyof Price; label: string }[] = [
  { key: 'in', label: 'Input' },
  { key: 'out', label: 'Output' },
  { key: 'cacheRead', label: 'Cache read' },
  { key: 'cacheWrite', label: 'Cache write' },
];
const toRows = (t: Record<string, Price>): Row[] =>
  Object.entries(t).map(([model, p]) => ({ model, in: String(p.in), out: String(p.out), cacheRead: String(p.cacheRead), cacheWrite: String(p.cacheWrite) }));

function PricingSection() {
  const table = useStore((s) => s.config?.priceTable ?? NO_PRICES);
  const [rows, setRows] = useState<Row[]>(() => toRows(table));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const setCell = (i: number, k: keyof Row, val: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: val } : row)));

  const save = async () => {
    const out: Record<string, Price> = {};
    for (const row of rows) {
      const model = row.model.trim();
      if (!model) return setError('Every row needs a model id.');
      if (out[model]) return setError(`${model} is listed twice.`);
      const parsed = PriceSchema.safeParse(Object.fromEntries(PRICE_FIELDS.map(({ key }) => [key, Number(row[key])])));
      if (!parsed.success || PRICE_FIELDS.some(({ key }) => row[key].trim() === '')) return setError(`${model}: prices must be numbers, 0 or more.`);
      out[model] = parsed.data;
    }
    setError(null);
    setSaving(true);
    try {
      await savePriceTable(out);
      toast({ tone: 'success', title: 'Prices saved' });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={v.stack}>
      <div className={v.sectionHeader}>
        <div>
          <h2>Pricing</h2>
          <p className={v.pageSub}>USD per million tokens, used for cost estimates. Real billing may differ.</p>
        </div>
      </div>
      <div className={`${v.card} ${v.section}`}>
        {rows.length === 0 ? (
          <EmptyState icon={Coins} title="No prices" hint="Without prices, metrics show tokens only." />
        ) : (
          <table className={v.priceTable}>
            <thead>
              <tr>
                <th>Model</th>
                {PRICE_FIELDS.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <Input mono aria-label="Model id" value={row.model} placeholder="claude-…" onChange={(e) => setCell(i, 'model', e.target.value)} />
                  </td>
                  {PRICE_FIELDS.map((f) => (
                    <td key={f.key}>
                      <Input
                        mono
                        inputMode="decimal"
                        aria-label={`${row.model || 'Model'} ${f.label}`}
                        value={row[f.key]}
                        onChange={(e) => setCell(i, f.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <IconButton icon={Trash} label="Remove row" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && (
          <div className={`${v.callout} ${v.calloutDanger}`} style={{ marginTop: 'var(--s3)' }}>
            <TriangleAlert size={16} />
            <div>{error}</div>
          </div>
        )}
        <div className={v.sectionFooter} style={{ justifyContent: 'space-between' }}>
          <Button
            variant="ghost"
            icon={Plus}
            onClick={() => setRows((r) => [...r, { model: '', in: '0', out: '0', cacheRead: '0', cacheWrite: '0' }])}
          >
            Add model
          </Button>
          <div className={v.row}>
            <Button variant="ghost" onClick={() => setRows(toRows(table))}>
              Discard
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save prices
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
