import { getDb } from "@/db";
import { handleManifest } from "@/lib/authorize";
import { respond } from "@/lib/http";

export const PUT = (req: Request) => respond(() => handleManifest(getDb(), req));
