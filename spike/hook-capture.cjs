// Spike hook runner. Claude runs it through the hook wrapper for every hook event.
// - saves each raw payload to fixtures/hooks/<event>-<n>.json (first 3 per event)
// - appends a summary line to $YANTRA_TASK_DIR/log/hooks.jsonl
// - on PreToolUse, blocks any Bash/PowerShell command containing "git push" (exit 2)
const fs = require('node:fs');
const path = require('node:path');

const started = Date.now();
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  // Strip a UTF-8 BOM: Windows shells can add one when piping.
  const raw = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { unparsed: raw };
  }
  const event = payload.hook_event_name || 'Unknown';
  const taskDir = process.env.YANTRA_TASK_DIR || path.join(__dirname, 'out', 'task');
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'hooks');
  fs.mkdirSync(path.join(taskDir, 'log'), { recursive: true });
  fs.mkdirSync(fixturesDir, { recursive: true });

  for (let n = 1; n <= 3; n++) {
    const f = path.join(fixturesDir, `${event}-${n}.json`);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, JSON.stringify(payload, null, 2));
      break;
    }
  }

  const input = payload.tool_input || {};
  const summary = String(input.command || input.file_path || input.pattern || input.prompt || '').slice(0, 300);
  let blocked = false;
  if (event === 'PreToolUse' && /^(Bash|PowerShell)$/.test(payload.tool_name || '')) {
    const cmd = String(input.command || '').replace(/["'`]/g, '').replace(/\s+/g, ' ');
    if (cmd.includes('git push')) blocked = true;
  }

  const line = {
    ts: Date.now(),
    runId: process.env.YANTRA_RUN_ID || null,
    stage: process.env.YANTRA_STAGE || null,
    event,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    tool: payload.tool_name || null,
    summary,
    blocked,
    elapsedMs: Date.now() - started,
    nodeVersion: process.versions.node,
    electron: process.versions.electron || null,
  };
  fs.appendFileSync(path.join(taskDir, 'log', 'hooks.jsonl'), JSON.stringify(line) + '\n');

  if (blocked) {
    process.stderr.write('YANTRA: "git push" is not allowed. Only the YANTRA app pushes, after the human clicks Push.\n');
    process.exit(2);
  }
  process.exit(0);
});
