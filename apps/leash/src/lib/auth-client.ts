import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/** Better Auth browser client: passkey sign-in / sign-up and sign-out for the dashboard. */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
