import { describe, expect, it } from "vitest";
import { createLeash } from "./index";

const base = { siteId: "site_shop", secret: "s", leashUrl: "http://localhost:3000", getUserId: () => "1" };

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
    expect(() => createLeash({ ...base, secret: "", actions: {} })).toThrow(/secret/);
  });
});
