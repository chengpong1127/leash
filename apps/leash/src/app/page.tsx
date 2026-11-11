import { getDb, schema } from "@/db";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const sites = getDb().select().from(schema.sites).all();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Your agents, on a leash.</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Websites assume any logged-in activity might be an AI agent. Small actions pass silently; anything beyond
          the limits you set needs a fresh passkey tap from you.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Connected sites</h2>
        {sites.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-slate-600">
            No sites yet. Run <code className="rounded bg-slate-100 px-1.5 py-0.5">pnpm db:seed</code>.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {sites.map((site) => (
              <li key={site.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="font-medium">{site.name}</p>
                <p className="text-sm text-slate-500">{site.origin}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {Object.keys(site.manifest.actions).length} protected action(s) declared
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
