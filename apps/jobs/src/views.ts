import { type Raw, html, raw } from "./html";

const css = `
  *{box-sizing:border-box} body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;color:#0f172a;background:#f8fafc}
  a{color:#1d4ed8} header{background:#fff;border-bottom:1px solid #e2e8f0}
  .wrap{max-width:880px;margin:0 auto;padding:0 24px} header .wrap{display:flex;align-items:center;gap:24px;min-height:60px;flex-wrap:wrap}
  .brand{font-weight:700;font-size:18px;color:#0f172a;text-decoration:none} nav{display:flex;gap:18px;margin-left:auto;align-items:center;flex-wrap:wrap}
  nav a{color:#334155;text-decoration:none} nav a:hover{text-decoration:underline} nav form{margin:0}
  main{padding:32px 0 48px} h1{font-size:28px;margin:0 0 8px} h2{font-size:20px} .muted{color:#64748b}
  .list{list-style:none;padding:0;margin:24px 0 0;display:grid;gap:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin:16px 0}
  .list .card{margin:0} .card h2{font-size:18px;margin:0 0 2px} .meta{color:#475569;font-size:15px;margin:0}
  .btn{display:inline-block;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
  .btn.secondary{background:#fff;color:#0f172a;border:1px solid #cbd5e1} .linkbtn{background:none;border:0;padding:0;font:inherit;color:#334155;cursor:pointer}
  label{display:block;font-weight:600;margin:14px 0 4px} input[type=email],input[type=password],input[type=text]{width:100%;max-width:420px;padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
  .notice{border-radius:12px;padding:16px 20px;margin:16px 0;border:1px solid}
  .notice.warn{background:#fffbeb;border-color:#fcd34d} .notice.ok{background:#f0fdf4;border-color:#86efac} .notice.err{background:#fef2f2;border-color:#fca5a5}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #e2e8f0} tr:last-child td{border-bottom:0}
  .tag{display:inline-block;font-size:13px;border-radius:999px;padding:2px 10px;background:#f1f5f9;color:#334155} .tag.verified{background:#dcfce7;color:#166534}
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
      ${user
        ? html`<a href="/applications">My applications</a>
            <a href="/account/leash">Agent permissions (Leash)</a>
            <span class="muted">Signed in as ${user.name}</span>
            <form method="post" action="/logout"><button class="linkbtn" type="submit">Log out</button></form>`
        : html`<a href="/login">Log in</a>`}
    </nav>
  </div></header>
  <main><div class="wrap">${body}</div></main>
  <footer><div class="wrap">Demo job board — no real applications are sent.</div></footer>
</body>
</html>`.value;
}
