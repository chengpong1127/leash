/** Seeds the demo user and products. Idempotent. */
import { db } from "./db";
import { hashPassword } from "./password";

db.prepare(
  `INSERT INTO users (id, email, name, password_hash, address) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, password_hash = excluded.password_hash`,
).run("u_demo", "demo@example.com", "Demo User", hashPassword("demo1234"), "1 Market Street, San Francisco, CA 94105");

const products = [
  ["coffee-beans", "Coffee beans", 50, "Single-origin whole beans, 1 kg bag. Roasted this week.", "☕"],
  ["desk-lamp", "Desk lamp", 80, "Dimmable LED lamp with a warm-to-cool colour dial.", "💡"],
  ["wireless-headphones", "Wireless headphones", 1500, "Studio-grade noise-cancelling headphones with a 40-hour battery.", "🎧"],
  ["notebook-set", "Notebook set", 18, "Three dot-grid notebooks, 120 pages each.", "📓"],
  ["mechanical-keyboard", "Mechanical keyboard", 140, "Compact 75% layout with hot-swappable tactile switches.", "⌨️"],
  ["espresso-machine", "Espresso machine", 650, "Dual-boiler machine with a built-in grinder.", "🫖"],
] as const;

const upsert = db.prepare(
  `INSERT INTO products (id, name, price, description, emoji, position) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET name = excluded.name, price = excluded.price,
     description = excluded.description, emoji = excluded.emoji, position = excluded.position`,
);
products.forEach((p, i) => upsert.run(...p, i));

console.log(`[shop] seeded demo@example.com and ${products.length} products`);
