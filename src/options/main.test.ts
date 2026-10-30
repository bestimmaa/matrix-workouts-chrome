// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { APP_KEY, TOKENS_KEY } from "../background/strava.js";

/*
 * The options page against the real `options.html` and a `chrome.storage` stand-in
 * that fires `onChanged` the way Chrome does, from any writer. `main.ts` runs when
 * it is imported, so it is imported once and the tests run in order on that page.
 */

const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";
const store = new Map<string, unknown>();
/** Every request the page makes; none may reach the network from a test. */
const requests: string[] = [];
const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
const changed = (changes: Record<string, unknown>) => listeners.forEach((listen) => listen(changes, "local"));

beforeAll(async () => {
  const html = readFileSync(resolve(process.cwd(), "public/options.html"), "utf8");
  document.documentElement.innerHTML = html.replace(/<script[^>]*><\/script>/, "");
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
          changed(items);
        },
        remove: async (key: string) => {
          if (store.delete(key)) changed({ [key]: {} });
        },
      },
      onChanged: { addListener: (listen: (typeof listeners)[number]) => listeners.push(listen) },
    },
    identity: { getRedirectURL: () => REDIRECT },
    runtime: { openOptionsPage: async () => {} },
  });
  await import("./main.js");
});

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const text = (id: string) => document.getElementById(id)!.textContent;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the options page", () => {
  it("prints the callback domain to register, and starts not set up", async () => {
    await settle();
    expect(text("callback")).toBe("abcdefghijklmnop.chromiumapp.org");
    expect(text("status")).toBe("Not set up.");
  });

  it("saves the app, trimmed, and says the first upload will connect", async () => {
    field("clientId").value = " 12345 ";
    field("clientSecret").value = "s3cret";
    document.querySelector<HTMLFormElement>("form#app")!.requestSubmit();
    await settle();
    expect(store.get(APP_KEY)).toEqual({ clientId: "12345", clientSecret: "s3cret" });
    expect(text("saved")).toContain("Saved");
    expect(text("status")).toMatch(/^Not connected yet/);
    expect(field("clientId").value).toBe("12345");
  });

  it("shows a connection the worker made, without touching what the rider is typing", async () => {
    field("clientSecret").value = "rotated-but-not-saved";
    // An upload in another tab signs in: the worker writes the tokens, not the app.
    await chrome.storage.local.set({ [TOKENS_KEY]: { accessToken: "AT", refreshToken: "RT", expiresAt: 4102444800 } });
    await settle();
    expect(text("status")).toMatch(/^Connected/);
    expect(field("clientSecret").value).toBe("rotated-but-not-saved");
  });

  it("revokes the token and forgets everything on disconnect", async () => {
    document.getElementById("disconnect")!.click();
    await settle();
    await settle();
    expect(requests).toEqual(["https://www.strava.com/oauth/deauthorize"]);
    expect(store.size).toBe(0);
    expect(text("status")).toBe("Not set up.");
    expect(field("clientId").value).toBe("");
    expect(field("clientSecret").value).toBe("");
  });
});
