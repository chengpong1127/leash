/** Creates the demo sites in the Leash database with secrets matching the root .env. Idempotent. */
import { getDb, schema } from "../src/db";
import { hashSecret } from "../src/lib/ids";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy .env.example to .env at the repo root.`);
  return v;
}

const sites = [
  { id: env("SHOP_LEASH_SITE_ID"), name: "Shop", origin: env("SHOP_URL"), secret: env("SHOP_LEASH_SITE_SECRET") },
  { id: env("JOBS_LEASH_SITE_ID"), name: "Jobs", origin: env("JOBS_URL"), secret: env("JOBS_LEASH_SITE_SECRET") },
];

const db = getDb();
for (const s of sites) {
  const secretHash = hashSecret(s.secret);
  db.insert(schema.sites)
    // The manifest starts empty; each site's SDK pushes the real one when it boots.
    .values({ id: s.id, name: s.name, origin: s.origin, secretHash, manifest: { actions: {} }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.sites.id, set: { name: s.name, origin: s.origin, secretHash } })
    .run();
  console.log(`[leash] site ready: ${s.id} (${s.name}, ${s.origin})`);
}
