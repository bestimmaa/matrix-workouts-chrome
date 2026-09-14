import { API_ORIGIN } from "matrix-workouts-core";

/**
 * Service worker. Its only job is to make the one cross-origin request the content
 * script cannot.
 *
 * Content-script `fetch` is subject to CORS as the *page's* origin, regardless of
 * `host_permissions` — so a call from `matrixworkouts.jfit.co` to `apollo.jfit.co`
 * is at the mercy of headers we do not control. A request from the service worker
 * runs with the extension's host permissions instead and is not.
 *
 * This worker is deliberately dumb: it forwards one request to one allowed origin
 * and returns the body. It does not parse, cache, store, or log anything — the
 * Authorization header passes through in memory and is gone when the response is.
 */

interface ApiFetchMessage {
  type: "apiFetch";
  url: string;
  headers: Record<string, string>;
}

interface ApiFetchReply {
  ok: boolean;
  status: number;
  body: unknown;
  /** Set only on a transport failure, and never contains request headers. */
  error?: string;
}

function isApiFetch(message: unknown): message is ApiFetchMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as ApiFetchMessage).type === "apiFetch" &&
    typeof (message as ApiFetchMessage).url === "string"
  );
}

async function forward(message: ApiFetchMessage): Promise<ApiFetchReply> {
  // Hard allowlist. The url arrives from a content script, and a content script
  // shares a page with code we do not control, so it is not trusted to name a host.
  if (!message.url.startsWith(`${API_ORIGIN}/`)) {
    return { ok: false, status: 0, body: null, error: "Refused: request was not for the workout API." };
  }
  try {
    const response = await fetch(message.url, {
      method: "GET",
      headers: message.headers,
      credentials: "omit",
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : "Network request failed.",
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isApiFetch(message)) return false;
  forward(message).then(sendResponse);
  return true; // keep the channel open for the async reply
});

/**
 * Toolbar icon: the one entry point that works from anywhere on the site, without
 * depending on the user spotting a pill in a corner. `chrome.action.onClicked`
 * only fires here, so the click has to be relayed to the content script.
 *
 * The `activeTab` permission is what makes `tabs.sendMessage` legal, and it is
 * granted only for the tab the user just clicked on, only for as long as they stay
 * there — a much tighter grant than a host permission for the whole site.
 */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // The content script is only present on the site; elsewhere this is a no-op.
  chrome.tabs.sendMessage(tab.id, { type: "toggleSurface" }).catch(() => {});
});
