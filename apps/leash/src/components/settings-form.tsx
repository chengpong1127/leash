"use client";

import type { Mode, Policy } from "@leash/shared";
import { Fingerprint, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { describeError, savePolicy, setPaused } from "@/lib/client";
import type { SiteSettings } from "@/lib/view-types";

type Draft = Record<string, { mode: Mode; constraints: Record<string, string> }>;

/** "Monthly limit ($)" → { name: "Monthly limit", unit: "$" } (same convention as the server). */
function splitLabel(label: string) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label);
  return m ? { name: m[1]!, unit: m[2]! } : { name: label, unit: null as string | null };
}
function show(value: number, unit: string | null) {
  const n = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return !unit ? n : unit === "$" ? `$${n}` : `${n} ${unit}`;
}

/** Start from the stored policy; anything not reviewed yet starts from the site's defaults. */
function initialDraft(s: SiteSettings): Draft {
  const draft: Draft = {};
  for (const [name, action] of Object.entries(s.manifest.actions)) {
    const stored = action.userConfigurable ? s.policy.actions?.[name] : undefined;
    const constraints: Record<string, string> = {};
    for (const [key, c] of Object.entries(action.constraints)) {
      const value = stored?.constraints?.[key];
      constraints[key] = String(Math.min(typeof value === "number" ? value : c.default, c.ceiling));
    }
    draft[name] = { mode: stored?.mode ?? action.mode, constraints };
  }
  return draft;
}

export function SettingsForm({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => initialDraft(settings));
  const [paused, setPausedState] = useState(settings.paused);
  const [busy, setBusy] = useState<"save" | "pause" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "destructive"; text: string } | null>(null);
  const [pauseMessage, setPauseMessage] = useState<{ kind: "success" | "destructive"; text: string } | null>(null);
  const actions = Object.entries(settings.manifest.actions);

  const setMode = (name: string, mode: Mode) => setDraft((d) => ({ ...d, [name]: { ...d[name]!, mode } }));
  const setValue = (name: string, key: string, value: string) =>
    setDraft((d) => ({ ...d, [name]: { ...d[name]!, constraints: { ...d[name]!.constraints, [key]: value } } }));

  /** Returns the policy to save, or an error message naming the first invalid field. */
  function build(): Policy | string {
    const policy: Policy = { actions: {} };
    for (const [name, action] of actions) {
      const constraints: Record<string, number> = {};
      for (const [key, c] of Object.entries(action.constraints)) {
        const { name: label, unit } = splitLabel(c.label);
        const value = Number(draft[name]!.constraints[key]);
        if (draft[name]!.constraints[key]!.trim() === "" || !Number.isFinite(value) || value < 0) {
          return `${action.label} — ${label}: enter a number of 0 or more.`;
        }
        if (value > c.ceiling) return `${action.label} — ${label}: the most ${settings.siteName} allows is ${show(c.ceiling, unit)}.`;
        constraints[key] = value;
      }
      policy.actions[name] = { mode: draft[name]!.mode, constraints };
    }
    return policy;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const policy = build();
    if (typeof policy === "string") return setMessage({ kind: "destructive", text: policy });
    setBusy("save");
    setMessage(null);
    try {
      await savePolicy(settings.linkId, policy);
      setMessage({ kind: "success", text: "Saved. Your new agent permissions are in effect." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "destructive", text: describeError(err) });
    }
    setBusy(null);
  }

  async function togglePause(next: boolean) {
    setBusy("pause");
    setPauseMessage(null);
    try {
      const res = await setPaused(settings.linkId, next);
      setPausedState(res.paused);
      setPauseMessage({ kind: "success", text: res.paused ? "Agent access is paused. Every protected action now asks you first." : "Agent access resumed." });
      router.refresh();
    } catch (err) {
      setPauseMessage({ kind: "destructive", text: describeError(err) });
    }
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle id="pause-title">Pause agent access</CardTitle>
              <CardDescription>
                While paused, every protected action on {settings.siteName} needs your passkey. Pausing is instant;
                resuming needs your passkey.
              </CardDescription>
            </div>
            <Switch checked={paused} disabled={busy !== null} onCheckedChange={togglePause} aria-labelledby="pause-title" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            Status: <Badge variant={paused ? "warning" : "success"}>{paused ? "Paused" : "Active"}</Badge>
          </p>
          {busy === "pause" && paused && <p className="text-sm text-muted-foreground">Waiting for passkey…</p>}
          {pauseMessage && <Alert variant={pauseMessage.kind}>{pauseMessage.text}</Alert>}
        </CardContent>
      </Card>

      <form onSubmit={save} className="space-y-6" noValidate>
        {settings.needsReview.length > 0 && (
          <Alert variant="warning">
            <AlertTitle>New since you last saved</AlertTitle>
            <AlertDescription>
              {settings.siteName} added or changed some actions. Until you review and save, they always ask you first.
            </AlertDescription>
          </Alert>
        )}

        {actions.length === 0 && <p className="text-sm text-muted-foreground">{settings.siteName} has not declared any protected actions.</p>}

        {actions.map(([name, action]) => {
          const locked = !action.userConfigurable;
          const mode = locked ? action.mode : draft[name]!.mode;
          const constraints = Object.entries(action.constraints);
          return (
            <Card key={name}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{action.label}</CardTitle>
                  {settings.needsReview.includes(name) && <Badge variant="warning">Needs review</Badge>}
                  {locked && (
                    <Badge variant="outline">
                      <Lock aria-hidden="true" /> Set by {settings.siteName}
                    </Badge>
                  )}
                </div>
                {locked && <CardDescription>{settings.siteName} does not allow changing this setting.</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-5">
                <fieldset disabled={locked} className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">When an agent does this</legend>
                  {(
                    [
                      ["auto", "Allow automatically within limits", "No prompt as long as every limit below is respected."],
                      ["human", "Always ask me", "Every time needs your passkey."],
                    ] as const
                  ).map(([value, title, hint]) => (
                    <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-70">
                      <input type="radio" name={`mode-${name}`} value={value} checked={mode === value} onChange={() => setMode(name, value)} className="mt-1 accent-(--primary)" />
                      <span className="text-sm">
                        <span className="font-medium">{title}</span>
                        <span className="block text-muted-foreground">{hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {constraints.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {constraints.map(([key, c]) => {
                      const id = `limit-${name}-${key}`;
                      const { name: label, unit } = splitLabel(c.label);
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label htmlFor={id}>{c.label}</Label>
                          <Input
                            id={id}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={c.ceiling}
                            step="any"
                            required
                            disabled={locked || mode === "human"}
                            value={locked ? String(c.default) : draft[name]!.constraints[key]}
                            onChange={(e) => setValue(name, key, e.target.value)}
                            aria-describedby={`${id}-help`}
                          />
                          <p id={`${id}-help`} className="text-xs text-muted-foreground">
                            Maximum allowed by {settings.siteName}: {show(c.ceiling, unit)}
                            {mode === "human" && !locked ? ` · ${label} is not used while this action always asks you.` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardFooter className="justify-between">
            <p className="max-w-md text-sm text-muted-foreground">
              Saving needs your passkey, so an agent using this browser cannot raise its own limits.
            </p>
            <Button type="submit" size="lg" disabled={busy !== null || actions.length === 0}>
              <Fingerprint aria-hidden="true" />
              {busy === "save" ? "Waiting for passkey…" : "Save with passkey"}
            </Button>
          </CardFooter>
          {message && (
            <CardContent>
              <Alert variant={message.kind}>{message.text}</Alert>
            </CardContent>
          )}
        </Card>
      </form>
    </div>
  );
}
