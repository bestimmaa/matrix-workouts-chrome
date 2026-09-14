/**
 * Standalone workout client — sign in with an xid and passcode, download the full
 * history, write it to disk.
 *
 *   npm run history                 # -> history/raw-history-<timestamp>.json
 *   npm run history -- --split      # also one export document per ride
 *   npm run history -- --out data   # somewhere other than history/
 *
 * This is the one part of the project that runs outside the browser and therefore
 * the one part that handles a passcode. Everything else borrows the session the site
 * already established. See MATRIX_API.md for the endpoints.
 *
 * PRIVACY: credentials come from `.env` (gitignored) or the environment, are used
 * for the single sign-in request, and are never written to the output or the
 * console. The token is likewise never printed. The output directory is gitignored
 * because these files are the rider's heart rate.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { loginWithXid } = await import("../src/api/login.js");
const { fetchWorkoutHistory, workoutsUrl, ApiError } = await import("../src/api/client.js");
const { workoutExport, exportFilename } = await import("../src/export/document.js");
const { toWorkout } = await import("../src/parse/workout.js");

/**
 * Read `.env` without taking on a dependency for it. Deliberately minimal: `KEY=value`,
 * `#` comments, blank lines, optional surrounding quotes. A real `.env` parser handles
 * multi-line values and interpolation; two numbers do not need either.
 *
 * The real environment wins, so `MATRIX_XID=... npm run history` works without
 * editing the file.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Copy .env.example to .env and fill in your xid and passcode,\n` +
        `or pass it in the environment: ${name}=... npm run history`,
    );
    process.exit(1);
  }
  return value;
}

const args = process.argv.slice(2);
function flag(name: string): boolean {
  return args.includes(`--${name}`);
}
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
}

loadEnvFile(resolve(process.cwd(), ".env"));

const xid = required("MATRIX_XID");
const pin = required("MATRIX_PIN");
const outDir = resolve(process.cwd(), option("out", "history"));

/** `FetchLike` over the real thing. The extension's version goes via the worker. */
const httpFetch = async (url: string, init: { headers: Record<string, string>; method?: string; body?: string }) => {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
};

/**
 * The raw response, kept verbatim, for the same reason the export carries
 * `source.record`: this API is undocumented and its shape has already changed once.
 * A normalized-only download would quietly become the smaller of the two records.
 */
async function rawHistory(exerciserId: string, token: string): Promise<unknown> {
  const response = await fetch(workoutsUrl(exerciserId), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new ApiError(`History request failed (HTTP ${response.status}).`, response.status);
  return response.json();
}

function km(meters: number): string {
  return (meters / 1000).toFixed(2).padStart(6);
}
function hms(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(3)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

try {
  process.stderr.write(`Signing in as ${xid}…\n`);
  const credentials = await loginWithXid({ xid, pin }, httpFetch);

  process.stderr.write("Downloading full history…\n");
  const [raw, parsed] = await Promise.all([
    rawHistory(credentials.exerciserId, credentials.token),
    fetchWorkoutHistory(credentials, httpFetch),
  ]);

  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rawPath = resolve(outDir, `raw-history-${stamp}.json`);
  writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`);

  console.log("");
  console.log("  date        mode                      dur      km   avg HR  samples");
  console.log("  " + "─".repeat(66));
  for (const workout of parsed.workouts) {
    const hr = workout.reported.averageHeartRateBpm;
    console.log(
      `  ${workout.startedAt.toISOString().slice(0, 10)}  ${workout.mode.padEnd(22)}` +
        `${hms(workout.durationSeconds)} ${km(workout.distanceMeters)}   ` +
        `${String(hr ?? "—").padStart(5)}  ${String(workout.samples.length).padStart(7)}`,
    );
  }

  console.log("");
  console.log(`  ${parsed.workouts.length} workouts`);
  if (parsed.skipped > 0) console.log(`  ${parsed.skipped} record(s) this parser could not read`);
  if (parsed.truncated) {
    console.log("  WARNING: the API's paging says there is more history than arrived.");
  }
  console.log(`  raw response -> ${rawPath}`);

  if (flag("split")) {
    // The verbatim response already holds every record; these are the normalized
    // documents, one per ride, in the same format the extension's export button writes.
    const records = (raw as { workouts?: Record<string, unknown>[] }).workouts ?? [];
    let written = 0;
    for (const record of records) {
      try {
        const workout = toWorkout(record);
        writeFileSync(
          resolve(outDir, exportFilename(workout)),
          `${JSON.stringify(workoutExport(workout), null, 2)}\n`,
        );
        written += 1;
      } catch {
        // Already counted as `skipped` above; one bad record is not worth the run.
      }
    }
    console.log(`  ${written} export document(s) -> ${outDir}/`);
  }
  console.log("");
} catch (error) {
  // ApiError messages are written to be safe to print; anything else gets its
  // message only, never the object, which could carry the request.
  console.error(`\n  ${error instanceof Error ? error.message : "Unknown failure."}\n`);
  process.exit(1);
}
