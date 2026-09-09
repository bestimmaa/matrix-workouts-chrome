# AGENTS.md — full-matrix-workouts

A Chrome extension (Manifest V3) that replaces the stock Matrix / Johnson Fitness
workout dashboard at `matrixworkouts.jfit.co` with visualizations of **everything
the platform actually records** — not just the six summary tiles the default page
shows.

The stock workout detail page displays: distance, avg incline, avg heart rate,
calories, duration, avg speed. The underlying record additionally contains a
**per-10-second interval series** including **power (watts), console resistance
level, and cadence (rpm)** — none of which appear anywhere in the stock UI. Those
three are the reason this project exists.

---

## Required commands

Run these before committing. **`npm test` must pass.**

```
npm test            # vitest run
npm run typecheck   # tsc --noEmit
```

Both must pass before committing. The build, the extension shell and the charting
layer are **not written yet** — the visualization framework is an open decision
(see Status). `npm run dev` / `npm run build` will land with it, along with:
load the extension via `chrome://extensions` → Developer mode → *Load unpacked*
→ `dist/`; after a rebuild, reload the extension card **and** the target tab,
since content-script changes are not hot-swapped.

## Status

Built: the parse layer (`src/parse/`) and its fixtures — 43 tests green.
Not built: the extension shell (manifest, content script) and all visualization.
**The charting framework is deliberately undecided** — do not pick one without
asking. Everything in "Visualization conventions" below is binding whenever that
choice is made.

---

## Where the data actually lives

**This is the single most important thing to know about this codebase.**

The workout detail page (`/workouts/:id`) makes **no network request**. It renders
entirely from a redux-persist blob already in `localStorage`. A content script
shares the page's origin, so it can read that blob directly:

```js
const root = JSON.parse(localStorage.getItem('root'));
const userStore = JSON.parse(root.userStore);   // sub-keys are JSON *strings*
const workouts  = userStore.workouts;           // array of workout records
```

Note the double parse — `root` is a JSON object whose values are themselves JSON
strings. Keys present: `authStore`, `configStore`, `navigationStore`, `userStore`.

**Prefer localStorage over the API.** It needs no token, no network, and no
permission beyond the content script. Treat the API as the fallback for history
deeper than what the app has cached (see below).

### The HTTP API — the only route to full history

**Base host is `https://apollo.jfit.co`.** (`orion.jfit.co` also appears in the
bundle but answers 403 — do not use it.) Bearer token sits at
`userStore.exerciserProfile.token`.

```
GET  /exerciser/{id}/workouts        <- FULL history, intervals included
POST /exerciser/login
POST /exerciser/exchange_token_for_exerciser
POST /exerciser/register
POST /exerciser/validate
GET  /exerciser/{id}
```

`GET /workouts/{id}` is in the bundle but answers 404; fetch the list and filter.
The list response is `{ workouts, messages, paging }` and returns complete records
including every interval — one request gets everything.

**The cache holds only the current week.** Measured on one account: `localStorage`
had 2 workouts while the API had 43. Worse, the SPA does not fetch on demand — a
direct link to a workout outside the cached week renders "Oops! An error has
occurred." So any feature that reaches beyond the current week must go to the API.

### Two shapes for the same data

**The API returns `snake_case`; the persisted blob returns `camelCase`** — including
inside `intervals` (`average_distance` vs `averageDistance`). `camelizeWorkout()`
normalizes both into one code path; always go through it rather than reading raw
keys. The API also carries four fields the cache does not: `program_id`,
`program_level`, `workout_originator` and `integration_metadata`.

---

## Data model

### Workout record

