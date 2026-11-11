import { getDb } from "@/db";
import { handleAuthorize } from "@/lib/authorize";
import { respond } from "@/lib/http";

export const POST = (req: Request) => respond(() => handleAuthorize(getDb(), req));
