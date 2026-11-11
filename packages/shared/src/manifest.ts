import { z } from "zod";
import type { Manifest, NormalizedAction, NormalizedConstraint } from "./types";

export class ManifestError extends Error {
  constructor(message: string) {
    super(`Invalid Leash manifest: ${message}`);
    this.name = "ManifestError";
  }
}

/** Action and constraint names. Names starting with "_" (e.g. "__link__") are reserved. */
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

const text = z
  .string("must be a non-empty string")
  .max(200, "must be at most 200 characters")
  .refine((s) => s.trim() !== "", "must be a non-empty string");
const limit = z.number("must be a non-negative number").nonnegative("must be a non-negative number");
const period = z.enum(["day", "month"], 'must be "day" or "month"');

const constraintBase = { label: text, default: limit.optional(), ceiling: limit.optional() };

/** Discriminated on `type`. To support e.g. `allowlist` later, add a member here (and in types.ts / evaluate.ts). */
const constraintSchema = z
  .discriminatedUnion(
    "type",
    [
      z.object({ type: z.literal("max"), param: text, ...constraintBase }),
      z.object({ type: z.literal("sum_per_period"), param: text, period, ...constraintBase }),
      z.object({ type: z.literal("count_per_period"), period, ...constraintBase }),
    ],
    'must be "max", "sum_per_period" or "count_per_period"',
  )
  .transform((c, ctx): NormalizedConstraint => {
    // Missing default → 0; missing ceiling → the default. Both fail safe.
    const def = c.default ?? 0;
    const ceiling = c.ceiling ?? def;
    if (def > ceiling) {
      ctx.addIssue({ code: "custom", message: `default (${def}) must be <= ceiling (${ceiling})` });
    }
    return { ...c, default: def, ceiling };
  });

const actionSchema = z
  .object(
    {
      label: text,
      mode: z.enum(["auto", "human"], 'must be "auto" or "human"').optional(),
      userConfigurable: z.boolean("must be a boolean").optional(),
      constraints: z.record(z.string(), constraintSchema, "must be an object").optional(),
    },
    "must be an object",
  )
  .transform(
    (a): NormalizedAction => ({
      label: a.label,
      mode: a.mode ?? "human", // missing mode fails safe
      userConfigurable: a.userConfigurable !== false,
      constraints: a.constraints ?? {},
    }),
  );

const actionsSchema = z.record(z.string(), actionSchema, "actions must be an object");

/** Turn a zod issue into one line a site developer can act on. */
function describe(issue: z.core.$ZodIssue): string {
  const [action, section, constraint, field] = issue.path.map(String);
  if (action === undefined) return issue.message;
  let where = `action "${action}"`;
  if (section === "constraints" && constraint !== undefined) {
    where += ` constraint "${constraint}"`;
    if (field !== undefined) where += `: "${field}"`;
  } else if (section !== undefined) {
    where += `: "${section}"`;
  }
  return `${where} ${issue.message}`.replace(/" (default \()/, '": $1');
}

/**
 * Validate an actions map — `{ [actionName]: ActionDef }` — from the SDK or the network and fill in fail-safe
 * values: missing `mode` → "human", missing `default` → 0. Throws ManifestError.
 */
export function normalizeManifest(rawActions: unknown): Manifest {
  // Names are checked up front so the message can name the offending key.
  if (typeof rawActions === "object" && rawActions !== null && !Array.isArray(rawActions)) {
    for (const [name, action] of Object.entries(rawActions)) {
      if (!NAME.test(name)) {
        throw new ManifestError(`action "${name}": names must match ${NAME} (names starting with "_" are reserved)`);
      }
      const constraints = (action as { constraints?: unknown } | null)?.constraints;
      for (const key of Object.keys(typeof constraints === "object" && constraints !== null ? constraints : {})) {
        if (!NAME.test(key)) throw new ManifestError(`action "${name}": invalid constraint name "${key}"`);
      }
    }
  }

  const result = actionsSchema.safeParse(rawActions);
  if (!result.success) throw new ManifestError(result.error.issues.map(describe).join("; "));
  return { actions: result.data };
}
