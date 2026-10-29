import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where config.json lives. YANTRA_HOME overrides it (tests, a second dev profile). */
export function yantraHome(): string {
  return process.env.YANTRA_HOME || join(homedir(), 'Yantra');
}

export function configPath(): string {
  return join(yantraHome(), 'config.json');
}

/** The local socket the `yantra` CLI talks to the app over; one per YANTRA_HOME. */
export function cliSocket(): string {
  if (process.platform !== 'win32') return join(yantraHome(), 'yantra.sock');
  return `\\\\.\\pipe\\yantra-${createHash('sha1').update(yantraHome().toLowerCase()).digest('hex').slice(0, 10)}`;
}

export function dbPath(dataRoot: string): string {
  return join(dataRoot, 'yantra.db');
}
