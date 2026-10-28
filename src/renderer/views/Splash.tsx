import { Logo } from '../shell/Logo';
import { Skeleton } from '../ui';
import v from './views.module.css';

export function Splash() {
  return (
    <div className={v.fullscreen}>
      <div className={`${v.dragBar} drag`} />
      <div className={v.centered}>
        <div className={v.stack} style={{ alignItems: 'center', width: 220 }}>
          <Logo size={40} />
          <Skeleton width={160} />
          <Skeleton width={110} height={10} />
        </div>
      </div>
    </div>
  );
}
