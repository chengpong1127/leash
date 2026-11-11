import { createHash, randomBytes } from "node:crypto";

/** Random prefixed id, e.g. newId("ch") → "ch_Zk3...". */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

/** Site secrets are high-entropy random strings, so a plain SHA-256 is an adequate stored form. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
