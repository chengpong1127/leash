/**
 * Clears events, challenges and passkey ceremonies. Keeps sites, users, passkeys and links.
 *
 *   --prefill-jobs   also record five job applications for today for the demo user, so the
 *                    sixth application is blocked by the daily limit straight away.
 *                    (The jobs app's own reset script adds the matching application rows.)
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { newId } from "../src/lib/ids";

const db = getDb();
const events = db.delete(schema.events).run().changes;
const challenges = db.delete(schema.challenges).run().changes;
db.delete(schema.ceremonies).run();
console.log(`[leash] cleared ${events} events and ${challenges} challenges`);

if (process.argv.includes("--prefill-jobs")) {
  const siteId = process.env.JOBS_LEASH_SITE_ID;
  if (!siteId) throw new Error("Missing JOBS_LEASH_SITE_ID — copy .env.example to .env at the repo root.");
  const siteUserId = "u_demo"; // the seeded demo user's id on the job board
  const link = db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.siteId, siteId), eq(schema.links.siteUserId, siteUserId)))
    .get();

  const jobs = [
    ["frontend-engineer", "Frontend Engineer", "Lumen Labs"],
    ["backend-engineer", "Backend Engineer", "Northwind Freight"],
    ["product-designer", "Product Designer", "Paperplane"],
    ["data-analyst", "Data Analyst", "Greenhouse Grocers"],
    ["devops-engineer", "DevOps Engineer", "Cobalt Cloud"],
  ] as const;

  // A few minutes apart, but never before today's midnight (the daily counter uses local days).
  const now = Date.now();
  const midnight = new Date().setHours(0, 0, 0, 0);
  jobs.forEach(([jobId, title, company], i) => {
    db.insert(schema.events)
      .values({
        id: newId("ev"),
        siteId,
        siteUserId,
        userId: link?.userId ?? null,
        action: "submit_application",
        params: { job_id: jobId },
        summary: `Apply to ${title} at ${company}`,
        outcome: "auto_allowed",
        createdAt: new Date(Math.max(midnight, now - (jobs.length - i) * 3 * 60 * 1000)),
      })
      .run();
  });
  console.log(`[leash] prefilled ${jobs.length} job applications for today (${siteUserId} on ${siteId})`);
}
