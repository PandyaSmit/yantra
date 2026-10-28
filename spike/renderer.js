const term = new Terminal({
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  fontSize: 13,
  cursorBlink: true,
  theme: { background: '#0e0f11', foreground: '#e7e9ec' },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));
fit.fit();

window.api.onData((d) => term.write(d));
term.onData((d) => window.api.input(d));
window.addEventListener('resize', () => {
  fit.fit();
  window.api.resize({ cols: term.cols, rows: term.rows });
});
window.api.start({ cols: term.cols, rows: term.rows });
term.focus();
