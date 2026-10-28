import { FolderOpen, TriangleAlert } from 'lucide-react';
import { Button, useToast } from '../ui';
import { errorMessage } from '../actions';
import { useStore } from '../store';
import v from './views.module.css';

/** config.json (or the DB) is broken. Fail loudly; never overwrite the user's file. */
export function ConfigError() {
  const err = useStore((s) => s.configError);
  const toast = useToast();
  if (!err) return null;
  const folder = err.path.replace(/[\\/][^\\/]+$/, '');
  return (
    <div className={v.fullscreen}>
      <div className={`${v.dragBar} drag`} />
      <div className={v.fullscreenBody}>
        <div className={`${v.card} ${v.cardPad} ${v.stack}`} style={{ width: 'min(620px, 100%)', marginTop: '8vh' }}>
          <div className={v.row}>
            <TriangleAlert size={22} color="var(--danger)" />
            <h2>{err.error}</h2>
          </div>
          <p className={v.muted}>
            YANTRA won't start with a broken config, and it won't replace your file. Fix the problems below and restart YANTRA.
          </p>
          <div className={v.repoSummary}>
            <span className={v.path}>{err.path}</span>
          </div>
          <ul className={`${v.stackSm} selectable`} style={{ margin: 0, paddingLeft: 18 }}>
            {err.issues.map((i) => (
              <li key={i} className={v.path}>
                {i}
              </li>
            ))}
          </ul>
          <div className={v.row}>
            <Button
              icon={FolderOpen}
              onClick={() => window.api.invoke['shell:openPath']({ path: folder }).catch((e) => toast({ tone: 'error', title: errorMessage(e) }))}
            >
              Open folder
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
