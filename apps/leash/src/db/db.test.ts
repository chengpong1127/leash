import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "./index";

const migrations = join(import.meta.dirname, "../../drizzle");

describe("leash database", () => {
  it("migrates an empty database and round-trips JSON columns", () => {
    const db = createDb(":memory:", migrations);
    const manifest = { actions: { change_address: { label: "Change address", mode: "human" as const, userConfigurable: true, constraints: {} } } };
    db.insert(schema.sites).values({ id: "site_x", name: "X", origin: "http://x.test", secretHash: "h", manifest, updatedAt: new Date() }).run();
    const site = db.select().from(schema.sites).where(eq(schema.sites.id, "site_x")).get();
    expect(site?.manifest).toEqual(manifest);
  });

  it("allows only one link per site user", () => {
    const db = createDb(":memory:", migrations);
    db.insert(schema.sites).values({ id: "site_x", name: "X", origin: "http://x.test", secretHash: "h", manifest: { actions: {} }, updatedAt: new Date() }).run();
    const link = { userId: "u1", siteId: "site_x", siteUserId: "42", policy: { actions: {} }, createdAt: new Date() };
    db.insert(schema.links).values({ id: "l1", ...link }).run();
    expect(() => db.insert(schema.links).values({ id: "l2", ...link, userId: "u2" }).run()).toThrow(/UNIQUE/);
  });
});
