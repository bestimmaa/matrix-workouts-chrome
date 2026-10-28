import { describe, expect, it } from "vitest";
import {
  APP_KEY,
  TOKENS_KEY,
  authorizeUrl,
  codeFromRedirect,
  disconnect,
  duplicateOf,
  saveApp,
  uploadRide,
  type StravaDeps,
  type StravaTokens,
  type UploadMessage,
} from "./strava.js";

const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";
const NOW_MS = Date.UTC(2026, 9, 26, 12);
const NOW_S = NOW_MS / 1000;

const MESSAGE: UploadMessage = {
  type: "stravaUpload",
  fields: { data_type: "fit", name: "Sprint 8 · sweat score 9360", trainer: "1", external_id: "matrix-workout-x" },
  filename: "matrix-workout-x.fit",
  fileBase64: btoa("\x0e\x10FIT"),
};

interface Call {
  url: string;
  init: RequestInit;
}

type Reply = { status: number; body?: unknown };

/** A Strava stand-in: answers each request from a queue per URL, and records every call. */
function harness(
  options: {
    stored?: Record<string, unknown>;
    replies?: Record<string, Reply[]>;
    authorize?: (url: string) => Promise<string>;
  } = {},
) {
  const store = new Map<string, unknown>(Object.entries(options.stored ?? {}));
  const calls: Call[] = [];
  const authorized: string[] = [];
  const setup = { opened: 0 };
  const replies = options.replies ?? {};
  const deps: StravaDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      const reply = replies[url]?.shift();
      if (!reply) throw new Error(`unexpected request to ${url}`);
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    },
    load: async <T>(key: string) => store.get(key) as T | undefined,
    save: async (key, value) => void store.set(key, value),
    remove: async (key) => void store.delete(key),
    authorize: async (url) => {
      authorized.push(url);
      return options.authorize ? options.authorize(url) : `${REDIRECT}?state=&code=CODE&scope=read,activity:write`;
    },
    redirectUri: REDIRECT,
    openSetup: async () => void (setup.opened += 1),
    now: () => NOW_MS,
    sleep: async () => {},
  };
  return { deps, store, calls, authorized, setup };
}

const APP = { clientId: "12345", clientSecret: "s3cret" };
const FRESH: StravaTokens = { accessToken: "AT", refreshToken: "RT", expiresAt: NOW_S + 3600 };
const UPLOADS = "https://www.strava.com/api/v3/uploads";
const TOKEN = "https://www.strava.com/oauth/token";
const DEAUTHORIZE = "https://www.strava.com/oauth/deauthorize";
const CONNECTED = { [APP_KEY]: APP, [TOKENS_KEY]: FRESH };
/** An upload Strava finished at once, as activity 5. */
const DONE: Reply = { status: 201, body: { id: 1, activity_id: 5, error: null } };
const activity = (id: number) => `https://www.strava.com/activities/${id}`;
const tokenReply = (access: string): Reply => ({
  status: 200,
  // The real response carries the athlete's profile too; it must not be kept.
  body: { access_token: access, refresh_token: `R-${access}`, expires_at: NOW_S + 21600, athlete: { firstname: "x" } },
});

