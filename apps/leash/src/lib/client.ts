/** Browser helpers: JSON API calls and the "fresh passkey" flow used for every sensitive action. */
import { WebAuthnError, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Policy } from "@leash/shared";
import type { CeremonyOptionsResponse, ChallengeStatusResponse } from "./view-types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new ApiError(res.status, String(data?.error ?? "error"), String(data?.message ?? `Request failed (${res.status})`));
  }
  return data as T;
}

/** A message a person can act on, for anything thrown during a passkey flow. */
export function describeError(e: unknown): string {
  if (e instanceof WebAuthnError || (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError"))) {
    if (e.name === "NotAllowedError" || e.name === "AbortError" || (e instanceof WebAuthnError && e.code === "ERROR_CEREMONY_ABORTED")) {
      return "The passkey prompt was cancelled or timed out. Nothing was changed — try again when you are ready.";
    }
    return `Passkey error: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Something went wrong. Please try again.";
}

type Mode = "assert" | "register";

/**
 * Ask the server for a ceremony bound to one specific thing, run the passkey prompt
 * (Touch ID / Face ID), and post the result to `actionUrl` together with `payload`.
 */
export async function withPasskey<T>(optionsUrl: string, optionsBody: unknown, actionUrl: string, payload: object, mode: Mode = "assert"): Promise<T> {
  const { ceremonyId, options } = await api<CeremonyOptionsResponse>(optionsUrl, optionsBody);
  const response =
    mode === "register"
      ? await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"] })
      : await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
  return api<T>(actionUrl, { ...payload, ceremonyId, response });
}

const enc = encodeURIComponent;

export const approveChallenge = (id: string, mode: Mode) =>
  withPasskey<ChallengeStatusResponse>(`/api/challenges/${enc(id)}/options`, { mode }, `/api/challenges/${enc(id)}/approve`, { mode }, mode);

export const denyChallenge = (id: string) => api<ChallengeStatusResponse>(`/api/challenges/${enc(id)}/deny`, {});

export const challengeStatus = (id: string) => api<ChallengeStatusResponse>(`/api/challenges/${enc(id)}/status`);

export const savePolicy = (linkId: string, policy: Policy) =>
  withPasskey<{ ok: true; policy: Policy }>(`/api/links/${enc(linkId)}/options`, { purpose: "policy", policy }, `/api/links/${enc(linkId)}/policy`, { policy });

/** Pausing only ever restricts the agent, so it needs no passkey. Un-pausing does. */
export const setPaused = (linkId: string, paused: boolean) =>
  paused
    ? api<{ ok: true; paused: boolean }>(`/api/links/${enc(linkId)}/pause`, { paused: true })
    : withPasskey<{ ok: true; paused: boolean }>(`/api/links/${enc(linkId)}/options`, { purpose: "unpause" }, `/api/links/${enc(linkId)}/pause`, { paused: false });
