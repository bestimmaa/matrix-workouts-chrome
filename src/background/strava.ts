import type { StravaUpload } from "matrix-workouts-core";
import type { StravaOutcome } from "../ui/dashboard.js";

/**
 * The Strava client: sign-in, the upload, and waiting for Strava to process it.
 *
 * Everything that touches a platform arrives through `StravaDeps`, so the whole
 * flow runs in tests against a stub. `main.ts` passes in `fetch`, `chrome.identity`
 * and `chrome.storage`.
 *
 * **The app is the rider's own.** Strava gives no sign-in without a client secret,
 * and a new API app only lets its owner connect, so there is no shared app this
 * extension could ship with. The rider registers one and enters it on the options
 * page, which hands it to `saveApp`. Everything Strava-related in
 * `chrome.storage.local` is written here. No athlete profile is kept: the token
 * response carries one, and it is dropped here.
 */

const STRAVA_ORIGIN = "https://www.strava.com";
const UPLOADS = `${STRAVA_ORIGIN}/api/v3/uploads`;
const TOKEN = `${STRAVA_ORIGIN}/oauth/token`;
const DEAUTHORIZE = `${STRAVA_ORIGIN}/oauth/deauthorize`;
/** Upload and read back the upload's status. Nothing else is asked for. */
const SCOPE = "activity:write";

/** Storage keys. The options page reads them to show the connection status. */
export const APP_KEY = "stravaApp";
export const TOKENS_KEY = "stravaTokens";

export interface StravaApp {
  clientId: string;
  clientSecret: string;
}

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds since the epoch, as Strava gives it. */
  expiresAt: number;
}

/** The upload as it crosses from the content script: core's `stravaUpload`, with the bytes in base64. */
export interface UploadMessage {
  type: "stravaUpload";
  fields: StravaUpload["fields"];
  filename: string;
  fileBase64: string;
}

/** The rider's app, from the options page. */
export interface SaveAppMessage {
  type: "stravaSaveApp";
  app: StravaApp;
}

export function isUploadMessage(message: unknown): message is UploadMessage {
  const m = message as Partial<UploadMessage> | null;
  return (
    typeof m === "object" &&
    m !== null &&
    m.type === "stravaUpload" &&
    typeof m.fields === "object" &&
    typeof m.filename === "string" &&
    typeof m.fileBase64 === "string"
  );
}

export function isSaveAppMessage(message: unknown): message is SaveAppMessage {
  const m = message as Partial<SaveAppMessage> | null;
  return (
    typeof m === "object" &&
    m !== null &&
    m.type === "stravaSaveApp" &&
    typeof m.app?.clientId === "string" &&
    typeof m.app.clientSecret === "string"
  );
}

export interface StravaDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  load<T>(key: string): Promise<T | undefined>;
  save(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Open Strava's consent page and resolve with the URL it redirected to. Rejects if the rider closes it. */
  authorize(url: string): Promise<string>;
  redirectUri: string;
  /** Show the options page, where the rider's app is entered. */
  openSetup(): Promise<void>;
  /** Milliseconds since the epoch. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Strava's guidance is to poll no faster than once a second; processing averages under two. */
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 30;
/** Refresh a token this close to expiry rather than have the upload fail on it. */
const EXPIRY_MARGIN_SECONDS = 120;

export function authorizeUrl(clientId: string, redirectUri: string): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
  });
  return `${STRAVA_ORIGIN}/oauth/authorize?${query}`;
}

/**
 * The code from Strava's redirect, or null when the rider declined. Unticking the
 * upload box on the consent page still redirects with a code, just without the
 * scope, so the scope is checked too.
 */
export function codeFromRedirect(redirect: string): string | null {
  const params = new URL(redirect).searchParams;
  const code = params.get("code");
  const granted = (params.get("scope") ?? "").split(",");
  return code && !params.has("error") && granted.includes(SCOPE) ? code : null;
}

/**
 * The activity a duplicate upload collided with. Strava reports it only inside the
 * error text, as "… duplicate of activity 123" or as a link to `/activities/123`.
 */
export function duplicateOf(error: string): number | null {
  const match = /duplicate of\D*?(\d{5,})/i.exec(error);
  return match ? Number(match[1]) : null;
}

const activityUrl = (id: number): string => `${STRAVA_ORIGIN}/activities/${id}`;

class NeedsSignIn extends Error {}

async function requestTokens(deps: StravaDeps, app: StravaApp, grant: Record<string, string>): Promise<StravaTokens> {
  const response = await deps.fetch(TOKEN, {
    method: "POST",
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...grant }),
  });
  if (response.status === 400 || response.status === 401) throw new NeedsSignIn();
  if (!response.ok) throw new Error(`Strava sign-in answered ${response.status}.`);
  const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown };
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.expires_at !== "number") {
    throw new Error("Strava's sign-in response was not in the expected shape.");
  }
  const tokens = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_at };
  await deps.save(TOKENS_KEY, tokens);
  return tokens;
}

/** The stored tokens if they are good for a few more minutes, refreshed ones if not. */
function current(deps: StravaDeps, app: StravaApp, tokens: StravaTokens): Promise<StravaTokens> | StravaTokens {
  return tokens.expiresAt - EXPIRY_MARGIN_SECONDS > deps.now() / 1000
    ? tokens
    : requestTokens(deps, app, { refresh_token: tokens.refreshToken, grant_type: "refresh_token" });
}

