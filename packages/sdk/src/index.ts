import { type ActionsConfig, LINK_ACTION, type Manifest, hashParams, normalizeManifest } from "@leash/shared";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type { ActionDef, ActionsConfig, ConstraintDef, Manifest } from "@leash/shared";

export interface LeashConfig {
  /** This site's id at Leash. */
  siteId: string;
  /** This site's secret. Server-side only. */
  secret: string;
  /** Base URL of the Leash service, e.g. http://localhost:3000 */
  leashUrl: string;
  /** Return the site's own id for the logged-in user, or nothing when not logged in. */
  getUserId: (req: Request) => string | number | undefined | null;
  /** The protected actions this site has, and what users may configure. */
  actions: ActionsConfig;
  /**
   * A page on this site that tells the user an action needs human verification. HTML requests
   * that are blocked get redirected there with `?action=…&reason=…&challenge_id=…`.
   * Build the button's link with `leash.verifyUrl(challenge_id)`. Without it, the SDK shows a plain built-in page.
   */
  blockedPath?: string;
  /** How long to wait for Leash before failing closed. Default 5000 ms. */
  timeoutMs?: number;
  /** Set to false to skip the manifest push on startup (tests). */
  pushManifest?: boolean;
  logger?: Pick<Console, "info" | "warn">;
}

/**
 * What `getParams` returns: `summary` is the human-readable description shown on the
 * verify page; every other key is a param the policy is evaluated against and the proof is bound to.
 *
 * TRUST RULE: every value must come from the site's server-side state (the price in your
 * database, the cart total you computed) — never a number the client sent.
 */
export type ActionParams = { summary?: string } & Record<string, unknown>;

export interface ProtectOptions {
  /**
   * Path on this site that Leash sends the human back to after approving or denying, with
   * `leash_proof=<jwt>` or `leash_denied=1` appended. That route should re-run `protect` for
   * the same action with the same params. Default: the site's home page.
   */
  returnTo?: string | ((req: Request) => string);
  /**
   * For the route that Leash returns to: only proceed with a proof that verifies for exactly
   * this user, action and params. Use it when that route is a GET, so that a bare link to it can never perform the action.
   */
  proofRequired?: boolean;
}

export interface LeashResult {
  /** true when a human proved presence for this exact action; false when it was within the user's agent limits. */
  verified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      leash?: LeashResult;
    }
  }
}

export interface Leash {
  readonly siteId: string;
  /** The validated manifest (fail-safe values filled in) that is pushed to Leash. */
  readonly manifest: Manifest;
  /** Resolves once the manifest has been accepted by Leash (retried until it is). */
  readonly ready: Promise<void>;
  /** Express middleware for a sensitive route. */
  protect(action: string, getParams: (req: Request) => ActionParams | Promise<ActionParams>, options?: ProtectOptions): RequestHandler;
  /** Route handler that sends the logged-in user to Leash to connect their account or manage agent permissions. */
  settingsHandler(options?: { returnTo?: string }): RequestHandler;
  /** The Leash page where a human approves the given challenge. */
  verifyUrl(challengeId: string): string;
}

