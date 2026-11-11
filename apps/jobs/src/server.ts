import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { loadUser, login, logout, requireLogin, safeNext } from "./auth";
import { type Job, db, getJob, listJobs } from "./db";
import { type Raw, html } from "./html";
import { leash } from "./leash";
import { layout } from "./views";

const PORT = Number(new URL(process.env.JOBS_URL ?? "http://localhost:3002").port || 3002);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      job?: Job;
    }
  }
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(loadUser);

const send = (req: Request, res: Response, title: string, body: Raw) => res.send(layout(title, body, req.user));
const one = (v: unknown) => (typeof v === "string" ? v : "");
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const hasApplied = (userId: string, jobId: string) =>
  Boolean(db.prepare("SELECT 1 FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId));

// ── Login (the job board's own; independent of Leash) ────────────────────────

const loginPage = (next: string, error?: string) => html`<h1>Log in</h1>
  ${error ? html`<p class="notice err" role="alert">${error}</p>` : ""}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${next}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <p><button class="btn" type="submit">Log in</button></p>
  </form>
  <p class="muted">Demo account: demo@example.com / demo1234</p>`;

app.get("/login", (req, res) => send(req, res, "Log in", loginPage(safeNext(req.query.next))));
app.post("/login", (req, res) => {
  const next = safeNext(req.body.next);
  if (login(res, one(req.body.email), one(req.body.password))) return res.redirect(303, next);
  res.status(401);
  send(req, res, "Log in", loginPage(next, "Wrong email or password."));
});
app.post("/logout", (req, res) => {
  logout(req, res);
  res.redirect(303, "/");
});

// ── Jobs ─────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  const jobs = listJobs();
  send(
    req,
    res,
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
  );
});

app.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return notFound(req, res);
  const applied = req.user ? hasApplied(req.user.id, job.id) : false;
  send(
    req,
    res,
    job.title,
    html`<p><a href="/">← All jobs</a></p>
      <div class="card">
        <h1>${job.title}</h1>
        <p class="meta">${job.company} · ${job.location} · ${job.salary}</p>
        <p>${job.description}</p>
        ${applied
          ? html`<p class="notice ok" role="status">You applied to this job. <a href="/applications">My applications</a></p>`
          : html`<form method="post" action="/jobs/${job.id}/apply">
              <button class="btn" type="submit">Apply</button>
            </form>`}
      </div>`,
  );
});

// ── Applying ─────────────────────────────────────────────────────────────────

/** Loads the job named in the URL. Everything Leash sees comes from this server-side record. */
function loadJob(req: Request, res: Response, next: NextFunction) {
  req.job = getJob(one(req.params.id));
  if (!req.job) return notFound(req, res);
  next();
}

/** A repeat application is refused before Leash is asked, so it never uses up the daily allowance. */
function notAlreadyApplied(req: Request, res: Response, next: NextFunction) {
  if (!hasApplied(req.user!.id, req.job!.id)) return next();
  send(
    req,
    res,
    "Already applied",
    html`<h1>Already applied</h1>
      <p class="notice warn" role="status">You have already applied to this job.</p>
      <p>${req.job!.title} at ${req.job!.company}. <a href="/applications">My applications</a> · <a href="/">All jobs</a></p>`,
  );
}

const applicationParams = (req: Request) => ({
  job_id: req.job!.id,
  summary: `Apply to ${req.job!.title} at ${req.job!.company}`,
});
const applyReturn = (req: Request) => `/jobs/${req.job!.id}/apply/resume`;

function submitApplication(req: Request, res: Response) {
  db.prepare("INSERT INTO applications (id, user_id, job_id, human_verified, created_at) VALUES (?, ?, ?, ?, ?)").run(
    `app_${randomBytes(6).toString("hex")}`,
    req.user!.id,
    req.job!.id,
    req.leash?.verified ? 1 : 0,
    Date.now(),
  );
  res.redirect(303, `/applications?applied=${encodeURIComponent(req.job!.id)}`);
}