/** Ask the rider to connect, from scratch. Null if they declined or closed the window. */
async function signIn(deps: StravaDeps, app: StravaApp): Promise<StravaTokens | null> {
  await deps.remove(TOKENS_KEY);
  let redirect: string;
  try {
    redirect = await deps.authorize(authorizeUrl(app.clientId, deps.redirectUri));
  } catch {
    return null;
  }
  const code = codeFromRedirect(redirect);
  if (!code) return null;
  return requestTokens(deps, app, { code, grant_type: "authorization_code" });
}

/** A usable token: the stored one, a refreshed one, or a new sign-in when Strava refuses to refresh. */
async function accessToken(deps: StravaDeps, app: StravaApp): Promise<StravaTokens | null> {
  const stored = await deps.load<StravaTokens>(TOKENS_KEY);
  if (stored) {
    try {
      return await current(deps, app, stored);
    } catch (error) {
      if (!(error instanceof NeedsSignIn)) throw error;
    }
  }
  return signIn(deps, app);
}

interface UploadStatus {
  id?: number;
  activity_id?: number | null;
  error?: string | null;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A finished upload, a duplicate, or a failure, read off one status response. Null while processing. */
function settled(status: UploadStatus): StravaOutcome | null {
  if (status.error) {
    const existing = duplicateOf(status.error);
    return existing ? { kind: "duplicate", activityUrl: activityUrl(existing) } : { kind: "failed" };
  }
  return status.activity_id ? { kind: "uploaded", activityUrl: activityUrl(status.activity_id) } : null;
}

async function post(deps: StravaDeps, token: string, message: UploadMessage): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(message.fields)) form.append(name, value);
  form.append("file", new Blob([fromBase64(message.fileBase64)]), message.filename);
  return deps.fetch(UPLOADS, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
}

/** There is no app to sign in with: show the rider where to enter one. */
async function needsSetup(deps: StravaDeps): Promise<StravaOutcome> {
  await deps.openSetup().catch(() => undefined);
  return { kind: "setup" };
}

/**
 * Upload one ride and wait until Strava has made an activity of it.
 *
 * A 401 means the stored token was revoked from Strava's side, so the rider is asked
 * to connect again, once. A failure never carries Strava's error text up to the
 * page: the outcome says what happened, and the page shows its own words. This
 * never rejects, because the page is waiting on the answer.
 */
export async function uploadRide(deps: StravaDeps, message: UploadMessage): Promise<StravaOutcome> {
  try {
    const app = await deps.load<StravaApp>(APP_KEY);
    if (!app?.clientId || !app.clientSecret) return await needsSetup(deps);
    return await upload(deps, app, message);
  } catch (error) {
    // Strava turning down a fresh code means the app's id or secret is wrong.
    return error instanceof NeedsSignIn ? needsSetup(deps) : { kind: "failed" };
  }
}

async function upload(deps: StravaDeps, app: StravaApp, message: UploadMessage): Promise<StravaOutcome> {
  let tokens = await accessToken(deps, app);
  if (!tokens) return { kind: "cancelled" };
  let response = await post(deps, tokens.accessToken, message);
  if (response.status === 401) {
    tokens = await signIn(deps, app);
    if (!tokens) return { kind: "cancelled" };
    response = await post(deps, tokens.accessToken, message);
  }
  if (!response.ok) return { kind: "failed" };

  let status = (await response.json()) as UploadStatus;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const outcome = settled(status);
    if (outcome) return outcome;
    if (typeof status.id !== "number") return { kind: "failed" };
    await deps.sleep(POLL_INTERVAL_MS);
    const poll = await deps.fetch(`${UPLOADS}/${status.id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!poll.ok) return { kind: "failed" };
    status = (await poll.json()) as UploadStatus;
  }
  return settled(status) ?? { kind: "processing" };
}

/** Keep the rider's app. Tokens belong to the app that issued them, so a different app starts over. */
export async function saveApp(deps: StravaDeps, app: StravaApp): Promise<void> {
  const before = await deps.load<StravaApp>(APP_KEY);
  await deps.save(APP_KEY, app);
  if (before?.clientId !== app.clientId) await deps.remove(TOKENS_KEY);
}

/**
 * Forget the connection: revoke the token on Strava's side where it can, then drop
 * the tokens and the app's details here. The local half happens whatever the
 * network does, because "Disconnect" has to work offline too.
 */
export async function disconnect(deps: StravaDeps): Promise<void> {
  try {
    const app = await deps.load<StravaApp>(APP_KEY);
    const stored = await deps.load<StravaTokens>(TOKENS_KEY);
    if (app && stored) {
      // An expired access token cannot revoke anything, so refresh it first.
      const tokens = await current(deps, app, stored);
      await deps.fetch(DEAUTHORIZE, { method: "POST", body: new URLSearchParams({ access_token: tokens.accessToken }) });
    }
  } catch {
    // Offline, or Strava already forgot us: the local half still happens.
  }
  await deps.remove(TOKENS_KEY);
  await deps.remove(APP_KEY);
}
