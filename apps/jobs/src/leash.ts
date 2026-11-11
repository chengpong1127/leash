import { createLeash } from "@leash/node";

/** The whole Leash integration: declare the sensitive actions and what users may configure. */
export const leash = createLeash({
  siteId: process.env.JOBS_LEASH_SITE_ID!,
  secret: process.env.JOBS_LEASH_SITE_SECRET!,
  leashUrl: process.env.LEASH_URL!,
  getUserId: (req) => req.user?.id,
  blockedPath: "/verification-required",
  actions: {
    submit_application: {
      label: "Submit job application",
      mode: "auto",
      constraints: {
        daily: { type: "count_per_period", period: "day", label: "Daily application limit", default: 5, ceiling: 20 },
      },
    },
  },
});
