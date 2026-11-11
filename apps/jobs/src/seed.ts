/** Seeds the demo user and jobs. Idempotent. */
import { db } from "./db";
import { hashPassword } from "./password";

db.prepare(
  `INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, password_hash = excluded.password_hash`,
).run("u_demo", "demo@example.com", "Demo User", hashPassword("demo1234"));

const jobs = [
  ["frontend-engineer", "Frontend Engineer", "Lumen Labs", "Remote", "$130k – $160k", "Build fast, accessible interfaces in React and TypeScript for our analytics product."],
  ["backend-engineer", "Backend Engineer", "Northwind Freight", "Austin, TX", "$140k – $170k", "Design and run the APIs that route forty thousand shipments a day."],
  ["product-designer", "Product Designer", "Paperplane", "New York, NY", "$120k – $150k", "Own design end to end for a collaborative writing tool used by newsrooms."],
  ["data-analyst", "Data Analyst", "Greenhouse Grocers", "Chicago, IL", "$90k – $110k", "Turn store and supply data into decisions for our regional buyers."],
  ["devops-engineer", "DevOps Engineer", "Cobalt Cloud", "Remote", "$145k – $175k", "Keep deploys boring: CI pipelines, Kubernetes and on-call tooling."],
  ["ml-engineer", "Machine Learning Engineer", "Tidepool AI", "San Francisco, CA", "$170k – $210k", "Train and ship ranking models that serve millions of requests per hour."],
  ["product-manager", "Product Manager", "Harbor Health", "Boston, MA", "$135k – $165k", "Lead the patient scheduling roadmap with clinicians and engineers."],
  ["qa-engineer", "QA Engineer", "Pixel Forge Games", "Seattle, WA", "$95k – $120k", "Build automated test suites for a cross-platform multiplayer game."],
  ["technical-writer", "Technical Writer", "Ledgerline", "Remote", "$85k – $105k", "Write the API guides and tutorials developers actually finish."],
  ["support-engineer", "Support Engineer", "Relay Systems", "Denver, CO", "$80k – $100k", "Debug customer integrations and feed what you learn back to the product team."],
] as const;

const upsert = db.prepare(
  `INSERT INTO jobs (id, title, company, location, salary, description, position) VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET title = excluded.title, company = excluded.company, location = excluded.location,
     salary = excluded.salary, description = excluded.description, position = excluded.position`,
);
jobs.forEach((j, i) => upsert.run(...j, i));

console.log(`[jobs] seeded demo@example.com and ${jobs.length} jobs`);