type AuthorizeResponse =
  | { decision: "allow"; verified: boolean }
  | { decision: "require_human"; challenge_id: string; verify_url: string; reason: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
  `<body style="font:16px/1.5 system-ui;max-width:560px;margin:80px auto;padding:0 24px"><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

/** JSON API callers get JSON errors; browsers get pages and redirects. */
const wantsJson = (req: Request) => Boolean(req.is("json")) || req.accepts(["html", "json"]) === "json";

export function createLeash(config: LeashConfig): Leash {
  for (const key of ["siteId", "secret", "leashUrl"] as const) {
    if (typeof config[key] !== "string" || config[key] === "") throw new Error(`Leash config: "${key}" is required`);
  }
  if (typeof config.getUserId !== "function") throw new Error('Leash config: "getUserId" is required');

  // Throws on invalid config (e.g. default > ceiling): fail at startup, not at checkout.
  const manifest = normalizeManifest(config.actions);
  const leashUrl = config.leashUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 5000;
  const log = config.logger ?? console;
  const jwks = createRemoteJWKSet(new URL(`${leashUrl}/api/v1/jwks.json`), { timeoutDuration: timeoutMs });

  async function call(method: string, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${leashUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${config.secret}`, "leash-site": config.siteId },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Leash responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  // Push the manifest on startup. Leash may still be booting, so retry until it is accepted;
  // until then Leash only knows the previous manifest and treats unknown actions as "human".
  const ready =
    config.pushManifest === false
      ? Promise.resolve()
      : (async () => {
          for (let attempt = 1; ; attempt++) {
            try {
              await call("PUT", "/api/v1/manifest", { actions: manifest.actions });
              log.info(`[leash] manifest accepted for ${config.siteId}`);
              return;
            } catch (e) {
              if (attempt === 1 || attempt % 10 === 0) log.warn(`[leash] manifest push failed, retrying: ${(e as Error).message}`);
              await new Promise((r) => setTimeout(r, 2000).unref());
            }
          }
        })();

  const siteOrigin = (req: Request) => `${req.protocol}://${req.get("host")}`;

  /** Defense in depth: check the proof locally (signature, audience, expiry, and what it is bound to) before asking Leash. */
  async function proofIsValid(proof: string, userId: string, action: string, paramsHash: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(proof, jwks, { algorithms: ["EdDSA"], issuer: leashUrl, audience: config.siteId });
      return payload.site_user_id === userId && payload.action === action && payload.params_hash === paramsHash;
    } catch (e) {
      // Could not even fetch Leash's keys → Leash is unreachable → fail closed.
      if ((e as { code?: string }).code === "ERR_JWKS_TIMEOUT" || e instanceof TypeError) throw e;
      return false;
    }
  }

  function unavailable(req: Request, res: Response, error: unknown) {
    log.warn(`[leash] failing closed: ${(error as Error)?.message ?? error}`);
    res.status(503);
    if (wantsJson(req)) res.json({ error: "leash_unavailable", message: "Verification service unavailable. The action was not performed." });
    else res.send(page("Temporarily unavailable", "<p>The verification service is unavailable, so this action was not performed. Please try again shortly.</p>"));
  }

  function readProof(req: Request): string | undefined {
    const candidates = [req.get("Leash-Proof"), (req.body as Record<string, unknown> | undefined)?.leash_proof, req.query?.leash_proof];
    return candidates.find((v): v is string => typeof v === "string" && v.length > 0);
  }

  const verifyUrl = (challengeId: string) => `${leashUrl}/verify/${encodeURIComponent(challengeId)}`;

  return {
    siteId: config.siteId,
    manifest,
    ready,
    verifyUrl,

    protect(action, getParams, options = {}) {
      if (!manifest.actions[action]) throw new Error(`Leash: protect("${action}") is not declared in config.actions`);

      return async (req: Request, res: Response, next: NextFunction) => {
        // 1. Not logged in: not Leash's business — the site's own auth handles it.
        const rawUserId = config.getUserId(req);
        if (rawUserId === undefined || rawUserId === null || rawUserId === "") return next();
        const userId = String(rawUserId);

        let summary: string;
        let params: Record<string, unknown>;
        try {
          const { summary: s, ...rest } = await getParams(req);
          summary = s ?? manifest.actions[action]!.label;
          params = rest;
        } catch (e) {
          return next(e);
        }

        try {
          // 2. Optional proof from the Leash-Proof header or a leash_proof field.
          let proof = readProof(req);
          if (proof && !(await proofIsValid(proof, userId, action, hashParams(params)))) proof = undefined;
          if (options.proofRequired && !proof) {
            res.status(400);
            if (wantsJson(req)) res.json({ error: "invalid_proof", message: "A valid Leash proof is required." });
            else res.send(page("Verification link expired", '<p>This verification link is invalid or has expired. Nothing was done.</p><p><a href="/">Back to the site</a></p>'));
            return;
          }

          // 3. Ask Leash.
          const returnTo = typeof options.returnTo === "function" ? options.returnTo(req) : (options.returnTo ?? "/");
          const decision = (await call("POST", "/api/v1/authorize", {
            site_user_id: userId,
            action,
            params,
            summary,
            proof,
            return_url: new URL(returnTo, siteOrigin(req)).toString(),
          })) as AuthorizeResponse;

          // 4. Allowed: within the user's agent limits, or proven human.
          if (decision.decision === "allow") {
            req.leash = { verified: decision.verified === true };
            return next();
          }

          // 5. A human is needed.
          if (decision.decision === "require_human") {
            if (wantsJson(req)) {
              res.status(403).json({
                error: "human_verification_required",
                reason: decision.reason,
                challenge_id: decision.challenge_id,
                verify_url: decision.verify_url,
              });
            } else if (config.blockedPath) {
              const query = new URLSearchParams({ action, reason: decision.reason, challenge_id: decision.challenge_id });
              res.redirect(303, `${config.blockedPath}?${query}`);
            } else {
              res.status(403).send(
                page(
                  "Human verification required",
                  `<p>This action needs human verification. Reason: ${escapeHtml(decision.reason)}</p>` +
                    `<p><a href="${escapeHtml(verifyUrl(decision.challenge_id))}">Verify with Leash</a></p>`,
                ),
              );
            }
            return;
          }
          throw new Error("Unexpected response from Leash");
        } catch (e) {
          // 6. Leash unreachable or confused: fail closed. Never allow.
          unavailable(req, res, e);
        }
      };
    },

    settingsHandler(options = {}) {
      return async (req: Request, res: Response, next: NextFunction) => {
        const rawUserId = config.getUserId(req);
        if (rawUserId === undefined || rawUserId === null || rawUserId === "") return next();
        try {
          const decision = (await call("POST", "/api/v1/authorize", {
            site_user_id: String(rawUserId),
            action: LINK_ACTION,
            params: {},
            summary: "Connect this account to Leash",
            return_url: new URL(options.returnTo ?? "/", siteOrigin(req)).toString(),
          })) as AuthorizeResponse;
          if (decision.decision !== "require_human") throw new Error("Unexpected response from Leash");
          res.redirect(303, decision.verify_url);
        } catch (e) {
          unavailable(req, res, e);
        }
      };
    },
  };
}
