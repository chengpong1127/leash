/** Better Auth: passkey-only accounts and sessions for the Leash dashboard. */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "../db";
import { leashUrl, rpId } from "./env";
import { newId } from "./ids";
import { placeholderIdentity } from "./webauthn";

function createAuth() {
  return betterAuth({
    appName: "Leash",
    baseURL: process.env.BETTER_AUTH_URL ?? leashUrl(),
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
    // Cookies on localhost are shared across ports, so every app uses its own prefix.
    advanced: { cookiePrefix: "leash" },
    plugins: [
      passkey({
        rpID: rpId(),
        rpName: "Leash",
        origin: leashUrl(),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        advanced: { webAuthnChallengeCookie: "leash_passkey" },
        // Passkey-first sign-up: no account exists until the passkey ceremony has succeeded.
        registration: {
          requireSession: false,
          resolveUser: async () => ({ id: newId("pending"), name: "Leash account" }),
          afterVerification: async () => {
            const id = newId("usr");
            const now = new Date();
            getDb()
              .insert(schema.user)
              .values({ id, ...placeholderIdentity(id), emailVerified: false, createdAt: now, updatedAt: now })
              .run();
            return { userId: id };
          },
        },
      }),
      nextCookies(),
    ],
  });
}

// Created lazily so importing this module (e.g. during `next build`) does not open the database.
const globalForAuth = globalThis as unknown as { __leashAuth?: ReturnType<typeof createAuth> };
export const getAuth = () => (globalForAuth.__leashAuth ??= createAuth());

/** The signed-in Leash user, or null. A session identifies the user; it never proves a human is present. */
export async function getSessionUser(headers: Headers): Promise<{ id: string } | null> {
  const session = await getAuth().api.getSession({ headers });
  return session ? { id: session.user.id } : null;
}
