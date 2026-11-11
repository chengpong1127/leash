import { getDb } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { HttpError, json, respond } from "@/lib/http";
import { getDashboard } from "@/lib/views";

/** Pending approvals, recent activity and per-site usage for the signed-in user. Polled every second. */
export const GET = (req: Request) =>
  respond(async () => {
    const user = await getSessionUser(req.headers);
    if (!user) throw new HttpError(401, "unauthorized", "Sign in to Leash first");
    return json(getDashboard(getDb(), user.id));
  });
