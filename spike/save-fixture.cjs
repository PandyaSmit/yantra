// node save-fixture.cjs <transcript.jsonl>
// Copies a transcript (and its subagents/ folder) into fixtures/transcripts/, redacted:
// request-shape/blob lines are stubbed, and the user's email, username and org ids are replaced.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const src = process.argv[2];
const dest = path.join(__dirname, '..', 'fixtures', 'transcripts');
const user = os.userInfo().username;
const email = process.env.FIXTURE_EMAIL || '';
const STUB = new Set(['api-request-shape', 'api-request-blob']);

const redact = (text) => {
  let t = text;
  if (email) t = t.split(email).join('user@example.invalid');
  t = t.split(user).join('user');
  t = t.replace(/("(?:organization|account|org|user)(?:Uuid|Id|_uuid|_id)"\s*:\s*")[^"]+"/gi, '$1REDACTED"');
  return t;
};

const copy = (from, to) => {
  const lines = fs.readFileSync(from, 'utf8').split('\n').filter(Boolean).map((l) => {
    const o = JSON.parse(l);
    return STUB.has(o.type) ? JSON.stringify({ type: o.type, sessionId: o.sessionId, timestamp: o.timestamp, redacted: true }) : l;
  });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, redact(lines.join('\n') + '\n'));
};

copy(src, path.join(dest, 'main.jsonl'));
const side = path.join(path.dirname(src), path.basename(src, '.jsonl'), 'subagents');
if (fs.existsSync(side)) {
  for (const f of fs.readdirSync(side)) {
    const to = path.join(dest, 'main', 'subagents', f);
    if (f.endsWith('.jsonl')) copy(path.join(side, f), to);
    else fs.writeFileSync(to, redact(fs.readFileSync(path.join(side, f), 'utf8')));
  }
}
console.log('saved to', dest);
