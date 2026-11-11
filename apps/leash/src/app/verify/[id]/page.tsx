import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { VerifyPanel } from "@/components/verify-panel";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { getVerifyView } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approve with Leash" };

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The session is only a hint for the UI. Approval always needs a fresh passkey assertion.
  const user = await getSessionUser(await headers());
  const view = getVerifyView(getDb(), id, user?.id ?? null);
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <VerifyPanel view={view} />
    </div>
  );
}
