/** Clears events and challenges. Keeps sites, users, passkeys and links. */
import { getDb, schema } from "../src/db";

const db = getDb();
const events = db.delete(schema.events).run().changes;
const challenges = db.delete(schema.challenges).run().changes;
console.log(`[leash] cleared ${events} events and ${challenges} challenges`);
