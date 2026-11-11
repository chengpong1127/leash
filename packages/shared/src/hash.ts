import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace.
 * `undefined` properties are dropped (as JSON.stringify does); values JSON cannot
 * represent faithfully (NaN, Infinity, bigint, functions) are rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalize a non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const obj = value as Record<string, unknown>;
      const parts = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
  }
}

/** SHA-256 (base64url) of the canonical JSON of `params`. Binds a proof to exact parameters. */
export function hashParams(params: unknown): string {
  return createHash("sha256").update(canonicalJson(params)).digest("base64url");
}
