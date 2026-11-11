import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Better Auth: passkey sign-up / sign-in and sessions for the dashboard. Created lazily on first request.
export const { GET, POST } = toNextJsHandler((req: Request) => getAuth().handler(req));
