import { describe, expect, it } from "vitest";
import {
  type ActionsConfig,
  type HistoryEntry,
  ManifestError,
  type Policy,
  canonicalJson,
  defaultPolicy,
  effectivePolicy,
  evaluateAction,
  hashParams,
  normalizeManifest,
  periodStart,
  periodUsage,
  sanitizePolicy,
} from "./index";

const shopActions: ActionsConfig = {
  purchase: {
    label: "Purchase items",
    mode: "auto",
    constraints: {
      amount: { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 100, ceiling: 5000 },
      monthly: { type: "sum_per_period", param: "amount", period: "month", label: "Monthly limit ($)", default: 500, ceiling: 20000 },
    },
  },
  change_address: { label: "Change shipping address", mode: "human" },
};
const jobsActions: ActionsConfig = {
  submit_application: {
    label: "Submit job application",
    mode: "auto",
    constraints: {
      daily: { type: "count_per_period", period: "day", label: "Daily application limit", default: 5, ceiling: 20 },
    },
  },
};
const shop = normalizeManifest(shopActions);
const jobs = normalizeManifest(jobsActions);

const now = new Date(2026, 10, 11, 15, 0, 0); // 11 Nov 2026, 15:00 local
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h);
const bought = (amount: number, when: Date): HistoryEntry => ({ params: { amount }, at: when });

describe("normalizeManifest", () => {
  it("fills in fail-safe values for missing config", () => {
    const m = normalizeManifest({
      thing: { label: "Thing", constraints: { cap: { type: "max", param: "n", label: "Cap" } } },
    });
    expect(m.actions.thing).toEqual({
      label: "Thing",
      mode: "human",
      userConfigurable: true,
      constraints: { cap: { type: "max", param: "n", label: "Cap", default: 0, ceiling: 0 } },
    });
  });

  it("uses the default as the ceiling when no ceiling is given", () => {
    const m = normalizeManifest({ a: { label: "A", mode: "auto", constraints: { c: { type: "max", param: "n", label: "C", default: 7 } } } });
    expect(m.actions.a!.constraints.c!.ceiling).toBe(7);
  });

  it("throws when default exceeds ceiling", () => {
    expect(() =>
      normalizeManifest({ a: { label: "A", constraints: { c: { type: "max", param: "n", label: "C", default: 10, ceiling: 5 } } } }),
    ).toThrow(ManifestError);
  });

  it.each([
    ["non-object", "nope"],
    ["bad mode", { a: { label: "A", mode: "sometimes" } }],
    ["missing label", { a: { mode: "auto" } }],
    ["reserved name", { __link__: { label: "Link" } }],
    ["unknown constraint type", { a: { label: "A", constraints: { c: { type: "allowlist", label: "C" } } } }],
    ["bad period", { a: { label: "A", constraints: { c: { type: "count_per_period", period: "year", label: "C" } } } }],
    ["negative default", { a: { label: "A", constraints: { c: { type: "max", param: "n", label: "C", default: -1 } } } }],
    ["missing param", { a: { label: "A", constraints: { c: { type: "max", label: "C" } } } }],
    ["non-numeric ceiling", { a: { label: "A", constraints: { c: { type: "max", param: "n", label: "C", ceiling: "9" } } } }],
  ])("rejects %s", (_name, input) => {
    expect(() => normalizeManifest(input)).toThrow(ManifestError);
  });
});

