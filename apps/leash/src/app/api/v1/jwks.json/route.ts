import { getDb } from "@/db";
import { getJwks } from "@/lib/keys";

export const dynamic = "force-dynamic";

/** Public keys sites use to verify proof JWTs locally. */
export async function GET() {
  return Response.json(await getJwks(getDb()), { headers: { "cache-control": "public, max-age=60" } });
}
