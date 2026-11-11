/** Clears applications. Keeps users and jobs. (--prefill-jobs arrives with milestone 5.) */
import { db } from "./db";

console.log(`[jobs] cleared ${db.prepare("DELETE FROM applications").run().changes} applications`);