describe("defaultPolicy / effectivePolicy", () => {
  it("copies the site's defaults", () => {
    expect(defaultPolicy(shop)).toEqual({
      actions: {
        purchase: { mode: "auto", constraints: { amount: 100, monthly: 500 } },
        change_address: { mode: "human", constraints: {} },
      },
    });
  });

  it("applies manifest defaults when no link exists", () => {
    const eff = effectivePolicy(shop, null);
    expect(eff.purchase).toEqual({ mode: "auto", limits: { amount: 100, monthly: 500 } });
    expect(eff.change_address!.mode).toBe("human");
  });

  it("uses the user's values when below the ceiling", () => {
    const policy: Policy = { actions: { purchase: { mode: "auto", constraints: { amount: 2000, monthly: 300 } }, change_address: { mode: "human", constraints: {} } } };
    expect(effectivePolicy(shop, policy).purchase!.limits).toEqual({ amount: 2000, monthly: 300 });
  });

  it("clamps user values to the current site ceiling", () => {
    const policy: Policy = { actions: { purchase: { mode: "auto", constraints: { amount: 999999, monthly: 999999 } } } };
    expect(effectivePolicy(shop, policy).purchase!.limits).toEqual({ amount: 5000, monthly: 20000 });
    // The site later lowers its ceiling: the stored value is clamped again.
    const lowered = normalizeManifest({ purchase: { ...shopActions.purchase!, constraints: { ...shopActions.purchase!.constraints, amount: { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 50, ceiling: 200 } } } });
    expect(effectivePolicy(lowered, policy).purchase!.limits.amount).toBe(200);
  });

  it("never yields a negative limit", () => {
    const policy: Policy = { actions: { purchase: { mode: "auto", constraints: { amount: -5, monthly: 10 } } } };
    expect(effectivePolicy(shop, policy).purchase!.limits.amount).toBe(0);
  });

  it("lets the user tighten an auto action to human", () => {
    const policy: Policy = { actions: { purchase: { mode: "human", constraints: { amount: 100, monthly: 500 } } } };
    expect(effectivePolicy(shop, policy).purchase!.mode).toBe("human");
  });

  it("treats actions added after linking as human until reviewed", () => {
    const policy: Policy = { actions: { change_address: { mode: "human", constraints: {} } } };
    const eff = effectivePolicy(shop, policy).purchase!;
    expect(eff.mode).toBe("human");
    expect(eff.humanReason).toMatch(/not reviewed/);
  });

  it("treats constraints added after linking as human until reviewed", () => {
    const policy: Policy = { actions: { purchase: { mode: "auto", constraints: { amount: 100 } } } };
    expect(effectivePolicy(shop, policy).purchase!.mode).toBe("human");
  });

  it("ignores user values for non-configurable actions", () => {
    const locked = normalizeManifest({ purchase: { ...shopActions.purchase!, userConfigurable: false } });
    const policy: Policy = { actions: { purchase: { mode: "auto", constraints: { amount: 5000, monthly: 20000 } } } };
    expect(effectivePolicy(locked, policy).purchase).toEqual({ mode: "auto", limits: { amount: 100, monthly: 500 } });
  });

  it("forces every action to human when paused", () => {
    for (const policy of [null, defaultPolicy(shop)]) {
      const eff = effectivePolicy(shop, policy, true);
      expect(Object.values(eff).every((a) => a.mode === "human")).toBe(true);
      expect(eff.purchase!.humanReason).toMatch(/paused/);
    }
  });

  it("sanitizePolicy clamps, drops unknowns and resets locked actions", () => {
    const locked = normalizeManifest({ ...shopActions, change_address: { label: "Change shipping address", mode: "human", userConfigurable: false } });
    const clean = sanitizePolicy(locked, {
      actions: {
        purchase: { mode: "auto", constraints: { amount: 1e9, monthly: -3, bogus: 1 } },
        change_address: { mode: "auto", constraints: {} },
        made_up: { mode: "auto", constraints: {} },
      },
    });
    expect(clean).toEqual({
      actions: {
        purchase: { mode: "auto", constraints: { amount: 5000, monthly: 0 } },
        change_address: { mode: "human", constraints: {} },
      },
    });
  });
});