describe("authorizeUrl and codeFromRedirect", () => {
  it("asks for upload permission and nothing else", () => {
    const url = new URL(authorizeUrl("12345", REDIRECT));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("activity:write");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("takes the code only when the upload scope was granted", () => {
    expect(codeFromRedirect(`${REDIRECT}?code=abc&scope=read,activity:write`)).toBe("abc");
    expect(codeFromRedirect(`${REDIRECT}?code=abc&scope=read`)).toBeNull();
    expect(codeFromRedirect(`${REDIRECT}?error=access_denied`)).toBeNull();
  });
});

describe("duplicateOf", () => {
  it("reads the existing activity out of Strava's error text", () => {
    expect(duplicateOf("matrix-workout-x.fit duplicate of activity 20735485020")).toBe(20735485020);
    expect(duplicateOf("x.fit duplicate of <a href='/activities/20735485020'>Ride</a>")).toBe(20735485020);
    expect(duplicateOf("Improperly formatted data.")).toBeNull();
  });
});

describe("uploadRide", () => {
  it("asks for setup when there is no app, opens the options page, and makes no request", async () => {
    const { deps, calls, authorized, setup } = harness();
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "setup" });
    expect(setup.opened).toBe(1);
    expect(calls).toEqual([]);
    expect(authorized).toEqual([]);
  });

  it("uploads with a stored token, marked indoor, and waits for the activity", async () => {
    const { deps, calls } = harness({
      stored: CONNECTED,
      replies: {
        [UPLOADS]: [{ status: 201, body: { id: 77, activity_id: null, error: null } }],
        [`${UPLOADS}/77`]: [
          { status: 200, body: { id: 77, activity_id: null, error: null } },
          { status: 200, body: { id: 77, activity_id: 999, error: null } },
        ],
      },
    });
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "uploaded", activityUrl: activity(999) });

    const post = calls[0]!;
    expect(post.init.method).toBe("POST");
    expect((post.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer AT");
    const form = post.init.body as FormData;
    expect(form.get("trainer")).toBe("1");
    expect(form.get("name")).toBe("Sprint 8 · sweat score 9360");
    expect(form.get("data_type")).toBe("fit");
    const file = form.get("file") as File;
    expect(file.name).toBe("matrix-workout-x.fit");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0x0e, 0x10, 0x46, 0x49, 0x54]));
    expect(calls.map((c) => c.url)).toEqual([UPLOADS, `${UPLOADS}/77`, `${UPLOADS}/77`]);
  });

  it("signs in on first use, keeps the tokens and drops the profile", async () => {
    const { deps, store, authorized, calls } = harness({
      stored: { [APP_KEY]: APP },
      replies: {
        [TOKEN]: [tokenReply("NEW")],
        [UPLOADS]: [DONE],
      },
    });
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "uploaded", activityUrl: activity(5) });
    expect(authorized).toHaveLength(1);
    const exchange = new URLSearchParams(calls[0]!.init.body as URLSearchParams);
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code")).toBe("CODE");
    expect(exchange.get("client_secret")).toBe("s3cret");
    expect(store.get(TOKENS_KEY)).toEqual({ accessToken: "NEW", refreshToken: "R-NEW", expiresAt: NOW_S + 21600 });
  });

  it("refreshes an expiring token without asking the rider", async () => {
    const { deps, authorized, calls } = harness({
      stored: { [APP_KEY]: APP, [TOKENS_KEY]: { ...FRESH, expiresAt: NOW_S + 60 } },
      replies: {
        [TOKEN]: [tokenReply("REFRESHED")],
        [UPLOADS]: [DONE],
      },
    });
    await uploadRide(deps, MESSAGE);
    expect(authorized).toEqual([]);
    expect(new URLSearchParams(calls[0]!.init.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect((calls[1]!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer REFRESHED");
  });

  it("signs in again, once, when Strava revoked the token", async () => {
    const { deps, authorized } = harness({
      stored: CONNECTED,
      replies: {
        [TOKEN]: [tokenReply("AGAIN")],
        [UPLOADS]: [{ status: 401 }, DONE],
      },
    });
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "uploaded", activityUrl: activity(5) });
    expect(authorized).toHaveLength(1);
  });

  it("reports a declined sign-in as cancelled and keeps nothing", async () => {
    const { deps, store } = harness({
      stored: { [APP_KEY]: APP },
      authorize: async () => `${REDIRECT}?error=access_denied`,
    });
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "cancelled" });
    expect(store.has(TOKENS_KEY)).toBe(false);
  });

  it("reports a wrong client secret as setup", async () => {
    const { deps } = harness({
      stored: { [APP_KEY]: APP },
      replies: { [TOKEN]: [{ status: 401, body: { message: "Authorization Error" } }] },
    });
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "setup" });
  });

  it("turns a duplicate into a link to the ride Strava already has", async () => {
    const { deps } = harness({
      stored: CONNECTED,
      replies: {
        [UPLOADS]: [{ status: 201, body: { id: 3, activity_id: null, error: null } }],
        [`${UPLOADS}/3`]: [
          { status: 200, body: { id: 3, activity_id: null, error: "matrix-workout-x.fit duplicate of activity 20735485020" } },
        ],
      },
    });
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "duplicate", activityUrl: activity(20735485020) });
  });

  it("says processing when Strava has not finished in time, and failed on any other error", async () => {
    const pending = { status: 200, body: { id: 4, activity_id: null, error: null } };
    const slow = harness({
      stored: CONNECTED,
      replies: { [UPLOADS]: [{ status: 201, body: pending.body }], [`${UPLOADS}/4`]: Array(30).fill(pending) },
    });
    expect(await uploadRide(slow.deps, MESSAGE)).toEqual({ kind: "processing" });

    const broken = harness({
      stored: CONNECTED,
      replies: { [UPLOADS]: [{ status: 201, body: { id: 5, activity_id: null, error: "Improperly formatted data." } }] },
    });
    expect(await uploadRide(broken.deps, MESSAGE)).toEqual({ kind: "failed" });
  });
});

describe("uploadRide when storage fails", () => {
  /* The page awaits an answer; a rejection here would leave the button on "Sending…". */
  it("answers failed rather than rejecting", async () => {
    const { deps } = harness();
    deps.load = async () => {
      throw new Error("storage unavailable");
    };
    expect(await uploadRide(deps, MESSAGE)).toEqual({ kind: "failed" });
  });
});

describe("saveApp", () => {
  it("keeps the tokens for the same app and drops them for a different one", async () => {
    const { deps, store } = harness({ stored: CONNECTED });
    await saveApp(deps, { ...APP, clientSecret: "rotated" });
    expect(store.get(TOKENS_KEY)).toEqual(FRESH);
    await saveApp(deps, { clientId: "99999", clientSecret: "other" });
    expect(store.has(TOKENS_KEY)).toBe(false);
    expect(store.get(APP_KEY)).toEqual({ clientId: "99999", clientSecret: "other" });
  });
});

describe("disconnect", () => {
  it("refreshes an expired token so the revoke can work", async () => {
    const { deps, store, calls } = harness({
      stored: { [APP_KEY]: APP, [TOKENS_KEY]: { ...FRESH, expiresAt: NOW_S - 60 } },
      replies: { [TOKEN]: [tokenReply("LIVE")], DEAUTHORIZE: [{ status: 200 }] },
    });
    await disconnect(deps);
    expect(calls.map((c) => c.url)).toEqual([TOKEN, DEAUTHORIZE]);
    expect(new URLSearchParams(calls[1]!.init.body as URLSearchParams).get("access_token")).toBe("LIVE");
    expect(store.size).toBe(0);
  });

  it("revokes the token and forgets the app, even offline", async () => {
    const { deps, store, calls } = harness({ stored: CONNECTED });
    await disconnect(deps); // no reply queued: the deauthorize request throws
    expect(calls.map((c) => c.url)).toEqual([DEAUTHORIZE]);
    expect(store.size).toBe(0);
  });
});
