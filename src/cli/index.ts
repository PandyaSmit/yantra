// The `yantra` command: a thin client. It sends argv to the running app over a local socket and
// prints the answer; when the app isn't running it starts it in the background (no window) first.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { GUIDE, HELP } from '../main/cliText';
import { cliSocket } from '../main/paths';

interface Reply {
  out: string;
  code: number;
}

function ask(argv: string[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sock = connect(cliSocket());
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify({ argv, cwd: process.cwd() }) + '\n'));
    sock.on('data', (c: string) => (buf += c));
    sock.on('end', () => {
      try {
        resolve(JSON.parse(buf) as Reply);
      } catch {
        reject(new Error('YANTRA sent an unreadable reply'));
      }
    });
    sock.on('error', reject);
  });
}

const notRunning = (e: unknown) => ['ENOENT', 'ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code ?? '');

function startApp(): void {
  // Under plain Node (or ELECTRON_RUN_AS_NODE) the electron package resolves to the binary's path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as unknown as string;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(electron, [join(__dirname, '../..'), '--background'], { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const first = argv[0] ?? 'help';
  if (first === 'help' || first === '--help' || first === '-h' || first === 'guide') {
    process.stdout.write((first === 'guide' ? GUIDE : HELP).trimEnd() + '\n');
    return 0;
  }
  let reply: Reply | null = null;
  try {
    reply = await ask(argv);
  } catch (e) {
    if (!notRunning(e)) throw e;
    if (first === 'quit') {
      process.stdout.write('YANTRA is not running\n');
      return 0;
    }
    process.stderr.write('Starting YANTRA in the background…\n');
    startApp();
    for (let i = 0; i < 60 && !reply; i++) {
      await new Promise((r) => setTimeout(r, 500));
      reply = await ask(argv).catch((err: unknown) => {
        if (notRunning(err)) return null;
        throw err;
      });
    }
    if (!reply) throw new Error('YANTRA did not start within 30 s. Try running the app once (npm run start) to see why.');
  }
  process.stdout.write(reply.out);
  return reply.code;
}

main().then(
  (code) => (process.exitCode = code),
  (e: unknown) => {
    process.stderr.write(`Error: ${(e as Error).message}\n`);
    process.exitCode = 1;
  },
);
