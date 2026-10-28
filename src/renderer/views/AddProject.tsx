import { navigate } from '../actions';
import { AddProjectWizard } from './AddProjectWizard';
import v from './views.module.css';

export function AddProject() {
  return (
    <div className={v.page} style={{ display: 'grid', placeItems: 'center' }}>
      <AddProjectWizard onDone={(slug) => navigate({ view: 'board', project: slug })} onCancel={() => navigate({ view: 'board' })} />
    </div>
  );
}
