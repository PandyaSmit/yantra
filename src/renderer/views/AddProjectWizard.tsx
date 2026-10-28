import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleCheck, FolderGit2, FolderOpen, GitBranch, TriangleAlert } from 'lucide-react';
import type { Project } from '@shared/schemas';
import type { RepoInfo } from '@shared/types';
import { Button, Field, Input, useToast } from '../ui';
import { errorMessage, generalOf, runPreflight, saveGeneral, upsertProject } from '../actions';
import { store, useStore } from '../store';
import { PreflightPanel } from './PreflightPanel';
import { ProjectForm, validateProject, type ProjectErrors } from './ProjectForm';
import v from './views.module.css';
import ui from '../ui/ui.module.css';

type Step = 'claude' | 'repo' | 'details';
const STEPS: { key: Step; label: string }[] = [
  { key: 'claude', label: 'Check Claude' },
  { key: 'repo', label: 'Repository' },
  { key: 'details', label: 'Details' },
];

/**
 * Add a project in three steps: pre-flight (skipped when it already passed), pick the repo,
 * confirm the details. Used for the first project (onboarding) and from "Add project".
 */
export function AddProjectWizard({ onDone, onCancel }: { onDone: (slug: string) => void; onCancel?: () => void }) {
  const toast = useToast();
  const preflight = useStore((s) => s.preflight);
  const preflightRunning = useStore((s) => s.preflightRunning);
  const config = useStore((s) => s.config);
  const takenKeys = config?.projects.map((p) => p.key) ?? [];

  const [step, setStep] = useState<Step>(preflight?.ok ? 'repo' : 'claude');
  const [binary, setBinary] = useState(config?.claudeBinary ?? 'claude');
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [draft, setDraft] = useState<Project | null>(null);
  const [errors, setErrors] = useState<ProjectErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (step === 'claude' && !preflight && !preflightRunning) void runPreflight();
  }, [step, preflight, preflightRunning]);

  const pickFolder = async () => {
    const path = await window.api.invoke['dialog:pickFolder']({ title: 'Choose the repository folder' });
    if (!path) return;
    setInspecting(true);
    try {
      const info = await window.api.invoke['repo:inspect']({ path });
      setRepo(info);
      if (info.ok && info.root) {
        setDraft({
          slug: info.suggestedSlug,
          name: info.suggestedName,
          key: info.suggestedKey,
          color: (['indigo', 'teal', 'orange', 'pink', 'blue', 'green', 'violet', 'amber'] as const)[takenKeys.length % 8]!,
          repoPath: info.root,
          defaultBranch: info.defaultBranch ?? 'main',
          remote: info.remotes.includes('origin') ? 'origin' : (info.remotes[0] ?? ''),
          sharedDirs: [],
          worktreeSetup: [],
        });
        setErrors({});
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Could not inspect that folder', description: errorMessage(e) });
    } finally {
      setInspecting(false);
    }
  };

  const useBinary = async () => {
    if (!config) return;
    try {
      await saveGeneral({ ...generalOf(store.get().config!), claudeBinary: binary });
      await runPreflight(binary);
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save the path', description: errorMessage(e) });
    }
  };

  const finish = async () => {
    if (!draft) return;
    const errs = validateProject(draft, takenKeys);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await upsertProject(draft);
      toast({ tone: 'success', title: `${draft.name} added`, description: `Issues will be numbered ${draft.key}-1, ${draft.key}-2, …` });
      onDone(draft.slug);
    } catch (e) {
      toast({ tone: 'error', title: 'Could not add the project', description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const index = STEPS.findIndex((s) => s.key === step);

  return (
    <div className={v.wizard}>
      <ol className={v.steps} style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--s5)' }}>
        {STEPS.map((s, i) => (
          <li key={s.key} className={[v.step, i === index && v.stepActive, i < index && v.stepDone].filter(Boolean).join(' ')}>
            <span className={v.stepNum}>{i < index ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <div className={v.card}>
        {step === 'claude' && (
          <div className={`${v.wizardBody} ${v.stack}`}>
            <div>
              <h2 className={v.wizardTitle}>Check Claude Code</h2>
              <p className={v.muted}>YANTRA runs the real claude CLI for every stage. It has to be installed, logged in and past its first-run setup.</p>
            </div>
            <PreflightPanel result={preflight} running={preflightRunning} onRetry={() => void runPreflight(binary)} />
            {preflight && !preflight.binary.ok && !preflightRunning && (
              <Field label="Path to claude" hint="Usually C:\Users\you\.local\bin\claude.exe on Windows">
                {(p) => (
                  <div className={v.row}>
                    <Input {...p} mono value={binary} onChange={(e) => setBinary(e.target.value)} />
                    <Button onClick={useBinary}>Use this path</Button>
                  </div>
                )}
              </Field>
            )}
          </div>
        )}

        {step === 'repo' && (
          <div className={`${v.wizardBody} ${v.stack}`}>
            <div>
              <h2 className={v.wizardTitle}>Choose the repository</h2>
              <p className={v.muted}>Pick the folder of a git repo. YANTRA never edits it directly: each task gets its own worktree.</p>
            </div>
            {!repo?.ok ? (
              <button type="button" className={v.pickFolder} onClick={pickFolder} disabled={inspecting}>
                {inspecting ? <span className={ui.spinner} style={{ display: 'inline-flex' }}><FolderGit2 size={28} /></span> : <FolderGit2 size={28} />}
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{inspecting ? 'Looking at the repo…' : 'Choose a folder'}</span>
                <span className={v.small}>Any folder inside the repo works; YANTRA finds the top level</span>
              </button>
            ) : (
              <div className={v.repoSummary}>
                <div className={v.repoLine}>
                  <CircleCheck size={16} color="var(--ok)" />
                  <span className={v.path}>{repo.root}</span>
                </div>
                <div className={`${v.repoLine} ${v.muted}`}>
                  <GitBranch size={14} /> Default branch <span className={v.code}>{repo.defaultBranch ?? 'unknown'}</span>
                  <span style={{ marginLeft: 'var(--s3)' }}>
                    {repo.remotes.length ? <>Remote <span className={v.code}>{repo.remotes.join(', ')}</span></> : 'No remote'}
                  </span>
                </div>
                <div>
                  <Button size="sm" variant="ghost" icon={FolderOpen} onClick={pickFolder}>
                    Choose another folder
                  </Button>
                </div>
              </div>
            )}
            {repo && !repo.ok && (
              <div className={`${v.callout} ${v.calloutDanger}`}>
                <TriangleAlert size={16} />
                <div>That folder isn't a git repository. Pick the repo's folder, or run <span className={v.code}>git init</span> there first.</div>
              </div>
            )}
          </div>
        )}

        {step === 'details' && draft && (
          <div className={v.wizardBody}>
            <h2 className={v.wizardTitle} style={{ marginBottom: 'var(--s4)' }}>
              Project details
            </h2>
            <ProjectForm value={draft} onChange={setDraft} errors={errors} remotes={repo?.remotes ?? []} onChangeRepo={() => setStep('repo')} />
          </div>
        )}

        <div className={v.wizardFooter}>
          <div>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          {index > 0 && (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(STEPS[index - 1]!.key)}>
              Back
            </Button>
          )}
          {step === 'claude' && (
            <>
              {!preflight?.ok && (
                <Button variant="ghost" onClick={() => setStep('repo')} disabled={preflightRunning}>
                  Skip for now
                </Button>
              )}
              <Button variant="primary" iconRight={ArrowRight} disabled={!preflight?.ok} onClick={() => setStep('repo')}>
                Continue
              </Button>
            </>
          )}
          {step === 'repo' && (
            <Button variant="primary" iconRight={ArrowRight} disabled={!repo?.ok || !draft} onClick={() => setStep('details')}>
              Continue
            </Button>
          )}
          {step === 'details' && (
            <Button variant="primary" icon={Check} loading={saving} onClick={finish}>
              Add project
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
