import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leash — human-in-the-loop authorization for AI agents",
  description: "Let your AI agents act for you, within limits you set. Anything bigger needs your fingerprint.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center gap-2 px-6 py-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">L</span>
            <span className="text-lg font-semibold tracking-tight">Leash</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
