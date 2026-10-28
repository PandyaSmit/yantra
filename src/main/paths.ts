import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where config.json lives. YANTRA_HOME overrides it (tests, a second dev profile). */
export function yantraHome(): string {
  return process.env.YANTRA_HOME || join(homedir(), 'Yantra');
}

export function configPath(): string {
  return join(yantraHome(), 'config.json');
}

export function dbPath(dataRoot: string): string {
  return join(dataRoot, 'yantra.db');
}
