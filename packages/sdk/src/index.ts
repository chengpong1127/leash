import { type ActionsConfig, type Manifest, normalizeManifest } from "@leash/shared";

export type { ActionDef, ActionsConfig, ConstraintDef, Manifest } from "@leash/shared";

export interface LeashConfig<Req = unknown> {
  /** This site's id at Leash. */
  siteId: string;
  /** This site's secret. Server-side only. */
  secret: string;
  /** Base URL of the Leash service, e.g. http://localhost:3000 */
  leashUrl: string;
  /** Return the site's own id for the logged-in user, or undefined when not logged in. */
  getUserId: (req: Req) => string | number | undefined | null;
  /** The protected actions this site has, and what users may configure. */
  actions: ActionsConfig;
}

export interface Leash {
  readonly siteId: string;
  /** The validated manifest (fail-safe values filled in) that is pushed to Leash. */
  readonly manifest: Manifest;
}

/**
 * Validate the config. Throws on anything invalid (e.g. default > ceiling) so a
 * misconfigured site fails at startup rather than at checkout.
 *
 * Milestone 1: validation only. `protect()` and `settingsHandler()` arrive in milestone 2.
 */
export function createLeash<Req = unknown>(config: LeashConfig<Req>): Leash {
  for (const key of ["siteId", "secret", "leashUrl"] as const) {
    if (typeof config[key] !== "string" || config[key] === "") {
      throw new Error(`Leash config: "${key}" is required`);
    }
  }
  if (typeof config.getUserId !== "function") throw new Error('Leash config: "getUserId" is required');
  return { siteId: config.siteId, manifest: normalizeManifest(config.actions) };
}
