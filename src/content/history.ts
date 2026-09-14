import {
  fetchWorkoutHistory,
  readCredentials,
  type FetchLike,
  type HistoryResult,
  type ReadableStorage,
} from "matrix-workouts-core";

/**
 * `FetchLike` implemented over extension messaging, so `fetchWorkoutHistory` is the
 * same code in tests (with a stub) and in the browser (through the service worker).
 * See src/background/main.ts for why the request cannot be made from here.
 */
const viaServiceWorker: FetchLike = async (url, init) => {
  // The worker's message contract carries a url and headers and nothing else, so a
  // request with a body would be silently downgraded to a GET. Nothing in the
  // extension makes one — sign-in is the standalone client's problem, not ours —
  // and this makes sure that stays true instead of failing quietly if it changes.
  if (init.method && init.method !== "GET") {
    throw new Error(`The background worker only makes GET requests, not ${init.method}.`);
  }

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
