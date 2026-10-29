import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { SquareTerminal } from 'lucide-react';
import type { RunInfo } from '@shared/sessions';
import type { TaskDetail } from '@shared/tasks';
import { EmptyState, Pill, Select } from '../ui';
import { useStore } from '../store';
import t from './task.module.css';

/** xterm colours from the design tokens, so the terminal follows the app theme. */
function themeFromTokens(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v('--card'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--card'),
    selectionBackground: v('--accent-soft'),
    black: v('--text-muted'),
    red: v('--red'),
    green: v('--green'),
    yellow: v('--amber'),
    blue: v('--blue'),
    magenta: v('--violet'),
    cyan: v('--teal'),
    white: v('--text'),
    brightBlack: v('--text-faint'),
    brightRed: v('--red-fg'),
    brightGreen: v('--green-fg'),
    brightYellow: v('--amber-fg'),
    brightBlue: v('--blue-fg'),
    brightMagenta: v('--violet-fg'),
    brightCyan: v('--teal-fg'),
    brightWhite: v('--text'),
  };
}

/** Runs of a task, newest first, refetched when the task changes. */
function useRuns(taskId: number) {
  const [runs, setRuns] = useState<RunInfo[] | null>(null);
  const refresh = useCallback(() => void window.api.invoke['sessions:runs']({ taskId }).then(setRuns, () => setRuns([])), [taskId]);
  useEffect(() => {
    refresh();
    const offs = [window.api.on('task:changed', (e) => e.taskId === taskId && refresh()), window.api.on('pty:exit', () => refresh())];
    return () => offs.forEach((off) => off());
  }, [taskId, refresh]);
  return runs;
}

const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const runLabel = (r: RunInfo) =>
  `${r.stageTitle} · ${r.kind === 'resume' ? 'resumed' : 'started'} ${time(r.startedAt)}${r.live ? ' · live' : r.exitNote === 'trust_prompt' ? ' · exited at trust prompt' : r.exitNote === 'stopped' ? ' · stopped' : ''}`;

/** The Terminal sub-tab: the current stage's live session, or a past run's output (read-only). */
export function TerminalTab({ task }: { task: TaskDetail }) {
  const runs = useRuns(task.id);
  const liveRun = task.stages.find((s) => s.liveRunId !== null)?.liveRunId ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  // Follow the live run unless I picked a past one; a new live run takes over again.
  useEffect(() => setPicked(null), [liveRun]);
  const runId = picked ?? liveRun ?? runs?.[0]?.id ?? null;
  const run = runs?.find((r) => r.id === runId);
  const stage = task.stages.find((s) => s.id === run?.stageId);

  if (runs && runs.length === 0)
    return (
      <EmptyState
        icon={SquareTerminal}
        title="No session yet"
        hint={task.status === 'draft' ? 'Press Start to launch the first stage. Its Claude session appears here and you can type into it.' : 'When a stage runs, its Claude session appears here.'}
      />
    );

  return (
    <div className={t.terminalTab}>
      <div className={t.terminalBar}>
        <Select aria-label="Session" value={runId ?? ''} onChange={(e) => setPicked(Number(e.target.value))} className={t.runPicker}>
          {runs?.map((r) => (
            <option key={r.id} value={r.id}>
              {runLabel(r)}
            </option>
          ))}
        </Select>
        {stage && run?.live && <Pill status={stage.status} />}
        {run && !run.live && <span className={t.terminalNote}>Read-only: this session has ended.</span>}
        {run?.live && <span className={t.terminalNote}>Typing goes straight to Claude.</span>}
      </div>
      {runId !== null && run && <TerminalView key={runId} runId={runId} live={run.live} />}
    </div>
  );
}

function TerminalView({ runId, live }: { runId: number; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.theme);
  const term = useRef<XTerm | null>(null);
  // When a live run ends, the view rebuilds read-only from the saved buffer.
  const opts = useMemo(() => ({ live }), [live]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const x = new XTerm({
      fontFamily: css.getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: opts.live,
      disableStdin: !opts.live,
      scrollback: 5000,
      allowProposedApi: false,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    x.loadAddon(fit);
    x.open(el);
    term.current = x;

    let attached = false;
    const early: string[] = [];
    const offData = window.api.on('pty:data', (d) => {
      if (d.runId !== runId) return;
      if (attached) x.write(d.data);
      else early.push(d.data);
    });
    const offExit = window.api.on('pty:exit', (e) => {
      if (e.runId !== runId) return;
      x.options.disableStdin = true;
      x.options.cursorBlink = false;
      x.write(`\r\n\x1b[2m[session ended${e.exitCode ? `, exit code ${e.exitCode}` : ''}]\x1b[0m\r\n`);
    });
    // Chunks that arrived before the snapshot are already in it (main sends both in order).
    void window.api.invoke['sessions:attach']({ runId }).then(({ data }) => {
      early.length = 0;
      attached = true;
      x.write(data);
    });

    const sendSize = () => {
      try {
        fit.fit();
      } catch {
        return; // not laid out yet
      }
      if (opts.live) void window.api.invoke['pty:resize']({ runId, cols: x.cols, rows: x.rows });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(sendSize, 60);
    });
    ro.observe(el);
    sendSize();
    const input = x.onData((d) => opts.live && void window.api.invoke['pty:input']({ runId, data: d }));
    if (opts.live) x.focus();

    return () => {
      clearTimeout(timer);
      ro.disconnect();
      input.dispose();
      offData();
      offExit();
      x.dispose();
      term.current = null;
    };
  }, [runId, opts]);

  useEffect(() => {
    // After the data-theme attribute (and so the tokens) has switched.
    const raf = requestAnimationFrame(() => {
      if (term.current) term.current.options.theme = themeFromTokens();
    });
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  return <div ref={host} className={t.terminal} onClick={() => term.current?.focus()} />;
}