app.post(
  "/jobs/:id/apply",
  requireLogin,
  loadJob,
  notAlreadyApplied,
  leash.protect("submit_application", applicationParams, { returnTo: applyReturn }),
  submitApplication,
);

// Leash sends the human back here with a proof (or a denial); the original application then completes by itself.
app.get(
  "/jobs/:id/apply/resume",
  requireLogin,
  loadJob,
  (req, res, next) => {
    if (!req.query.leash_denied) return next();
    send(
      req,
      res,
      "Application declined",
      html`<h1>Application declined</h1>
        <p class="notice err" role="alert">The application was declined by the account owner.</p>
        <p>No application was sent for ${req.job!.title} at ${req.job!.company}. <a href="/">Back to jobs</a></p>`,
    );
  },
  notAlreadyApplied,
  leash.protect("submit_application", applicationParams, { proofRequired: true, returnTo: applyReturn }),
  submitApplication,
);

// ── Blocked page: shown whenever Leash asks for a human ──────────────────────

app.get("/verification-required", requireLogin, (req, res) => {
  res.status(403);
  send(
    req,
    res,
    "Human verification required",
    html`<h1>Human verification required</h1>
      <div class="notice warn" role="alert">
        <p><strong>This application needs human verification.</strong></p>
        <p>Reason: ${one(req.query.reason) || "Not specified"}</p>
        <p>Nothing has been done yet. The account owner must approve it in person with a passkey (Touch ID).</p>
      </div>
      <p><a class="btn" href="${leash.verifyUrl(one(req.query.challenge_id))}">Verify with Leash</a></p>
      <p class="muted">An AI agent cannot complete this step. Ask the account owner to verify.</p>`,
  );
});

// ── My applications ──────────────────────────────────────────────────────────

interface ApplicationRow {
  id: string;
  job_id: string;
  title: string;
  company: string;
  human_verified: number;
  created_at: number;
}

app.get("/applications", requireLogin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.id, a.job_id, j.title, j.company, a.human_verified, a.created_at
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC`,
    )
    .all(req.user!.id) as ApplicationRow[];
  const applied = getJob(one(req.query.applied));
  send(
    req,
    res,
    "My applications",
    html`${applied
        ? html`<p class="notice ok" role="status"><strong>Application submitted.</strong> You applied to ${applied.title} at ${applied.company}.</p>`
        : ""}
      ${req.query.leash_linked ? html`<p class="notice ok" role="status">Your account is connected to Leash.</p>` : ""}
      ${req.query.leash_denied ? html`<p class="notice err" role="alert">The request was declined by the account owner.</p>` : ""}
      <h1>My applications</h1>
      ${rows.length === 0
        ? html`<p class="muted">You have not applied to any jobs yet. <a href="/">Browse jobs</a></p>`
        : html`<p class="muted">${rows.length} application${rows.length === 1 ? "" : "s"} submitted.</p>
            <table>
              <thead><tr><th>Job</th><th>Company</th><th>Applied</th><th>Verification</th></tr></thead>
              <tbody>
                ${rows.map(
                  (a) => html`<tr>
                    <td><a href="/jobs/${a.job_id}">${a.title}</a></td>
                    <td>${a.company}</td>
                    <td>${when(a.created_at)}</td>
                    <td>${a.human_verified
                      ? html`<span class="tag verified">Human verified</span>`
                      : html`<span class="tag">Within agent limits</span>`}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}`,
  );
});

// Sends the user to Leash to connect this account or edit their agent permissions.
app.get("/account/leash", requireLogin, leash.settingsHandler({ returnTo: "/applications" }));

// ── Misc ─────────────────────────────────────────────────────────────────────

function notFound(req: Request, res: Response) {
  res.status(404);
  send(req, res, "Not found", html`<h1>Page not found</h1><p><a href="/">Back to jobs</a></p>`);
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, app: "jobs" });
});
app.use(notFound);

app.listen(PORT, () => console.log(`[jobs] http://localhost:${PORT}`));
