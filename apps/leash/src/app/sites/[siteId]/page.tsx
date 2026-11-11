import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthButtons } from "@/components/auth-buttons";
import { SettingsForm } from "@/components/settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent permissions — Leash" };

export default async function SiteSettingsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const user = await getSessionUser(await headers());

  if (!user) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl tracking-tight">Sign in to manage agent permissions</CardTitle>
          <CardDescription>Use your Leash passkey to see and change what an AI agent may do on this site.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthButtons showCreate={false} />
        </CardContent>
      </Card>
    );
  }

  const settings = getSiteSettings(getDb(), user.id, siteId);
  if (!settings) notFound();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">← Dashboard</Link>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{settings.siteName} — agent permissions</h1>
        <p className="mt-1 text-muted-foreground">
          What an AI agent may do in your {settings.siteName} account ({settings.siteOrigin}) without asking you.
        </p>
      </div>
      <SettingsForm settings={settings} />
    </div>
  );
}
