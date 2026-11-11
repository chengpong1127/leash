"use client";

import { Check, Fingerprint, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signInWithPasskey } from "@/components/auth-buttons";
import { formatRemaining } from "@/components/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { approveChallenge, challengeStatus, denyChallenge, describeError } from "@/lib/client";
import type { VerifyView } from "@/lib/view-types";

type Busy = "register" | "assert" | "deny" | "manage" | null;

export function VerifyPanel({ view }: { view: VerifyView }) {
  const router = useRouter();
  const [status, setStatus] = useState(view.status);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const alreadyConnected = view.isLink && view.linked;
  const settingsUrl = `/sites/${encodeURIComponent(view.siteId)}`;

  function go(url: string) {
    setLeaving(true);
    window.location.assign(url);
  }

  // Poll: when this request is approved or denied anywhere (this page, or the dashboard on
  // another device), the server hands back where to go and the page moves on by itself.
  useEffect(() => {
    if (leaving || alreadyConnected || status !== "pending") return;
    const timer = setInterval(async () => {
      setNow(Date.now());
      try {
        const res = await challengeStatus(view.id);
        if (res.redirect_url) go(res.redirect_url);
        else setStatus(res.status);
      } catch {
        /* transient; try again next second */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [view.id, status, leaving, alreadyConnected]);

  async function act(kind: "register" | "assert" | "deny") {
    setBusy(kind);
    setError(null);
    try {
      const res = kind === "deny" ? await denyChallenge(view.id) : await approveChallenge(view.id, kind);
      if (res.redirect_url) return go(res.redirect_url);
      setStatus(res.status);
    } catch (e) {
      setError(describeError(e));
    }
    setBusy(null);
  }

  async function manage() {
    setBusy("manage");
    setError(null);
    if (!view.hasSession) {
      const failure = await signInWithPasskey();
      if (failure) {
        setError(failure);
        return setBusy(null);
      }
    }
    router.push(settingsUrl);
  }

  const backLink = (
    <a href={view.returnUrl} className={buttonVariants({ variant: "outline" })}>
      Back to {view.siteName}
    </a>
  );

  const heading = (
    <CardHeader>
      <CardDescription className="flex items-center gap-2">
        <ShieldCheck className="size-4" aria-hidden="true" />
        {view.siteName} <span aria-hidden="true">·</span> {view.siteOrigin}
      </CardDescription>
      <CardTitle className="text-2xl tracking-tight">
        {view.isLink ? `Connect your ${view.siteName} account to Leash` : `${view.siteName} is asking for your approval`}
      </CardTitle>
    </CardHeader>
  );

  if (leaving) {
    return (
      <Card>
        {heading}
        <CardContent>
          <Alert variant="success">
            <AlertTitle>Done. Returning you to {view.siteName}…</AlertTitle>
            <AlertDescription>
              If nothing happens, <a className="underline" href={view.returnUrl}>go back to {view.siteName}</a>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (alreadyConnected) {
    return (
      <Card>
        {heading}
        <CardContent className="space-y-3">
          <Alert variant="success">
            <AlertTitle>This account is already connected to Leash.</AlertTitle>
            <AlertDescription>You can review and change what an AI agent may do on {view.siteName} without asking you.</AlertDescription>
          </Alert>
          {error && <Alert variant="destructive">{error}</Alert>}
        </CardContent>
        <CardFooter>
          <Button onClick={manage} disabled={busy !== null}>
            <Fingerprint aria-hidden="true" />
            {busy === "manage" ? "Waiting for passkey…" : "Manage permissions"}
          </Button>
          {backLink}
        </CardFooter>
      </Card>
    );
  }

  if (status !== "pending") {
    const message: Record<string, [string, string]> = {
      expired: ["This request has expired.", `Nothing was approved. Go back to ${view.siteName} and try again to get a new request.`],
      approved: ["Already approved.", `This request has been approved. Return to ${view.siteName} to continue.`],
      consumed: ["Already approved.", "This request was approved and has been used. There is nothing more to do here."],
      denied: ["Declined.", "This request was declined. Nothing was done."],
    };
    const [title, body] = message[status] ?? ["This request is no longer active.", ""];
    return (
      <Card>
        {heading}
        <CardContent>
          <Alert variant={status === "denied" || status === "expired" ? "warning" : "success"}>
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{body}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>{backLink}</CardFooter>
      </Card>
    );
  }

  const firstTime = !view.linked;
  // With a Leash session on this device the person most likely has a passkey already.
  const preferExisting = view.linked || view.hasSession;
  const verb = view.isLink ? "Connect" : "Approve";
  const disabled = busy !== null;

  return (
    <Card>
      {heading}

      <CardContent className="space-y-4">
        {!view.isLink && (
          <dl className="grid gap-3 rounded-lg border bg-background p-4 text-sm">
            <div>
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Action</dt>
              <dd className="font-medium">{view.actionLabel}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Details</dt>
              <dd className="text-base font-semibold">{view.summary || view.actionLabel}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-muted-foreground uppercase">Why you are being asked</dt>
              <dd>{view.reason}</dd>
            </div>
          </dl>
        )}

        {firstTime && (
          <section aria-labelledby="about-leash" className="space-y-3">
            <h2 id="about-leash" className="font-semibold">What is Leash?</h2>
            <p className="text-sm text-muted-foreground">
              {view.siteName} uses Leash so that AI agents acting in your account stay within limits you set. Small,
              routine actions go through silently. Anything beyond the limits needs you, in person, with a passkey
              (Touch ID or Face ID) — something an agent cannot do.
            </p>
            <div>
              <p className="text-sm font-medium">Agent permissions for {view.siteName} to start with:</p>
              <ul className="mt-2 space-y-2">
                {view.defaults.map((d) => (
                  <li key={d.action} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    <span>
                      <span className="font-medium">{d.label}</span>{" "}
                      <Badge variant={d.mode === "auto" ? "secondary" : "outline"}>{d.mode === "auto" ? "Automatic within limits" : "Always asks you"}</Badge>
                      <span className="block text-muted-foreground">{d.text}</span>
                    </span>
                  </li>
                ))}
                {view.defaults.length === 0 && <li className="text-sm text-muted-foreground">This site has not declared any agent permissions yet.</li>}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">You can change these any time in your Leash dashboard.</p>
            </div>
            <Separator />
            <p className="text-sm">
              {preferExisting
                ? `${verb === "Approve" ? "Approving" : "Connecting"} with your Leash passkey connects this ${view.siteName} account to your Leash account.`
                : `"${verb} with passkey" creates a passkey and a Leash account for you, connects this ${view.siteName} account${view.isLink ? "" : ", and approves this request"} — one Touch ID.`}
            </p>
          </section>
        )}

        {error && <Alert variant="destructive">{error}</Alert>}
      </CardContent>

      <CardFooter>
        <Button size="lg" onClick={() => act(preferExisting ? "assert" : "register")} disabled={disabled}>
          <Fingerprint aria-hidden="true" />
          {busy === "register" || (busy === "assert" && preferExisting) ? "Waiting for passkey…" : `${verb} with passkey`}
        </Button>
        {!view.isLink && (
          <Button size="lg" variant="outline" onClick={() => act("deny")} disabled={disabled}>
            {busy === "deny" ? "Denying…" : "Deny"}
          </Button>
        )}
        {view.isLink && backLink}
      </CardFooter>

      {firstTime && (
        <CardContent className="-mt-1">
          <Button variant="link" className="h-auto p-0" onClick={() => act(preferExisting ? "register" : "assert")} disabled={disabled}>
            {preferExisting ? "Create a new Leash account with a new passkey instead" : "I already have a Leash passkey"}
          </Button>
        </CardContent>
      )}

      <CardContent className="border-t pt-4">
        <p className="text-sm text-muted-foreground" role="status">
          Waiting for approval… You can also approve from your Leash dashboard on another device. This request expires
          in {formatRemaining(view.expiresAt, now)}.
        </p>
      </CardContent>
    </Card>
  );
}
