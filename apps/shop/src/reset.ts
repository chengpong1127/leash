/** Clears orders. Keeps users and products. */
import { db } from "./db";

console.log(`[shop] cleared ${db.prepare("DELETE FROM orders").run().changes} orders`);
