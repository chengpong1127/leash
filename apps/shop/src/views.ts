import { type Raw, html, raw } from "./html";

const css = `
  *{box-sizing:border-box} body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;color:#1c1917;background:#fafaf9}
  a{color:#b45309} header{background:#fff;border-bottom:1px solid #e7e5e4}
  .wrap{max-width:880px;margin:0 auto;padding:0 24px} header .wrap{display:flex;align-items:center;gap:24px;height:60px}
  .brand{font-weight:700;font-size:18px;color:#1c1917;text-decoration:none} nav{display:flex;gap:18px;margin-left:auto;align-items:center}
  nav a{color:#44403c;text-decoration:none} nav a:hover{text-decoration:underline}
  main{padding:32px 0 48px} h1{font-size:28px;margin:0 0 8px} .muted{color:#78716c}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;list-style:none;padding:0;margin:24px 0 0}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:20px}
  .card h2{font-size:18px;margin:8px 0 4px} .emoji{font-size:36px} .price{font-weight:700;font-size:18px}
  .btn{display:inline-block;background:#1c1917;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
  .btn.secondary{background:#fff;color:#1c1917;border:1px solid #d6d3d1}
  footer{border-top:1px solid #e7e5e4;padding:20px 0;color:#78716c;font-size:14px}
`;

export function layout(title: string, body: Raw, user?: { name: string } | null): string {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Corner Shop</title>
  <style>${raw(css)}</style>
</head>
<body>
  <header><div class="wrap">
    <a class="brand" href="/">Corner Shop</a>
    <nav aria-label="Main">
      <a href="/">Products</a>
      ${user ? html`<span class="muted">Signed in as ${user.name}</span>` : html`<span class="muted">Not signed in</span>`}
    </nav>
  </div></header>
  <main><div class="wrap">${body}</div></main>
  <footer><div class="wrap">Demo store — no real payments.</div></footer>
</body>
</html>`.value;
}
