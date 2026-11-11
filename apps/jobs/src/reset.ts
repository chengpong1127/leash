/**
 * Clears applications. Keeps users and jobs.
 * With --prefill-jobs: records five applications for the demo user today, so the sixth is blocked
 * immediately (the Leash-side reset records the matching five auto-allowed events).
 */
import { randomBytes } from "node:crypto";
import { db, listJobs } from "./db";

console.log(`[jobs] cleared ${db.prepare("DELETE FROM applications").run().changes} applications`);

if (process.argv.includes("--prefill-jobs")) {
  const now = Date.now();
  const midnight = new Date().setHours(0, 0, 0, 0);
  const insert = db.prepare("INSERT INTO applications (id, user_id, job_id, human_verified, created_at) VALUES (?, ?, ?, 0, ?)");
  const jobs = listJobs().slice(0, 5);
  jobs.forEach((job, i) => {
    // A few minutes apart, but never before today's midnight.
    const createdAt = Math.max(midnight, now - (jobs.length - i) * 3 * 60 * 1000);
    insert.run(`app_${randomBytes(6).toString("hex")}`, "u_demo", job.id, createdAt);
  });
  console.log(`[jobs] prefilled ${jobs.length} applications for demo@example.com today`);
}
