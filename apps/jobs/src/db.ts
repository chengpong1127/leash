import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

// The job board's own database: users, sessions, jobs, applications. Leash needs no tables here.
const path = process.env.JOBS_DB_PATH ?? join(import.meta.dirname, "..", "data", "jobs.db");
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    salary TEXT NOT NULL,
    description TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    job_id TEXT NOT NULL REFERENCES jobs(id),
    human_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

export interface User { id: string; email: string; name: string; password_hash: string }
export interface Job { id: string; title: string; company: string; location: string; salary: string; description: string }
export interface Application { id: string; user_id: string; job_id: string; human_verified: number; created_at: number }

export const listJobs = () => db.prepare("SELECT * FROM jobs ORDER BY position").all() as Job[];
export const getJob = (id: string) => db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
