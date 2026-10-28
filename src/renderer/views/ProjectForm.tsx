import { useState } from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { fieldErrors, ProjectSchema, type Project } from '@shared/schemas';
import { Button, ColorSwatches, Field, Input, ProjectMark, Select, Textarea } from '../ui';
import v from './views.module.css';

export type ProjectErrors = Record<string, string>;

/** Schema errors plus the one rule the schema can't see: keys are unique across projects. */
export function validateProject(p: Project, takenKeys: string[]): ProjectErrors {
  const r = ProjectSchema.safeParse(p);
  const errors = r.success ? {} : fieldErrors(r.error);
  if (!errors.key && takenKeys.includes(p.key)) errors.key = `${p.key} is already used by another project`;
  return errors;
}

/** One textarea per list: one entry per line. Keeps its own text so blank lines survive while typing. */
function LinesField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  error?: string;
}) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <Textarea
          {...p}
          mono
          rows={3}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean));
          }}
        />
      )}
    </Field>
  );
}

interface Props {
  value: Project;
  onChange: (p: Project) => void;
  errors: ProjectErrors;
  remotes: string[];
  /** Key can't change once the project has issues; Phase 1 has none, but the form already respects it. */
  keyLocked?: boolean;
  onChangeRepo?: () => void;
  advancedOpen?: boolean;
}

export function ProjectForm({ value, onChange, errors, remotes, keyLocked, onChangeRepo, advancedOpen }: Props) {
  const set = <K extends keyof Project>(k: K, val: Project[K]) => onChange({ ...value, [k]: val });
  const remoteOptions = remotes.length ? remotes : [];

  return (
    <div className={v.stack}>
      <div className={v.row} style={{ alignItems: 'flex-start' }}>
        <ProjectMark name={value.name || '?'} color={value.color} size={40} />
        <div style={{ flex: 1 }}>
          <Field label="Name" error={errors.name}>
            {(p) => <Input {...p} value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Payments API" autoFocus />}
          </Field>
        </div>
        <div style={{ width: 140 }}>
          <Field label="Issue key" error={errors.key} hint={keyLocked ? 'Locked: has issues' : `${value.key || 'KEY'}-12`}>
            {(p) => (
              <Input
                {...p}
                mono
                value={value.key}
                disabled={keyLocked}
                maxLength={5}
                onChange={(e) => set('key', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              />
            )}
          </Field>
        </div>
      </div>

      <Field label="Colour">{() => <ColorSwatches label="Project colour" value={value.color} onChange={(c) => set('color', c)} />}</Field>

      <Field label="Repository" error={errors.repoPath}>
        {() => (
          <div className={v.repoSummary} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <FolderOpen size={16} color="var(--text-muted)" />
            <span className={v.path} style={{ flex: 1 }}>
              {value.repoPath}
            </span>
            {onChangeRepo && (
              <Button size="sm" variant="ghost" onClick={onChangeRepo}>
                Change
              </Button>
            )}
          </div>
        )}
      </Field>

      <div className={v.grid2}>
        <Field label="Default branch" error={errors.defaultBranch} hint="Worktrees branch off this">
          {(p) => <Input {...p} mono value={value.defaultBranch} onChange={(e) => set('defaultBranch', e.target.value.trim())} />}
        </Field>
        <Field label="Remote" hint={remoteOptions.length ? 'Push branch goes here' : 'No remote: Push stays disabled'}>
          {(p) =>
            remoteOptions.length ? (
              <Select {...p} value={value.remote} onChange={(e) => set('remote', e.target.value)}>
                {remoteOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            ) : (
              <Input {...p} mono value={value.remote} placeholder="origin" onChange={(e) => set('remote', e.target.value.trim())} />
            )
          }
        </Field>
      </div>

      <details className={v.details} open={advancedOpen}>
        <summary>
          <ChevronRight size={14} /> Setup commands, checks and shared folders
        </summary>
        <div className={v.stack} style={{ marginTop: 'var(--s4)' }}>
          <LinesField
            label="Worktree setup"
            hint="Run in each new worktree, one per line. Example: copying .env, installing dependencies."
            placeholder={'copy ..\\.env .env\nnpm ci'}
            value={value.worktreeSetup}
            onChange={(l) => set('worktreeSetup', l)}
          />
          <LinesField
            label="Checks before review"
            hint="Overrides the template's checks (tests, lint, typecheck). Leave empty to use the template's."
            placeholder={'npm test\nnpm run lint'}
            value={value.pre ?? []}
            onChange={(l) => set('pre', l.length ? l : undefined)}
          />
          <LinesField
            label="Shared folders"
            hint="Extra folders every stage can read (passed as --add-dir), one path per line."
            placeholder="D:\notes\payments"
            value={value.sharedDirs}
            onChange={(l) => set('sharedDirs', l)}
          />
        </div>
      </details>
    </div>
  );
}