describe("evaluateAction", () => {
  const run = (amount: unknown, history: HistoryEntry[] = [], policy: Policy | null = null, paused = false) =>
    evaluateAction({ manifest: shop, policy, paused, action: "purchase", params: { amount }, history, now });

  it("allows an action within every limit", () => {
    expect(run(50)).toEqual({ allowed: true });
    expect(run(100)).toEqual({ allowed: true }); // limit is inclusive
  });

  it("blocks over the per-transaction max with a readable reason", () => {
    expect(run(1500)).toEqual({ allowed: false, reason: "Exceeds per-transaction limit ($100)" });
  });

  it("accumulates sum_per_period within the current month only", () => {
    const history = [1, 5, 9, 10, 11].map((day) => bought(90, at(2026, 10, day, 9))); // $450 so far
    expect(run(50, history)).toEqual({ allowed: true }); // 450 + 50 = 500, limit is inclusive
    expect(run(60, history)).toEqual({
      allowed: false,
      reason: "Would exceed monthly limit ($500): $450 already used this month",
    });
    // Last month's spending does not count.
    expect(run(100, [bought(450, at(2026, 9, 31, 23))])).toEqual({ allowed: true });
  });

  it("respects the user's own limits", () => {
    const policy: Policy = { actions: { purchase: { mode: "auto", constraints: { amount: 2000, monthly: 20000 } } } };
    expect(run(1500, [], policy)).toEqual({ allowed: true });
    expect(run(2500, [], policy)).toEqual({ allowed: false, reason: "Exceeds per-transaction limit ($2,000)" });
  });

  it("blocks human-mode actions always", () => {
    const r = evaluateAction({ manifest: shop, policy: null, action: "change_address", params: {}, history: [], now });
    expect(r).toEqual({ allowed: false, reason: '"Change shipping address" always requires human verification' });
  });

  it("blocks everything when paused", () => {
    expect(run(1, [], null, true)).toEqual({
      allowed: false,
      reason: "Agent access is paused for this site by the account owner",
    });
  });

  it("blocks unknown actions", () => {
    const r = evaluateAction({ manifest: shop, policy: null, action: "wire_money", params: {}, history: [], now });
    expect(r.allowed).toBe(false);
  });

  it.each([undefined, "50", NaN, Infinity, -10, null])("blocks a missing or malformed amount (%s)", (amount) => {
    expect(run(amount).allowed).toBe(false);
  });

  it("enforces count_per_period per day", () => {
    const apply = (history: HistoryEntry[]) =>
      evaluateAction({ manifest: jobs, policy: null, action: "submit_application", params: { job_id: "j1" }, history, now });
    const today = (n: number) => Array.from({ length: n }, (_, i) => ({ params: {}, at: at(2026, 10, 11, 1 + i) }));
    expect(apply(today(4))).toEqual({ allowed: true });
    expect(apply(today(5))).toEqual({
      allowed: false,
      reason: "Daily application limit reached (5 of 5 used today)",
    });
    // Yesterday's applications do not count.
    const yesterday = Array.from({ length: 5 }, () => ({ params: {}, at: at(2026, 10, 10, 23) }));
    expect(apply(yesterday)).toEqual({ allowed: true });
  });

  it("a zero limit blocks even the first action", () => {
    const m = normalizeManifest({ a: { label: "A", mode: "auto", constraints: { c: { type: "count_per_period", period: "day", label: "Daily limit" } } } });
    expect(evaluateAction({ manifest: m, policy: null, action: "a", params: {}, history: [], now }).allowed).toBe(false);
  });
});

describe("periods", () => {
  it("computes local period starts", () => {
    expect(periodStart("day", now)).toEqual(new Date(2026, 10, 11));
    expect(periodStart("month", now)).toEqual(new Date(2026, 10, 1));
  });
  it("reports usage for period constraints", () => {
    const history = [bought(30, at(2026, 10, 2)), bought(20, at(2026, 10, 11, 8)), bought(999, at(2026, 9, 2))];
    expect(periodUsage(shop.actions.purchase!.constraints.monthly!, history, now)).toBe(50);
    expect(periodUsage(shop.actions.purchase!.constraints.amount!, history, now)).toBe(0);
    expect(periodUsage(jobs.actions.submit_application!.constraints.daily!, history, now)).toBe(1);
  });
});

describe("canonicalJson / hashParams", () => {
  it("is independent of key order, at any depth", () => {
    const a = { amount: 1500, item: { id: "p3", tags: ["a", "b"] } };
    const b = { item: { tags: ["a", "b"], id: "p3" }, amount: 1500 };
    expect(canonicalJson(a)).toBe('{"amount":1500,"item":{"id":"p3","tags":["a","b"]}}');
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(hashParams(b)).toBe(hashParams(a));
  });
  it("preserves array order", () => {
    expect(hashParams({ x: [1, 2] })).not.toBe(hashParams({ x: [2, 1] }));
  });
  it("distinguishes different values and types", () => {
    expect(hashParams({ amount: 1500 })).not.toBe(hashParams({ amount: 50 }));
    expect(hashParams({ amount: 1500 })).not.toBe(hashParams({ amount: "1500" }));
    expect(hashParams({})).not.toBe(hashParams({ amount: null }));
  });
  it("drops undefined properties like JSON.stringify", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it("escapes strings safely", () => {
    expect(canonicalJson({ 'k"': 'v"\n' })).toBe('{"k\\"":"v\\"\\n"}');
  });
  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ n: 10n })).toThrow(TypeError);
  });
  it("produces a stable, url-safe hash", () => {
    expect(hashParams({ amount: 1500 })).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashParams({ amount: 1500 })).toBe(hashParams({ amount: 1500 }));
  });
});
