// The local socket the `yantra` CLI connects to: one JSON line in ({argv, cwd}), one JSON line out ({out, code}).
import { existsSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { runCli, type CliEnv } from './cli';
import { cliSocket } from './paths';

export function startCliServer(env: CliEnv): Server {
  const path = cliSocket();
  if (process.platform !== 'win32' && existsSync(path)) rmSync(path);
  const server = createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let req: { argv: string[]; cwd: string };
      try {
        req = JSON.parse(buf.slice(0, nl)) as { argv: string[]; cwd: string };
      } catch {
        sock.end(JSON.stringify({ out: 'Error: bad request\n', code: 1 }) + '\n');
        return;
      }
      void runCli(env, req.argv, req.cwd).then((r) => sock.end(JSON.stringify(r) + '\n'));
    });
    sock.on('error', () => {});
  });
  server.on('error', (e) => console.error('[cli] could not listen on', path, e));
  server.listen(path);
  return server;
}
