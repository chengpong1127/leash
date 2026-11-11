import { createLeash } from "@leash/node";

/** The whole Leash integration: declare the sensitive actions and what users may configure. */
export const leash = createLeash({
  siteId: process.env.SHOP_LEASH_SITE_ID!,
  secret: process.env.SHOP_LEASH_SITE_SECRET!,
  leashUrl: process.env.LEASH_URL!,
  getUserId: (req) => req.user?.id,
  blockedPath: "/verification-required",
  actions: {
    purchase: {
      label: "Purchase items",
      mode: "auto",
      constraints: {
        amount: { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 100, ceiling: 5000 },
        monthly: { type: "sum_per_period", param: "amount", period: "month", label: "Monthly limit ($)", default: 500, ceiling: 20000 },
      },
    },
    change_address: { label: "Change shipping address", mode: "human" },
  },
});
