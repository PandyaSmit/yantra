// SQLite: one file, WAL, foreign keys on, migrations tracked by PRAGMA user_version.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_V1 } from './schema';

export type Db = Database.Database;

/** Migration N (1-based) brings user_version from N-1 to N. Append only; never edit a shipped one. */
export const MIGRATIONS: readonly string[] = [SCHEMA_V1];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Runs every pending migration, each in its own transaction. Returns the resulting version. */
export function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > migrations.length) {
    throw new Error(`Database is version ${current}, newer than this app (${migrations.length}). Update YANTRA.`);
  }
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return migrations.length;
}
