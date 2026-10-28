import * as RD from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Bell, CircleCheck, FilePlus, FileText, Keyboard, LayoutGrid, Palette, Play, Plus, RotateCw, Search, Settings, Sigma, SunMoon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { IssueIndexEntry } from '@shared/board';
import { Kbd, ProjectMark } from '../ui';
import { cycleTheme, navigate, openIssue, runPreflight } from '../actions';
import { NO_PROJECTS, store, useStore } from '../store';
import s from './shell.module.css';
import ui from '../ui/ui.module.css';

function Item({ icon, children, hint, onSelect, value }: { icon: ReactNode; children: ReactNode; hint?: ReactNode; onSelect: () => void; value: string }) {
  return (
    <Command.Item
      className={s.paletteItem}
      value={value}
      onSelect={() => {
        store.set({ paletteOpen: false });
        onSelect();
      }}
    >
      {icon}
      {children}
      {hint && <span className={s.paletteHint}>{hint}</span>}
    </Command.Item>
  );
}

export function CommandPalette() {
  const open = useStore((st) => st.paletteOpen);
  const projects = useStore((st) => st.config?.projects ?? NO_PROJECTS);
  const currentProject = useStore((st) => st.route.project);
  const [issues, setIssues] = useState<IssueIndexEntry[]>([]);
  useEffect(() => {
    if (open) window.api.invoke['issues:index']().then(setIssues, () => setIssues([]));
  }, [open]);
  const projectOf = new Map(projects.map((p) => [p.slug, p]));
  const isDev = useStore((st) => st.info?.isDev ?? false);
  const theme = useStore((st) => st.config?.theme ?? 'system');
  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme];

  return (
    <RD.Root open={open} onOpenChange={(o) => store.set({ paletteOpen: o })}>
      <RD.Portal>
        <RD.Overlay className={ui.overlay} />
        <RD.Content className={s.palette} aria-label="Command palette" aria-describedby={undefined}>
          <RD.Title className="visually-hidden">Command palette</RD.Title>
          <Command loop label="Command palette">
            <div className={s.paletteInputRow}>
              <Search size={16} aria-hidden />
              <Command.Input className={s.paletteInput} placeholder="Jump to an issue, project or view, or run a command…" autoFocus />
            </div>
            <Command.List className={s.paletteList}>
              <Command.Empty className={s.paletteEmpty}>Nothing matches. Try an issue key like PAY-12, or a word from its title.</Command.Empty>

              {issues.length > 0 && (
                <Command.Group heading="Issues">
                  {issues.map((i) => {
                    const p = projectOf.get(i.projectSlug);
                    return (
                      <Item
                        key={i.id}
                        value={`issue ${i.key} ${i.title} ${i.id}`}
                        icon={p ? <ProjectMark name={p.name} color={p.color} /> : <FileText size={16} />}
                        hint={<span className="mono">{i.key}</span>}
                        onSelect={() => openIssue(i.id, i.projectSlug)}
                      >
                        <span className={s.paletteIssueTitle}>{i.title}</span>
                      </Item>
                    );
                  })}
                </Command.Group>
              )}

              <Command.Group heading="Projects">
                {projects.map((p) => (
                  <Item
                    key={p.slug}
                    value={`project ${p.name} ${p.key}`}
                    icon={<ProjectMark name={p.name} color={p.color} />}
                    hint={<span className="mono">{p.key}</span>}
                    onSelect={() => navigate({ view: 'board', project: p.slug })}
                  >
                    {p.name} board
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Go to">
                <Item value="go board" icon={<LayoutGrid size={16} />} hint={<Kbd keys={['G', 'B']} />} onSelect={() => navigate({ view: 'board' })}>
                  Board
                </Item>
                <Item value="go running" icon={<Play size={16} />} hint={<Kbd keys={['G', 'R']} />} onSelect={() => navigate({ view: 'running' })}>
                  Running
                </Item>
                <Item value="go needs you" icon={<Bell size={16} />} hint={<Kbd keys={['G', 'N']} />} onSelect={() => navigate({ view: 'needs' })}>
                  Needs you
                </Item>
                <Item value="go done" icon={<CircleCheck size={16} />} hint={<Kbd keys={['G', 'D']} />} onSelect={() => navigate({ view: 'done' })}>
                  Done
                </Item>
                <Item value="go metrics" icon={<Sigma size={16} />} hint={<Kbd keys={['G', 'M']} />} onSelect={() => navigate({ view: 'metrics' })}>
                  Metrics
                </Item>
                <Item value="go settings" icon={<Settings size={16} />} hint={<Kbd keys={['G', 'S']} />} onSelect={() => navigate({ view: 'settings' })}>
                  Settings
                </Item>
              </Command.Group>

              <Command.Group heading="Actions">
                {currentProject && (
                  <Item
                    value="new issue create"
                    icon={<FilePlus size={16} />}
                    hint={<Kbd keys={['C']} />}
                    onSelect={() => {
                      navigate({ view: 'board', issue: undefined });
                      store.set({ newIssue: { column: 'backlog' } });
                    }}
                  >
                    New issue in {projectOf.get(currentProject)?.name ?? 'this project'}
                  </Item>
                )}
                <Item value="add project" icon={<Plus size={16} />} onSelect={() => navigate({ view: 'add-project' })}>
                  Add project
                </Item>
                <Item value="toggle theme" icon={<SunMoon size={16} />} hint={`Switch to ${nextTheme}`} onSelect={() => void cycleTheme()}>
                  Switch theme
                </Item>
                <Item value="check claude preflight" icon={<RotateCw size={16} />} onSelect={() => void runPreflight()}>
                  Check Claude again
                </Item>
                <Item value="keyboard shortcuts" icon={<Keyboard size={16} />} hint={<Kbd keys={['?']} />} onSelect={() => store.set({ shortcutsOpen: true })}>
                  Keyboard shortcuts
                </Item>
                {isDev && (
                  <Item value="developer ui gallery devui" icon={<Palette size={16} />} hint="dev" onSelect={() => navigate({ view: 'devui' })}>
                    UI gallery
                  </Item>
                )}
              </Command.Group>
            </Command.List>
            <div className={s.paletteFooter}>
              <span>
                <Kbd keys={['↑', '↓']} /> move
              </span>
              <span>
                <Kbd keys={['Enter']} /> open
              </span>
              <span>
                <Kbd keys={['Esc']} /> close
              </span>
            </div>
          </Command>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
