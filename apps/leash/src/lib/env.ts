/** Public base URL of the Leash service. WebAuthn's rpID and expected origin derive from it. */
export function leashUrl(): string {
  return (process.env.LEASH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
export const leashOrigin = () => new URL(leashUrl()).origin;
export const rpId = () => new URL(leashUrl()).hostname;