| Field | Notes |
|---|---|
| `workoutId` | matches the `/workouts/:id` URL segment |
| `machineType` / `exerciseTitle` | `upright_bike`, `treadmill`, `rower`, … |
| `machineId` | UUID of the physical machine |
| `programType` | integer console program id (e.g. `46`) |
| `workoutTime` | ISO 8601, UTC |
| `duration` | **seconds** |
| `distance` | **meters** (the UI renders km) |
| `calories` | kcal |
| `min/max/averageHeartRate` | bpm |
| `workoutSource` | `connected` = machine-recorded |
| `intervals` | the sample array — see below |
| `wattsKg`, `functionThresholdPower`, `peakRpm`, `averageRpm`, `peakSpm`, `totalStrokes` | often `0`; several are machine-type specific |
| `totalSweatScore`, `sprintScores`, `sprint8ProgramLevel` | **Sprint 8 rides only** — see Program modes |

### Interval sample (one per 10 s)

| Field | Unit | Notes |
|---|---|---|
| `power` | watts | **not in the stock UI** |
| `resistance` | console level (1–30 observed) | **not in the stock UI** — discrete, changes in steps |
| `rpm` | cadence | **not in the stock UI** |
| `speed` | km/h | |
| `heartRate` | bpm | see dropouts below |
| `incline` | % | treadmill-relevant; `0` on a bike |
| `averageDistance` | meters | **cumulative** distance, despite the name |
| `distance` | meters | per-sample delta |
| `duration` | seconds | `10` for every sample except the last, which is a partial (0–11) |
| `totalSteps` | count | treadmill-relevant |

Sample count × 10 s ≈ `duration`. Field presence is machine-type dependent — never
assume a field is meaningful just because it is present and zero.

### Program modes (`programType`)

`programType` is the numeric console program — the workout *mode*. It is the only
mode marker, and **the web app itself never reads it**: `programType` appears exactly
once in the whole app bundle, in the schema. The app detects a Sprint 8 ride
structurally, by the presence of `sprintScores`. Do the same.

Observed across one account's 43 workouts:

| `programType` | n | Mode | Extra fields |
|---|---|---|---|
| 46 | 27 | Target heart rate — *confirmed by rider* | — |
| 18 | 7 | **Sprint 8** (HIIT) — *confirmed structurally* | `sprintScores`, `totalSweatScore`, `sprint8ProgramLevel` |
| 20 | 4 | *unidentified* | — |
| 0 | 2 | *unidentified* | — |
| 47 | 2 | *unidentified* | — |
| 38 | 1 | Ramp test — *inferred, high confidence* | — |

### Evidence behind the mapping, and the open question

The rider's activities are: target heart rate (their staple), Sprint 8, free rides
alongside Apple Fitness+, at least one ramp test, and at least one terrain video
mapping elevation to resistance. Six program ids, and they cannot all be pinned.

Measured across all 43 rides, the useful discriminator is the **mean magnitude of a
resistance change** — how far the level moves each time it moves:

| Program | rides | duration | change rate /100 | **mean step** | reading |
|---|---|---|---|---|---|
| 46 | 24 | 1–96 min | 4–67 | **1.01–1.44** | single-level nudging = a closed loop chasing a target |
| 18 | 7 | 4–20 min | 27–33 | **3.0–9.4** | big swings between sprint and recovery |
| 38 | 1 | 15 min | **0** | **0** | resistance pinned at 1, power a clean 35→280 W staircase |
| 20 | 4 | 46–60 min | 6–13 | 1.43–3.10 | infrequent changes over long rides; one ride spans levels 1–30 |
| 0 | 2 | 10, 31 min | 18–30 | 1.64–3.09 | — |
| 47 | 2 | 3, 21 min | 5–34 | 2.54–3.00 | — |

**38 is named.** One ride, and constant resistance with a stepped power ramp is a
graded exercise test in constant-power mode — it matches "at least one ramp test"
and nothing else looks like it.

**0, 20 and 47 stay `"unknown"`.** Their change rates and step sizes overlap each
other *and* overlap program 46, so the telemetry cannot separate free-riding from a
terrain video from anything else. Do not name them on vibes. Two ways to close it:
ride each program once and read the name off the console, or correlate ride dates
against Apple Fitness+ history — program 20's four long rides (46–60 min, and one
ranging to resistance 30) are the strongest terrain-video candidate, but that is a
hypothesis, not a finding.

### Prefer the derived control signature over the program id

