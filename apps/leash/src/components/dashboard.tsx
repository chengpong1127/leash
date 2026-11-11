"use client";

import { Fingerprint, PauseCircle, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { OUTCOME, formatRemaining, formatTime } from "@/components/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ApiError, api, approveChallenge, denyChallenge, describeError, setPaused } from "@/lib/client";
import type { DashboardData, PendingItem, SiteItem } from "@/lib/view-types";

/** The signed-in home: pending approvals, per-site usage, live activity. Polls once a second. */
export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [signedOut, setSignedOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await api<DashboardData>("/api/dashboard"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (signedOut) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh, signedOut]);

  if (signedOut) {
    return (
      <Alert variant="warning">
        <AlertTitle>You have been signed out.</AlertTitle>
        <AlertDescription>
          <a className="underline" href="/">Reload the page</a> to sign in again.
        </AlertDescription>
      </Alert>
    );
  }

  const pending = data.pending.filter((p) => p.expiresAt > now);

  return (
    <div className="space-y-10">
      <section aria-labelledby="pending-heading" className="space-y-3">
        <h2 id="pending-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Waiting for you {pending.length > 0 && <span className="text-foreground">({pending.length})</span>}
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-5 py-4 text-sm text-muted-foreground">
            Nothing needs your approval right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((p) => (
              <li key={p.id}>
                <PendingCard item={p} now={now} onDone={refresh} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sites-heading" className="space-y-3">
        <h2 id="sites-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Connected sites</h2>
        {data.sites.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-5 py-4 text-sm text-muted-foreground">
            No sites connected yet. A site is connected the first time you approve one of its requests, or from the
            site&apos;s own &quot;Agent permissions (Leash)&quot; link.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.sites.map((s) => (
              <li key={s.linkId}>
                <SiteCard site={s} onChanged={refresh} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="activity-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 id="activity-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Activity</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden="true" /> Live
          </span>
        </div>
        {data.events.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-5 py-4 text-sm text-muted-foreground">
            No activity yet. Actions on your connected sites appear here as they happen.
          </p>
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {data.events.map((e) => (
                <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[5.5rem_1fr_auto] sm:items-center">
                  <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(e.createdAt).toISOString()}>
                    {formatTime(e.createdAt)}
                  </time>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.summary || e.actionLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.siteName} · {e.actionLabel}
                      {e.outcome === "blocked" && e.reason ? ` · Reason: ${e.reason}` : ""}
                    </p>
                  </div>
                  <Badge variant={OUTCOME[e.outcome].variant}>{OUTCOME[e.outcome].label}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function PendingCard({ item, now, onDone }: { item: PendingItem; now: number; onDone: () => void }) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "approve" | "deny") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "approve") await approveChallenge(item.id, "assert");
      else await denyChallenge(item.id);
      onDone();
    } catch (e) {
      setError(describeError(e));
    }
    setBusy(null);
  }

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription>
            {item.siteName} · {item.actionLabel}
          </CardDescription>
          <Badge variant="warning">Needs approval · expires in {formatRemaining(item.expiresAt, now)}</Badge>
        </div>
        <CardTitle className="text-lg">{item.summary || item.actionLabel}</CardTitle>
        <p className="text-sm text-muted-foreground">Reason: {item.reason}</p>
      </CardHeader>
      <CardFooter>
        <Button onClick={() => act("approve")} disabled={busy !== null}>
          <Fingerprint aria-hidden="true" />
          {busy === "approve" ? "Waiting for passkey…" : "Approve with passkey"}
        </Button>
        <Button variant="outline" onClick={() => act("deny")} disabled={busy !== null}>
          {busy === "deny" ? "Denying…" : "Deny"}
        </Button>
      </CardFooter>
      {error && (
        <CardContent>
          <Alert variant="destructive">{error}</Alert>
        </CardContent>
      )}
    </Card>
  );
}

function SiteCard({ site, onChanged }: { site: SiteItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchId = `pause-${site.linkId}`;

  async function toggle(paused: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setPaused(site.linkId, paused);
      onChanged();
    } catch (e) {
      setError(describeError(e));
    }
    setBusy(false);
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{site.name}</CardTitle>
          {site.paused ? (
            <Badge variant="warning">
              <PauseCircle aria-hidden="true" /> Paused
            </Badge>
          ) : (
            <Badge variant="success">
              <ShieldCheck aria-hidden="true" /> Active
            </Badge>
          )}
        </div>
        <CardDescription>{site.origin}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {site.paused && <p className="text-sm text-muted-foreground">Agent access is paused: every protected action asks you first.</p>}
        {site.usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage limits apply to this site.</p>
        ) : (
          site.usage.map((u) => (
            <div key={`${u.action}.${u.constraint}`} className="space-y-1.5">
              <p className="text-sm">
                <span className="font-medium">{site.name} — {u.text}</span>
                <span className="block text-xs text-muted-foreground">{u.actionLabel} · {u.label}</span>
              </p>
              <Progress value={u.used} max={u.limit} tone={u.used >= u.limit ? "full" : "default"} />
            </div>
          ))
        )}
      </CardContent>
      <CardFooter className="justify-between border-t pt-4">
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={site.paused} disabled={busy} onCheckedChange={toggle} aria-label={`Pause agent access for ${site.name}`} />
          <label htmlFor={switchId} className="text-sm">Pause agent access</label>
        </div>
        <Link href={`/sites/${encodeURIComponent(site.siteId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Settings aria-hidden="true" /> Settings
        </Link>
      </CardFooter>
      {(error || (busy && site.paused)) && (
        <CardContent>
          {error ? <Alert variant="destructive">{error}</Alert> : <p className="text-sm text-muted-foreground">Resuming needs your passkey…</p>}
        </CardContent>
      )}
    </Card>
  );
}
