import { useEffect } from 'react';
import { cycleTheme, goBack, navigate, setSidebarCollapsed } from '../actions';
import { store } from '../store';

/** Keeps <html data-theme> in sync. Main sets nativeTheme.themeSource from config, so the media query follows it. */
export function useThemeSync() {
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = mq.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      store.set({ theme });
    };
    apply();
    mq.addEventListener('change', apply);
    const off = window.api.on('theme:changed', apply);
    return () => {
      mq.removeEventListener('change', apply);
      off();
    };
  }, []);
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * App-wide shortcuts: Ctrl+K palette, Ctrl+B sidebar, ? cheat sheet, and two-key "G then …" jumps.
 * Single-letter shortcuts never fire while typing.
 */
export function useGlobalShortcuts(onLetter?: (key: string) => boolean) {
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        store.set((s) => ({ paletteOpen: !s.paletteOpen }));
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed(!store.get().sidebarCollapsed);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void cycleTheme();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
        return;
      }
      if (mod || e.altKey || isTypingTarget(e.target) || store.get().paletteOpen) return;
      if (e.key === '?') {
        store.set({ shortcutsOpen: true });
        return;
      }
      const k = e.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const view = ({ b: 'board', r: 'running', n: 'needs', d: 'done', m: 'metrics', s: 'settings' } as const)[k as 'b'];
        if (view) navigate({ view });
        return;
      }
      if (k === 'g') {
        pendingG = Date.now();
        return;
      }
      // Swallow the key when it opened something, so it isn't typed into the newly focused field.
      if (onLetter?.(k)) e.preventDefault();
    };
    // Mouse "back" button.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [onLetter]);
}

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Search or jump to anything' },
  { keys: ['C'], label: 'New issue' },
  { keys: ['/'], label: 'Focus board search' },
  { keys: ['Enter'], label: 'Open the focused card' },
  { keys: ['Space'], label: 'Pick up or drop the focused card (arrows move it)' },
  { keys: ['Alt', '←'], label: 'Back' },
  { keys: ['Ctrl', 'B'], label: 'Toggle sidebar' },
  { keys: ['Ctrl', 'Shift', 'L'], label: 'Switch theme' },
  { keys: ['G', 'B'], label: 'Go to board' },
  { keys: ['G', 'R'], label: 'Go to running' },
  { keys: ['G', 'N'], label: 'Go to needs you' },
  { keys: ['G', 'D'], label: 'Go to done' },
  { keys: ['G', 'M'], label: 'Go to metrics' },
  { keys: ['G', 'S'], label: 'Go to settings' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['Esc'], label: 'Close dialog or drawer' },
];
