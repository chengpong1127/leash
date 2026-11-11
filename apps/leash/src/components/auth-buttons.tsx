"use client";

import { Fingerprint, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { describeError } from "@/lib/client";

type Result = { error: { message?: string } | null };

/** Sign in to the dashboard with an existing Leash passkey. Returns true on success. */
export async function signInWithPasskey(): Promise<string | null> {
  try {
    const res = (await authClient.signIn.passkey({ autoFill: false })) as Result;
    return res.error ? (res.error.message ?? "Sign-in failed. Do you have a Leash passkey on this device?") : null;
  } catch (e) {
    return describeError(e);
  }
}

async function createAccount(): Promise<string | null> {
  try {
    const res = (await authClient.passkey.addPasskey({ name: "Leash passkey", context: "signup", createSession: true })) as Result;
    return res.error ? (res.error.message ?? "Could not create the passkey.") : null;
  } catch (e) {
    return describeError(e);
  }
}

/** The two passkey-only entry points. `after` runs once a session exists (defaults to refreshing the page). */
export function AuthButtons({ showCreate = true, after, size = "lg" }: { showCreate?: boolean; after?: () => void; size?: ButtonProps["size"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"in" | "up" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "in" | "up") {
    setBusy(kind);
    setError(null);
    const failure = kind === "in" ? await signInWithPasskey() : await createAccount();
    setBusy(null);
    if (failure) return setError(failure);
    if (after) after();
    else router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button size={size} onClick={() => run("in")} disabled={busy !== null}>
          <Fingerprint aria-hidden="true" />
          {busy === "in" ? "Waiting for passkey…" : "Sign in with passkey"}
        </Button>
        {showCreate && (
          <Button size={size} variant="outline" onClick={() => run("up")} disabled={busy !== null}>
            {busy === "up" ? "Creating passkey…" : "Create account with passkey"}
          </Button>
        )}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut().catch(() => null);
        router.push("/");
        router.refresh();
        setBusy(false);
      }}
    >
      <LogOut aria-hidden="true" />
      Sign out
    </Button>
  );
}
