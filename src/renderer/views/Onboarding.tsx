import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui';
import { navigate } from '../actions';
import { Logo } from '../shell/Logo';
import { AddProjectWizard } from './AddProjectWizard';
import v from './views.module.css';

/** First launch with no projects: a welcome with one action, then the add-project wizard. */
export function Onboarding() {
  const [started, setStarted] = useState(false);
  return (
    <div className={v.fullscreen}>
      <div className={`${v.dragBar} drag`} />
      <div className={v.fullscreenBody}>
        {!started ? (
          <div className={v.hero}>
            <Logo size={56} />
            <h1 className={v.heroTitle}>Welcome to YANTRA</h1>
            <p className={v.heroText}>
              A board for each project, and a calm pipeline for every issue: research, plan, code and review, each a live Claude session that waits for
              your approval.
            </p>
            <div className={v.heroSteps}>
              {[
                ['Write issues', 'Each project gets its own local board.'],
                ['Run stages', 'Claude works in a worktree; you steer.'],
                ['Ship', 'Push the branch. You open the PR and merge.'],
              ].map(([t, d], i) => (
                <div key={t} className={v.heroStep}>
                  <div className={v.heroStepNum}>
                    {i + 1}. {t}
                  </div>
                  <div className={v.heroStepText}>{d}</div>
                </div>
              ))}
            </div>
            <Button variant="primary" iconRight={ArrowRight} onClick={() => setStarted(true)} autoFocus>
              Add your first project
            </Button>
          </div>
        ) : (
          <div style={{ marginTop: '4vh', width: '100%', display: 'grid', placeItems: 'center' }}>
            <AddProjectWizard onDone={(slug) => navigate({ view: 'board', project: slug })} onCancel={() => setStarted(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