Because the ids are only partly decoded, `controlSignature(samples)` reads how the
load was actually driven, straight from the series: `power_controlled` (resistance
flat, power moving — the ramp test), `interval_blocks` (large frequent swings —
Sprint 8), or `unclassified`. It names only what the data genuinely isolates and
exposes the raw metrics for everything else. **Drive visualization choices off this
rather than off `programType`,** so an unmapped or newly-introduced program still
renders sensibly.

**Sprint 8 is the one structural variant.** Every other program produces an
identical record shape and identical interval keys, so the parser needs no
per-program branching beyond the sprint block. `totalSweatScore` is exactly the sum
of the eight `sprintScores` — a useful invariant, and it is asserted in the tests.

**Do not generalize a program's *behaviour* across modes.** On program 46 power
tracks resistance almost perfectly (r ≈ 0.98). On program 38 resistance is pinned at
level 1 for the whole ride while power steps 35 → 280 W, so any analysis that treats
resistance as the driver of output is wrong there. Read the series, not the habit.

### Data-quality gotchas

- **Heart-rate dropouts, and they can be most of the ride.** Chest-strap glitches
  show up as implausibly low values including literal `0`, `14`, `15`, `30`. Range
  across the fixtures: 0 dropouts (08 Sep) → 40 of 314 (09 Sep) → **215 of 376** on
  the recumbent ride, where the strap died halfway and never recovered. **Filter
  before charting or averaging**, label the filter, and never assume a majority of
  samples are good.
- **Reported summaries are not derived from the intervals.** `averageHeartRate`,
  `minHeartRate` and `maxHeartRate` disagree with the series (e.g. reported min 87
  vs series min 0/86; reported max 169 vs series max 168). Compute your own from the
  samples if you need internal consistency, and say which you are showing.
- `averageDistance` is cumulative, `distance` is the delta. The names lie.
- **The final interval's `duration` is NOT always 0.** Observed: 0, 1, 2, 3, 5, 6, 7,
  8, 10 and 11. **Never compute elapsed time as `index * 10`** — accumulate each
  sample's own `duration`, which is what `toWorkout` does.
- **Resistance range is machine- and program-dependent: 1–30 observed.** Do not
  hard-code an axis maximum; take it from the data.
- Per-sample `distance` is quantized to multiples of **16.09 m = 0.01 mile** — the
  console records imperial and the API converts. This is why summed samples drift
  from the reported total.
- Cumulative distance may end slightly below the record's `distance` total.

---

## Architecture

```
src/
  content/     content script — detects the route, reads localStorage, mounts UI
  parse/       localStorage blob -> typed Workout model (pure, no DOM)
  charts/      SVG chart modules (pure: data + scale -> SVG element)
  ui/          layout, readout console, table view
  api/         optional jfit HTTP client (history backfill)
fixtures/      real captured workout records — see below
```

