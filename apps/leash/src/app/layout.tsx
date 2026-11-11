import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth-buttons";
import { buttonVariants } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leash — human-in-the-loop authorization for AI agents",
  description: "Let your AI agents act for you, within limits you set. Anything bigger needs your fingerprint.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser(await headers());

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="border-b bg-card">
          <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-3 px-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">L</span>
              <span className="text-lg font-semibold tracking-tight">Leash</span>
            </Link>
            <nav aria-label="Main" className="ml-auto flex items-center gap-1">
              {user ? (
                <>
                  <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>Dashboard</Link>
                  <SignOutButton />
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Not signed in</span>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
        <footer className="border-t">
          <p className="mx-auto max-w-4xl px-6 py-4 text-xs text-muted-foreground">
            Leash — a session says who you are. Only a fresh passkey proves a human is here.
          </p>
        </footer>
      </body>
    </html>
  );
}
