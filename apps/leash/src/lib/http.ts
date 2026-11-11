import type { z } from "zod";
import { leashOrigin } from "./env";

/** An error with an HTTP status and a machine-readable code; rendered by `respond`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Run a handler, turning HttpError (and anything unexpected) into a JSON error response. */
export async function respond(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    console.error("[leash] unexpected error", e);
    return json({ error: "internal_error", message: "Unexpected error" }, 500);
  }
}

/** Parse and validate a JSON request body with a zod schema. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(400, "invalid_request", detail);
  }
  return result.data;
}

/** Browser-facing POSTs must come from Leash's own pages (basic CSRF protection). */
export function requireSameOrigin(req: Request): void {
  if (req.headers.get("origin") !== leashOrigin()) {
    throw new HttpError(403, "bad_origin", "This request must come from the Leash site");
  }
}
