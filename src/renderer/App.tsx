import { Shell } from './shell/Shell';
import { useStore } from './store';
import { useThemeSync } from './lib/hooks';
import { ConfigError } from './views/ConfigError';
import { Onboarding } from './views/Onboarding';
import { Splash } from './views/Splash';

export function App() {
  useThemeSync();
  const status = useStore((s) => s.status);
  const hasProjects = useStore((s) => (s.config?.projects.length ?? 0) > 0);

  if (status === 'loading') return <Splash />;
  if (status === 'config-error') return <ConfigError />;
  if (!hasProjects) return <Onboarding />;
  return <Shell />;
}
