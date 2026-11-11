import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

// The shop's own database: users, sessions, products, orders. Leash needs no tables here.
const path = process.env.SHOP_DB_PATH ?? join(import.meta.dirname, "..", "data", "shop.db");
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,           -- whole dollars
    description TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    human_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

export interface User { id: string; email: string; name: string; password_hash: string; address: string }
export interface Product { id: string; name: string; price: number; description: string; emoji: string }
export interface Order { id: string; user_id: string; product_id: string; product_name: string; amount: number; human_verified: number; created_at: number }

export const listProducts = () => db.prepare("SELECT * FROM products ORDER BY position").all() as Product[];
export const getProduct = (id: string) => db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Product | undefined;
