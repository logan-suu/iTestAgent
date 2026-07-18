import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.js';

/**
 * Create a Drizzle database instance backed by bun:sqlite.
 *
 * @param dbPath - Path to the SQLite file
 * @returns Drizzle ORM instance with schema
 */
export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  // Enable WAL mode for better concurrent read performance
  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export type DbClient = ReturnType<typeof createDb>;
