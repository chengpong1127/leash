import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { type LeashConfig, createLeash } from "./index";

const quiet = { info() {}, warn() {} };
const base: LeashConfig = {
  siteId: "site_shop",
  secret: "s",
  leashUrl: "http://127.0.0.1:9",
  getUserId: (req) => req.get("x-user"),
  pushManifest: false,
  timeoutMs: 500,
  logger: quiet,
  actions: {
    purchase: {
      label: "Purchase items",
      mode: "auto",
      constraints: { amount: { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 100, ceiling: 5000 } },
    },
  },
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function listen(server: Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

/** A port nothing is listening on. */
async function closedPort(): Promise<string> {
  const server = createServer();
  const url = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  await new Promise((r) => server.close(r));
  return url;
}

/** A fake Leash that answers every request the same way. */
const fakeLeash = (status: number, body: string) =>
  listen(createServer((_req, res) => res.writeHead(status, { "content-type": "application/json" }).end(body)));

/** An Express site protected by the SDK; `reached` records whether the real handler ever ran. */
async function siteWith(leashUrl: string) {
  const leash = createLeash({ ...base, leashUrl });
  const reached: string[] = [];
  const app = express();
  app.use(express.json(), express.urlencoded({ extended: false }));
  app.post(
    "/buy",
    leash.protect("purchase", () => ({ amount: 50, summary: "Coffee — $50" })),
    (req, res) => {
      reached.push(req.get("x-user") ? "handler" : "site-auth");
      res.status(req.get("x-user") ? 200 : 401).json({ ok: Boolean(req.get("x-user")) });
    },
  );
  app.get("/settings", leash.settingsHandler(), (_req, res) => {
    reached.push("site-auth");
    res.status(401).end();
  });
  const url = await listen(createServer(app));
  const json = (headers: Record<string, string> = { "x-user": "42" }) =>
    fetch(`${url}/buy`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  const form = () =>
    fetch(`${url}/buy`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-user": "42" },
      body: "x=1",
    });
  const settings = () => fetch(`${url}/settings`, { redirect: "manual", headers: { accept: "text/html", "x-user": "42" } });
  return { reached, json, form, settings };
}

describe("createLeash config validation", () => {
  it("accepts a valid config and fills fail-safe values", () => {
    const leash = createLeash({ ...base, actions: { change_address: { label: "Change shipping address" } } });
    expect(leash.manifest.actions.change_address!.mode).toBe("human");
  });

  it("throws when default exceeds ceiling", () => {
    expect(() =>
      createLeash({
        ...base,
        actions: { purchase: { label: "Purchase", mode: "auto", constraints: { amount: { type: "max", param: "amount", label: "Limit ($)", default: 9000, ceiling: 5000 } } } },
      }),
    ).toThrow(/default \(9000\) must be <= ceiling \(5000\)/);
  });

  it("throws when credentials are missing", () => {
    expect(() => createLeash({ ...base, secret: "" })).toThrow(/secret/);
    expect(() => createLeash({ ...base, siteId: "" })).toThrow(/siteId/);
    expect(() => createLeash({ ...base, leashUrl: "" })).toThrow(/leashUrl/);
  });

  it("throws when protecting an action that is not declared", () => {
    expect(() => createLeash(base).protect("wire_money", () => ({}))).toThrow(/not declared/);
  });

  it("builds verify URLs on the Leash origin", () => {
    expect(createLeash({ ...base, leashUrl: "http://localhost:3000/" }).verifyUrl("ch_a/b")).toBe("http://localhost:3000/verify/ch_a%2Fb");
  });
});

describe("fail closed", () => {
  it("responds 503 and never runs the handler when Leash is down (JSON)", async () => {
    const site = await siteWith(await closedPort());
    const res = await site.json();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "leash_unavailable" });
    expect(site.reached).toEqual([]);
  });

  it("responds 503 and never runs the handler when Leash is down (HTML form)", async () => {
    const site = await siteWith(await closedPort());
    const res = await site.form();
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/was not performed/);
    expect(site.reached).toEqual([]);
  });

  it("responds 503 when Leash does not answer in time", async () => {
    const hanging = await listen(createServer(() => {})); // accepts the connection, never responds
    const site = await siteWith(hanging);
    expect((await site.json()).status).toBe(503);
    expect(site.reached).toEqual([]);
    servers.forEach((s) => s.closeAllConnections());
  });

  it.each([
    ["an error status", 500, '{"error":"internal_error"}'],
    ["401 unauthorized", 401, '{"error":"unauthorized"}'],
    ["garbage instead of JSON", 200, "<html>oops</html>"],
    ["JSON without a decision", 200, "{}"],
    ["an unknown decision", 200, '{"decision":"maybe"}'],
    ["null", 200, "null"],
  ])("responds 503 when Leash returns %s", async (_name, status, body) => {
    const site = await siteWith(await fakeLeash(status, body));
    expect((await site.json()).status).toBe(503);
    expect((await site.form()).status).toBe(503);
    expect(site.reached).toEqual([]);
  });

  it("settingsHandler responds 503 when Leash is down or confused", async () => {
    for (const leashUrl of [await closedPort(), await fakeLeash(500, "{}"), await fakeLeash(200, '{"decision":"allow","verified":false}')]) {
      const site = await siteWith(leashUrl);
      expect((await site.settings()).status).toBe(503);
      expect(site.reached).toEqual([]);
    }
  });

  it("only an explicit allow lets the request through", async () => {
    const site = await siteWith(await fakeLeash(200, '{"decision":"allow","verified":false}'));
    expect((await site.json()).status).toBe(200);
    expect(site.reached).toEqual(["handler"]);
  });

  it("leaves requests without a logged-in user to the site, without calling Leash", async () => {
    const site = await siteWith(await closedPort());
    expect((await site.json({})).status).toBe(401);
    expect(site.reached).toEqual(["site-auth"]);
  });
});
