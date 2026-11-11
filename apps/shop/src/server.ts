import express from "express";
import { getProduct, listProducts } from "./db";
import { html } from "./html";
import { layout } from "./views";

const PORT = Number(new URL(process.env.SHOP_URL ?? "http://localhost:3001").port || 3001);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (_req, res) => {
  const products = listProducts();
  res.send(
    layout(
      "Products",
      html`<h1>Products</h1>
        <p class="muted">Everyday things, delivered.</p>
        <ul class="grid">
          ${products.map(
            (p) => html`<li class="card">
              <div class="emoji" aria-hidden="true">${p.emoji}</div>
              <h2><a href="/products/${p.id}">${p.name}</a></h2>
              <p class="price">$${p.price.toLocaleString("en-US")}</p>
            </li>`,
          )}
        </ul>`,
    ),
  );
});

app.get("/products/:id", (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).send(layout("Not found", html`<h1>Product not found</h1><p><a href="/">Back to products</a></p>`));
    return;
  }
  res.send(
    layout(
      product.name,
      html`<p><a href="/">← All products</a></p>
        <div class="card">
          <div class="emoji" aria-hidden="true">${product.emoji}</div>
          <h1>${product.name}</h1>
          <p>${product.description}</p>
          <p class="price">$${product.price.toLocaleString("en-US")}</p>
        </div>`,
    ),
  );
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, app: "shop" });
});

app.listen(PORT, () => console.log(`[shop] http://localhost:${PORT}`));
