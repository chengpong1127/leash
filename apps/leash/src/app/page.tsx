import { Bot, Fingerprint, SlidersHorizontal } from "lucide-react";
import { headers } from "next/headers";
import { AuthButtons } from "@/components/auth-buttons";
import { Dashboard } from "@/components/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { getDashboard } from "@/lib/views";

export const dynamic = "force-dynamic";

const POINTS = [
  { icon: Bot, title: "Agents welcome", text: "Sites stop guessing who is a bot. Any logged-in activity is treated as possibly your agent." },
  { icon: SlidersHorizontal, title: "Your limits", text: "Small, routine actions pass silently, up to the spending and frequency limits you choose." },
  { icon: Fingerprint, title: "Your fingerprint", text: "Anything bigger needs a fresh passkey tap bound to that one action. An agent cannot press Touch ID." },
];

export default async function HomePage() {
  const user = await getSessionUser(await headers());

  if (user) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">What happened in your accounts, and what is waiting for you.</p>
        </div>
        <Dashboard initial={getDashboard(getDb(), user.id)} />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section className="max-w-2xl space-y-5 pt-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Your agents, on a leash.</h1>
        <p className="text-lg text-muted-foreground">
          Leash lets your AI agents act for you on websites, within limits you set. Anything beyond those limits needs
          a fresh passkey tap from you — proof that a human is really there.
        </p>
        <AuthButtons />
        <p className="text-sm text-muted-foreground">Passkey only. No password, no email.</p>
      </section>

      <section aria-label="How it works">
        <ul className="grid gap-4 sm:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Card className="h-full">
                <CardHeader>
                  <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
