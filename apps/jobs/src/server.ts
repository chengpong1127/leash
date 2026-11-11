import express from "express";
import { getJob, listJobs } from "./db";
import { html } from "./html";
import { layout } from "./views";

const PORT = Number(new URL(process.env.JOBS_URL ?? "http://localhost:3002").port || 3002);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (_req, res) => {
  const jobs = listJobs();
  res.send(
    layout(
      "Jobs",
      html`<h1>Open roles</h1>
        <p class="muted">${jobs.length} jobs hiring now.</p>
        <ul class="list">
          ${jobs.map(
            (j) => html`<li class="card">
              <h2><a href="/jobs/${j.id}">${j.title}</a></h2>
              <p class="meta">${j.company} · ${j.location} · ${j.salary}</p>
            </li>`,
          )}
        </ul>`,
    ),
  );
});

app.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).send(layout("Not found", html`<h1>Job not found</h1><p><a href="/">Back to jobs</a></p>`));
    return;
  }
  res.send(
    layout(
      job.title,
      html`<p><a href="/">← All jobs</a></p>
        <div class="card">
          <h1>${job.title}</h1>
          <p class="meta">${job.company} · ${job.location} · ${job.salary}</p>
          <p>${job.description}</p>
        </div>`,
    ),
  );
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, app: "jobs" });
});

app.listen(PORT, () => console.log(`[jobs] http://localhost:${PORT}`));
