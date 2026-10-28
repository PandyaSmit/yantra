import { CircleCheck, CircleX, LoaderCircle, RotateCw, Terminal } from 'lucide-react';
import type { PreflightResult } from '@shared/types';
import { Button } from '../ui';
import v from './views.module.css';
import ui from '../ui/ui.module.css';

function CheckRow({ label, ok, detail, running }: { label: string; ok: boolean | null; detail: string; running: boolean }) {
  return (
    <div className={v.check}>
      {running ? (
        <LoaderCircle size={16} className={ui.spinner} color="var(--text-faint)" />
      ) : ok ? (
        <CircleCheck size={16} color="var(--ok)" />
      ) : ok === false ? (
        <CircleX size={16} color="var(--danger)" />
      ) : (
        <CircleCheck size={16} color="var(--text-faint)" />
      )}
      <span className={v.checkLabel}>{label}</span>
      <span className={v.checkDetail}>{running ? 'Checking…' : detail}</span>
    </div>
  );
}

/** The three pre-flight checks, with guidance for whichever one fails. */
export function PreflightPanel({ result, running, onRetry }: { result: PreflightResult | null; running: boolean; onRetry: () => void }) {
  const notRun = (label: string) => <CheckRow label={label} ok={null} detail="Waiting" running={running} />;
  const needsTerminal = result && result.binary.ok && (!result.auth.ok || !result.onboarding.ok);
  return (
    <div className={v.stack}>
      <div className={v.checks}>
        {result ? (
          <>
            <CheckRow label="Claude Code CLI" ok={result.binary.ok} detail={result.binary.detail} running={running} />
            <CheckRow label="Logged in" ok={result.binary.ok ? result.auth.ok : null} detail={result.auth.detail} running={running} />
            <CheckRow
              label="First-run setup"
              ok={result.binary.ok ? result.onboarding.ok : null}
              detail={result.onboarding.detail}
              running={running}
            />
          </>
        ) : (
          <>
            {notRun('Claude Code CLI')}
            {notRun('Logged in')}
            {notRun('First-run setup')}
          </>
        )}
      </div>

      {!running && result && !result.binary.ok && (
        <div className={v.callout}>
          <Terminal size={16} />
          <div>
            Install the CLI with <span className={v.code}>claude install</span> (it lands in{' '}
            <span className={v.code}>~/.local/bin</span>), or point YANTRA at your <span className={v.code}>claude</span> binary with the path field.
          </div>
        </div>
      )}
      {!running && needsTerminal && (
        <div className={v.callout}>
          <Terminal size={16} />
          <div>
            Open a terminal, run <span className={v.code}>claude</span> once, pick a theme and log in, then type{' '}
            <span className={v.code}>/exit</span>. YANTRA never shows these screens inside a stage.
          </div>
        </div>
      )}

      <div>
        <Button icon={RotateCw} size="sm" loading={running} onClick={onRetry}>
          Check again
        </Button>
      </div>
    </div>
  );
}
