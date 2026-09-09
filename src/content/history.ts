import { fetchWorkoutHistory, type FetchLike, type HistoryResult } from "../api/client.js";
import { readCredentials } from "../api/credentials.js";
import type { ReadableStorage } from "../parse/index.js";

/**
 * `FetchLike` implemented over extension messaging, so `fetchWorkoutHistory` is the
 * same code in tests (with a stub) and in the browser (through the service worker).
 * See src/background/main.ts for why the request cannot be made from here.
 */
const viaServiceWorker: FetchLike = async (url, init) => {
  const reply = (await chrome.runtime.sendMessage({
    type: "apiFetch",
    url,
    headers: init.headers,
  })) as { ok: boolean; status: number; body: unknown; error?: string } | undefined;

  if (!reply) throw new Error("The extension's background worker did not respond.");
  if (!reply.ok && reply.status === 0) throw new Error(reply.error ?? "Network request failed.");

  return { ok: reply.ok, status: reply.status, json: async () => reply.body };
};

/** Fetch the full history for the signed-in account. */
export function loadHistory(storage: ReadableStorage): Promise<HistoryResult> {
  return fetchWorkoutHistory(readCredentials(storage), viaServiceWorker);
}
