// Run with: ELECTRON_RUN_AS_NODE=1 electron check-native.cjs
// Proves which native/DB modules load under Electron's Node ABI.
// stdout from electron.exe is not visible in a Windows console, so results also go to a file.
const fs = require('node:fs');
const path = require('node:path');
const log = (r) => {
  const text = JSON.stringify(r, null, 2);
  fs.writeFileSync(path.join(__dirname, 'out', 'check-native.json'), text);
  console.log(text);
};
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const results = { electron: process.versions.electron, node: process.versions.node, modules: process.versions.modules };

try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
  results.nodeSqlite = db.prepare('SELECT v FROM t').get().v;
  results.sqliteVersion = db.prepare('select sqlite_version() as v').get().v;
} catch (e) {
  results.nodeSqlite = 'FAIL: ' + e.message;
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  results.betterSqlite3 = db.prepare('select 1 as x').get().x === 1 ? 'ok' : 'odd';
} catch (e) {
  results.betterSqlite3 = 'FAIL: ' + e.message.split('\n')[0];
}

try {
  const pty = require('node-pty');
  const p = pty.spawn('cmd.exe', ['/c', 'echo pty-ok'], { cols: 80, rows: 24 });
  let out = '';
  p.onData((d) => { out += d; });
  p.onExit(({ exitCode }) => {
    results.nodePty = out.includes('pty-ok') ? 'ok' : 'no output: ' + JSON.stringify(out);
    results.nodePtyExit = exitCode;
    log(results);
  });
} catch (e) {
  results.nodePty = 'FAIL: ' + e.message;
  log(results);
}