Decisions taken up front (revisit deliberately, don't drift):

- **TypeScript + Vite**, MV3.
- **Take over the stock detail view in place** rather than adding a side panel —
  the point is to replace the limited dashboard, not sit next to it.
- **Hand-authored SVG charts, no runtime charting library.** Full control over the
  design system, small bundle, no CSP friction. If interaction perf on long
  sessions demands it, uPlot is the sanctioned escape hatch — nothing heavier.
- **`parse/` and `charts/` stay pure and DOM-free** so they are unit-testable
  against fixtures without a browser.
- The site is a React SPA: routes change **without a page load**. The content
  script must observe navigation (history patching or a MutationObserver), not
  just run once at `document_idle`.

---

## Visualization conventions

This project exists to visualize data well, so these are binding, not stylistic
suggestions:

- **Never a dual-axis chart.** Power (0–180 W), resistance (1–9) and cadence
  (83–127 rpm) share no scale; overlaying them on two y-axes invents correlations.
  Use **small multiples on a shared x-axis** with a shared crosshair.
- **Resistance is a step line, never smoothed.** It is a discrete console setting
  that jumps; interpolating between levels misstates the data. Scale its axis from
  the data (1–30 observed), never a hard-coded 9.
- **Sprint 8 deserves its own view.** Eight discrete efforts with per-sprint scores
  is a different story from a steady-state ride; a bar per sprint beside the power
  trace says more than the trace alone.
- **Categorical palette, in fixed slot order** — power `#2a78d6`, resistance
  `#eb6834`, cadence `#1baf7a` (light) / `#3987e5`, `#d95926`, `#199e70` (dark).
  Validated colorblind-safe as a set; if you add a series, re-validate rather
  than picking a hue by eye.
- **Design both themes** via CSS custom properties: bare `:root` for light,
  `@media (prefers-color-scheme: dark)` guarded with `:root:not([data-theme="light"])`,
  and `:root[data-theme="dark"]`. Never define a color only inside a media block.
- Thin marks (2px lines), hairline **solid** gridlines, no number on every point,
  a table view always available.
- **Label a non-zero axis baseline.** Cadence is legitimately plotted from ~70 rpm
  rather than 0; say so on the panel.
- Charts are keyboard-operable and carry an accessible label.

`reference/prototype-telemetry.html` is a standalone, self-contained page that
implements every rule above against the reference fixture — small multiples,
shared crosshair, step line, both themes, table view. It is the prototype that
motivated this project. Read it before writing chart code; port from it rather
than reinventing.

---

## Privacy — non-negotiable

This handles personal health data.

- **No telemetry, no analytics, no external requests** other than to `jfit.co`
  hosts the user is already logged into.
- Never log or persist the bearer token, email, or profile fields.
- Keep `host_permissions` scoped to `matrixworkouts.jfit.co` (plus `orion`/`apollo`
  only if and when the API client is actually built). No `<all_urls>`.
- No remote code. MV3 forbids it and so do we.
- Anything written to `chrome.storage` must be user-visible and clearable.

---

## Testing

**Vitest**, unit tests against `fixtures/`. All fixtures are **real captured
records** — do not "clean" them, the mess is the point.

`fixtures/persist-root.json` is a synthetic `localStorage` blob wrapping all eight
real records in the true double-encoded shape; it is what the parser tests load.
Each `raw-<workoutId>.json` is one record, with a `.csv` of the same series beside
it for eyeballing.

| Fixture | Program | Samples | Why it is here |
|---|---|---|---|
| `6aa194a0…` | 46 target HR | 314 | 40 HR dropouts including zeros |
| `6aa04566…` | 46 target HR | 272 | the control: strap clean throughout |
| `6a95b033…` | **18 Sprint 8** | 121 | the only structural variant; sprint scores, 400 W spikes, resistance 23 |
| `6a941332…` | 0 | 61 | unidentified program |
| `6a8336b6…` | 47 | 19 | shortest ride — guards off-by-one on tiny series |
| `6a7cab8c…` | 20 | 277 | unidentified program |
| `6a6368cb…` | 46 | 376 | **recumbent** — the only non-upright ride; strap dead for 215 samples; final sample `duration: 8` |
| `6a5e4fe4…` | 38 | 89 | resistance pinned at 1 while power ramps — breaks the "power follows resistance" assumption |

Between them these cover every `programType` in the account (0, 18, 20, 38, 46, 47)
and both machine types. Add a fixture per machine type as they are captured —
treadmill and rower records populate different fields (`totalSteps`, `incline`,
`totalStrokes`, `peakSpm`) and will break assumptions built on bikes alone.

Parser tests must cover: the double JSON parse, a missing or malformed `root`, an
empty `workouts` array, unknown `machineType`, the snake_case API shape, a partial
sprint-score set, and a final sample whose duration is not 10.

---

## Conventions

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Don't commit `dist/`.
- Prefer explicit units in identifiers: `distanceMeters`, `durationSeconds`,
  `speedKmh`. The upstream field names are ambiguous and have already caused one
  bug class (`averageDistance`); do not propagate that ambiguity inward.
- Keep the parse layer tolerant: the upstream shape is undocumented and can change
  without notice. Fail to a clear message, never to a blank page over the user's
  real dashboard.
