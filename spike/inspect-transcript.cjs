// node inspect-transcript.cjs <transcript.jsonl>
// Reports line types, duplicate message.id lines, deduped usage, sidechain lines and
// any subagent files next to the transcript. Writes nothing.
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2];
const report = (f) => {
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const types = {};
  const byId = new Map();
  let sidechain = 0;
  let bad = 0;
  for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch { bad++; continue; }
    types[o.type] = (types[o.type] || 0) + 1;
    if (o.isSidechain) sidechain++;
    if (o.type === 'assistant' && o.message?.id) {
      const e = byId.get(o.message.id) || { count: 0, usage: o.message.usage, model: o.message.model };
      e.count++;
      byId.set(o.message.id, e);
    }
  }
  const dupIds = [...byId.values()].filter((e) => e.count > 1).length;
  const sum = (k, rows) => rows.reduce((a, e) => a + (e.usage?.[k] || 0), 0);
  const unique = [...byId.values()];
  const assistantLines = [];
  for (const l of lines) { try { const o = JSON.parse(l); if (o.type === 'assistant') assistantLines.push(o.message); } catch {} }
  return {
    file: path.basename(f),
    lines: lines.length,
    unparsable: bad,
    types,
    sidechainLines: sidechain,
    assistantMessages: unique.length,
    assistantLines: assistantLines.length,
    idsWithDuplicateLines: dupIds,
    models: [...new Set(unique.map((e) => e.model))],
    usageDeduped: Object.fromEntries(['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].map((k) => [k, sum(k, unique)])),
    usageNaiveSumOfLines: Object.fromEntries(['input_tokens', 'output_tokens'].map((k) => [k, sum(k, assistantLines.map((m) => ({ usage: m?.usage })))])),
    usageKeys: Object.keys(unique[0]?.usage || {}),
  };
};

const out = { main: report(file) };
const sideDir = path.join(path.dirname(file), path.basename(file, '.jsonl'));
if (fs.existsSync(sideDir)) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(sideDir);
  out.siblingDir = files.map((f) => path.relative(path.dirname(file), f));
  out.subagents = files.filter((f) => f.endsWith('.jsonl')).map(report);
}
console.log(JSON.stringify(out, null, 2));
