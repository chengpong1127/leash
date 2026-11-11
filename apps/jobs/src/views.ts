import { type Raw, html, raw } from "./html";

const css = `
  *{box-sizing:border-box} body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;color:#0f172a;background:#f8fafc}
  a{color:#1d4ed8} header{background:#fff;border-bottom:1px solid #e2e8f0}
  .wrap{max-width:880px;margin:0 auto;padding:0 24px} header .wrap{display:flex;align-items:center;gap:24px;height:60px}
  .brand{font-weight:700;font-size:18px;color:#0f172a;text-decoration:none} nav{display:flex;gap:18px;margin-left:auto;align-items:center}
  nav a{color:#334155;text-decoration:none} nav a:hover{text-decoration:underline}
  main{padding:32px 0 48px} h1{font-size:28px;margin:0 0 8px} .muted{color:#64748b}
  .list{list-style:none;padding:0;margin:24px 0 0;display:grid;gap:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px}
  .card h2{font-size:18px;margin:0 0 2px} .meta{color:#475569;font-size:15px;margin:0}
  .btn{display:inline-block;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
  .btn.secondary{background:#fff;color:#0f172a;border:1px solid #cbd5e1}
  footer{border-top:1px solid #e2e8f0;padding:20px 0;color:#64748b;font-size:14px}
`;

export function layout(title: string, body: Raw, user?: { name: string } | null): string {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Hireboard</title>
  <style>${raw(css)}</style>
</head>
<body>
  <header><div class="wrap">
    <a class="brand" href="/">Hireboard</a>
    <nav aria-label="Main">
      <a href="/">Jobs</a>
      ${user ? html`<span class="muted">Signed in as ${user.name}</span>` : html`<span class="muted">Not signed in</span>`}
    </nav>
  </div></header>
  <main><div class="wrap">${body}</div></main>
  <footer><div class="wrap">Demo job board — no real applications are sent.</div></footer>
</body>
</html>`.value;
}
