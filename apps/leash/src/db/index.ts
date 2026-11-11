import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export { schema };

/** Open (and migrate) a database. Pass ":memory:" for tests. */
export function createDb(path: string, migrationsFolder: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

// One connection per process; survives Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __leashDb?: Db };

/** The app database. Both `next` and the scripts run with apps/leash as the working directory. */
export function getDb(): Db {
  globalForDb.__leashDb ??= createDb(
    process.env.LEASH_DB_PATH ?? join(process.cwd(), "data", "leash.db"),
    join(process.cwd(), "drizzle"),
  );
  return globalForDb.__leashDb;
}
