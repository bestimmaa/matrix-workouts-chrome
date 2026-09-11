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
npm run build       # both targets -> dist/
```

`npm run build` runs **two** vite passes, because rollup takes one output format per
build and the two entry points need different ones: the content script must be a
plain IIFE (MV3 content scripts are not modules), while the service worker is
declared `"type": "module"`. The second pass sets `emptyOutDir: false` so it does
not delete the first.

All three must pass before committing.

Load the extension via `chrome://extensions` → Developer mode → *Load unpacked* →
`dist/`. After a rebuild, reload the extension card **and** the target tab —
content-script changes are not hot-swapped. `npm run dev` rebuilds on save; the
reload is still manual.

```
npm run preview                 # every fixture -> preview/<id>.html
npm run preview -- <workoutId>  # just one
THEME=light npm run preview     # force the light theme
```

`npm run preview` renders a fixture to a standalone HTML file through jsdom — the
same DOM the content script mounts, with the stylesheet inlined. Use it to iterate
on the design without loading the extension or having a workout in the cache. The
crosshair is inert there; it needs the live listeners.

## Status

Built, 95 tests green: the parse layer (`src/parse/`), the chart geometry layer
(`src/charts/`), the view (`src/ui/`), and the MV3 content script (`src/content/`).
The extension loads, puts its pill on `/workouts/:id`, and renders every fixture in
both themes once that pill is used.

Also built: the HTTP API client (`src/api/`) and the service worker that carries its
one request, so a workout outside the cached week can be fetched on demand — the
detail view offers a **Load full history** button instead of an error.

Also built: **JSON export** (`src/export/`). The view's header carries an *Export
JSON* button that writes the whole record — normalized telemetry plus the upstream
record verbatim — to a file. See "The export format" below.

Not built: anything that uses history in aggregate (trends across rides, a power
curve, sprint-to-sprint comparison). The client returns the whole list; only the one
requested workout is currently rendered from it.

**Scope: the indoor bike only.** Both bike types (upright and recumbent) are
covered by fixtures and are what this is designed and verified against. Treadmill
and rower are explicitly *not* a goal right now — do not build for them, and do not
go capturing fixtures for them. The parse layer stays machine-agnostic because that
costs nothing and the upstream shape is shared, and `src/charts/plan.ts` keeps its
speed/incline fallbacks (guarded, tested as inert on bikes) so a non-bike record
degrades into something readable rather than an exception. Neither is a promise
that those machines are supported.

**The charting framework question is settled: there isn't one.** See
"Charting: why no library" below.

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

**But not always.** Observed live on 10 Sep 2026: `root.userStore` was an already-parsed
*object*, not a JSON string. Both shapes occur, so never assume either —
`parsePersistSlice` accepts both and everything must go through it.

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

Implemented in `src/api/`. Three things about it are deliberate:

- **The request goes through the service worker, not the content script.** Content
  script `fetch` is subject to CORS as the *page's* origin regardless of
  `host_permissions`, so a call to `apollo.jfit.co` would depend on response headers
  we do not control. From the worker it runs with the extension's host permissions
  and does not. `src/content/history.ts` implements `FetchLike` over
  `chrome.runtime.sendMessage`, so `fetchWorkoutHistory` is the same code in tests
  (with a stub) and in the browser. The worker hard-allowlists the API origin: the
  url arrives from a content script, which shares a page with code we do not control.
- **Paging is not followed.** The endpoint has returned every record in one response
  on every account seen — confirmed live on 10 Sep 2026, where `paging` came back as
  `{ returned: 43, total: 43, page: 1 }`. Inventing page parameters against an undocumented API is a
  good way to silently truncate someone's history, so a `paging.total` larger than
  what arrived surfaces as `truncated` instead.
- **One bad record does not cost the user their history.** Records that fail to parse
  are counted in `skipped` and the rest are returned.

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

Two fields sit outside that table and are easy to lose: **`id`, which duplicates
`workoutId`, and `modelId`, the machine *model* (`5bcf75c1…` for both bikes seen) —
which is not `machineId`, the UUID of the individual physical unit.** They are called
out here because the first real export caught two fixtures missing both: `raw-6aa04566…`
and `raw-6aa194a0…` were the two captured by hand through the devtools console, and
hand-capture enumerates a field list and drops whatever is not on it. That is the
losslessness argument for `source.record`, demonstrated rather than asserted. Both
fixtures have since been patched from exports.

`toWorkout` keeps the record it was handed on `Workout.raw`, untouched and in
whichever of the two shapes it arrived in. That field exists for the export and for
nothing else: the upstream shape is undocumented and carries fields this model does
not name, so a normalized-only export would get quietly worse every time the
platform adds one. Do not read `raw` to dodge the normalized model — that is what
`camelizeWorkout` is for.

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
| 46 | 27 | Target heart rate — *confirmed* | — |
| 18 | 7 | **Sprint 8** (HIIT) — *confirmed* | `sprintScores`, `totalSweatScore`, `sprint8ProgramLevel` |
| 20 | 4 | **Target watts** (constant power) — *confirmed* | — |
| 38 | 1 | **Fitness test** (console VO₂ / Cooper) — *confirmed* | — |
| 0 | 2 | *unidentified* | — |
| 47 | 2 | *unidentified* | — |

### How the mapping was established

**The rider keeps a dated Notion training log**, one row per session with duration,
distance, average watts and free-text notes:
[Indoor cycling workouts](https://app.notion.com/p/5156e504e6484a8bab3580112d8b3cee).
Matching a ride's date and duration against that log identifies its mode directly.
**This is the authoritative route — use it before inferring anything from telemetry.**

- **20 = target watts.** All four rides are explicitly watt-target sessions in the
  log: "2×18 min at 145–150 W" (and "turning the watt target down" between blocks),
  "4×4 @ 200 W", "2×18 min @ 155 W", "2×20 min @ 155 W". The 2026-08-12 ride matches
  its row exactly — 46.07 min, 22.29 km, 129 W average against a fixture mean of 129.2.
- **38 = fitness test.** The one program-38 ride matches the log's "Fitness test /
  indoor bike" row exactly: 2026-07-20, 902 s, 7419 m, 147.6 W against a logged 149 W.
  The console reported a VO₂ estimate and "final stage completed: 7" — which is why
  the series shows eight power stages at a fixed resistance.
- **46 = target heart rate**, corroborated by entries naming the mode outright
  ("Relaxed Zone 2 ride in Target HR mode", "Target HR was 139").

**0 and 47 are still open.** Their rides appear in the log but no entry names a
console mode. Program 0 is plausibly manual / quick-start — that is the usual console
convention for id 0, and both rides are short unstructured efforts — but convention
is not evidence, so it stays `"unknown"`.

### A rejected heuristic — do not re-derive it

Detecting watt-target rides from the data alone looks feasible on a small sample and
**fails on the full set**. Measuring the fraction of a ride spent on a power plateau:
program 20 scores 0.50–0.76, but three of the 24 program-46 rides score 0.51–0.72.
Any threshold misclassifies them. Use `programType` for this distinction.

Measured across all 43 rides, the **mean magnitude of a resistance change** does
separate the control loops — how far the level moves each time it moves:

| Program | rides | duration | change rate /100 | **mean step** | reading |
|---|---|---|---|---|---|
| 46 | 24 | 1–96 min | 4–67 | **1.01–1.44** | single-level nudging = a closed loop chasing a target |
| 18 | 7 | 4–20 min | 27–33 | **3.0–9.4** | big swings between sprint and recovery |
| 38 | 1 | 15 min | **0** | **0** | resistance pinned at 1, power a clean 35→280 W staircase |
| 20 | 4 | 46–60 min | 6–13 | 1.43–3.10 | infrequent changes; the console holds a wattage, so resistance only moves as cadence drifts |
| 0 | 2 | 10, 31 min | 18–30 | 1.64–3.09 | — |
| 47 | 2 | 3, 21 min | 5–34 | 2.54–3.00 | — |

Note what this does and does not buy you: it cleanly isolates 46 (single-level
nudging), 18 (big swings) and 38 (no movement at all), but 0, 20 and 47 overlap each
other and overlap 46. The log, not the telemetry, is what pinned 20.

To close 0 and 47: ride each once and read the mode off the console, then add a row
to the training log so the next session can match it.

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
  show up as implausibly low values including literal `0`, `14`, `15`, `30`, and
  softer ones in the 80s and 90s during a 150 bpm ride. Counts after filtering:
  0 of 272 (08 Sep, the control) → 80 of 314 (09 Sep) → 134 of 362 (03 Sep) →
  **231 of 376** on the recumbent ride, where the strap died halfway and never
  recovered. **Filter before charting or averaging**, label the filter, and never
  assume a majority of samples are good.

  **A high rejection rate is usually the strap, not the filter.** Validated against
  an independent sensor: on the 03 Sep ride the rider's Apple Watch recorded a smooth
  trace averaging 153 bpm over 93–172, while the console's own series for the same
  hour is littered with single-sample drops to 15, 32, 47 and 49 sitting between
  neighbouring 155s and 160s. The filtered series averages 151 over 98–173 — within
  two bpm of the watch — so throwing away a third of that ride was right.

  The filter (`src/parse/heartRate.ts`) is an absolute floor plus a rate-of-change
  check, and two things about the rate check are load-bearing:

  - **The reference goes stale.** It compares against the last *accepted* sample,
    which may be minutes back, and over minutes a heart rate legitimately moves much
    further than it can in ten seconds. Rejecting a recovered sample for being far
    from a stale reference keeps the reference stale and rejects the next one too.
    That cascade threw away **58 of 61 samples** on the program-0 ride, which does not
    contain a single reading under 60 bpm. The allowance therefore widens with the gap.
  - **The widening is asymmetric, because dropouts are low-biased.** A failing strap
    reads low, never high. Widening equally in both directions admits the softer
    glitches, and the reference then anchors on an 86 and rejects the genuine 140s
    behind it — measurably worse, 83 rejections to 89 on one fixture. Rises get the
    full allowance immediately; falls get none until the gap passes a grace window.

  The constants are physiological in kind and empirical in value. `npm test` pins the
  outcome on every fixture; re-run it if you touch them.
- **Reported summaries are not derived from the intervals.** `averageHeartRate`,
  `minHeartRate` and `maxHeartRate` disagree with the series (e.g. reported min 87
  vs series min 0/86; reported max 169 vs series max 168). Compute your own from the
  samples if you need internal consistency, and say which you are showing.

  **But "not derived from" does not mean "worse".** On the 03 Sep ride the reported
  average of 153 bpm matches the rider's Apple Watch exactly, while the filtered
  series averages 151 — the console appears to have averaged in real time, before the
  dropouts that the series preserves. So on a badly glitching strap the reported
  figure can be the more accurate one. Show both rather than assuming either wins.
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
  ui/          layout, readout console, stat tiles, icons, table view
  api/         jfit HTTP client (credentials + history backfill), pure and DOM-free
  export/      the JSON a user takes elsewhere (pure: Workout -> document)
  background/  MV3 service worker: carries the one cross-origin request
fixtures/      real captured workout records — see below
```

Decisions taken up front (revisit deliberately, don't drift):

- **TypeScript + Vite**, MV3.
- **Take over the stock detail view in place** rather than adding a side panel —
  the point is to replace the limited dashboard, not sit next to it. *In place*, but
  **only when asked**: see the default-collapsed rule below.
- **Hand-authored SVG charts, no runtime charting library.** See below.
- **Zero runtime dependencies.** The whole bundle is 38 kB / 13 kB gzipped, ships
  as one IIFE, and makes no network request of any kind.
- **`parse/`, `charts/` and `export/` stay pure and DOM-free** so they are
  unit-testable against fixtures without a browser. Concretely: `charts/` emits *geometry* —
  path `d` strings, tick positions, scales — and `ui/` turns that into elements.
  Nothing under `charts/` may touch `document`.
- The site is a React SPA: routes change **without a page load**. The content
  script must observe navigation, not just run once at `document_idle` — and see
  the isolated-world trap below, because the obvious way to do that does not work.
- **Overlay in a shadow root; never edit the site's DOM.** `src/content/mount.ts`
  mounts a fixed, full-viewport host with `attachShadow({ mode: "open" })` and
  renders inside it. The site's React tree is left completely untouched, so the
  host page's CSS cannot reach our UI, ours cannot leak into theirs, and removing
  one element restores the stock page exactly. Every view carries a **Show stock
  page** button, and a parse failure renders a readable explanation — never a blank
  sheet over the user's real dashboard.
- **Collapsed is the default; the site's own dashboard is what loads.** Navigating
  to `/workouts/:id` does *not* cover the page — it mounts the surface collapsed, so
  the user sees the stock dashboard with our pill in the corner, and the extended
  view appears only when they ask for it. This was a deliberate reversal of the
  original auto-takeover: an extension that seizes a page on sight makes the stock
  summary unreachable without disabling it, and the stock page is still the only
  place some things live. Two consequences to preserve:
  - **The sheet is filled on open, not on navigation** (`openView()` in
    `src/content/main.ts`). A user who never opens it pays nothing for parsing and
    charting a ride they are not looking at.
  - **Navigation never expands.** `renderRoute` only keeps an *already open* view in
    sync with the route; otherwise it leaves the pill alone. An open view is a thing
    the user asked for, and so is a closed one.
- **The pill is the toggle, and handing the page back must be reversible.** *Show
  stock page* collapses the overlay to the pill rather than dismissing it, and the
  pill brings it back. This is not polish: the stock page renders its own "Oops! An
  error has occurred." for any workout outside the cached week, so a one-way hide
  strands the user on that error with no route back to the view that was working.
  Collapsed, the host shrinks to the pill — a full-viewport host would keep
  swallowing clicks meant for the page underneath. Leaving the workout route
  destroys the surface outright; the pill must never float over a page this
  extension does not handle. The pill's click goes through `SurfaceOptions.onOpen`
  rather than calling `expand()` itself, because opening now means rendering first.
- **The toolbar icon is the same toggle, from anywhere.** The pill only exists on
  the detail route; the icon works across the site and is where a user looks for an
  extension's UI. `chrome.action` fires in the service worker, which relays a
  `toggleSurface` message to the content script. Off the detail route it explains
  itself rather than doing nothing. Note Chrome hides unpinned extensions behind the
  puzzle-piece menu — the icon has to be pinned to be the discoverable thing it is
  meant to be.
- **No webfonts of our own — but we name the site's.** The prototype pulls Barlow
  and IBM Plex Mono from Google Fonts; the extension makes no external request, so
  `src/ui/styles.css` contains no `@font-face` and no `@import`, and it never will.
  What it *does* do is name `Industry` — the face the page itself loads from Typekit
  — at the head of its stack. `@font-face` registrations are document-scoped and
  reach into a shadow root, so on the site we inherit the real thing for free, and
  anywhere else (the jsdom preview) the stack falls through to the same
  `Rajdhani, "Helvetica Neue", Arial` the app itself declares. Naming a family costs
  no request; fetching one is what the rule forbids.

---

## Wearing the platform's clothes

The extended view is dressed as the site's own workout detail page, and the point of
that is not flattery. This thing replaces a page the user already knows; if it
arrives in a different visual language, every glance costs them a re-orientation
they did not ask for, and the *contents* — which is the whole argument for the
project — start reading as somebody else's numbers rather than as more of their own.

**The tokens were read out of the site, not matched by eye.** The app carries its
whole theme as one object in `assets/index-*.js`; the values in `src/ui/styles.css`
are copied from it, and the app's own names are kept in the comments there so the
mapping can be re-checked after an upstream change:

| What | Value | The app's name for it |
|---|---|---|
| Primary / focus | `#e1261c`, hover `#870000` | `red`, `hover` |
| Cardio accent — band, 6px card rule | `#ffa400` | `yellowCardio` |
| Header bar | `#000000`, ink `#e6e6e6` | `backgroundsecondary`, `headertextsecondary` |
| Detail plane | `#f5f5f5` | `workoutdetailbackground` |
| Plot ground | `linear-gradient(135.28deg, #282828, #333333)` | the graph container |
| Plot ink / gridlines | `#afb4b8` / white at `0.1` | `gray300`, its nivo theme |
| Greys | `#dde0e2 #afb4b8 #999999 #666666 #4c4c4c #333333 #191919 #2d2d2d` | `gray200`…`gray1000` |
| Faces | `Industry, Rajdhani, 'Helvetica Neue', Arial` / `Arial` | `fontfamilyprimary` / `fontfamilysecondary` |
| Weights | 400 / 600 / 700 / 800 | `book` / `demi` / `bold` / `black` |

The shapes that carry the resemblance, in rough order of how much work each does:

- **Square corners, everywhere.** The app sets `border-radius: 0` on everything it
  styles itself. Rounded cards and a pill launcher were the loudest thing marking
  the old view as foreign; nothing here has a radius now, the launcher included.
- **Bar, band, plane.** A black 44px header with a `◀` back control on the left and
  the date centred; a full-width sticky cardio band as the h1; then the content on
  the light plane. Both bars are sticky, which is why the readout console's
  `top: 100px` is 44 + 56 and not a guess.
- **The workout card**: white, `border-left: 6px solid` the cardio accent. The stat
  tiles, the sprint panel and the table all wear it.
- **The metric tile**: label in Arial at 13px grey, then a 21px icon, the value at
  21px bold, and the unit shrunk to 12px uppercase grey beside it — the site's own
  `metricValue` / `metricUnits` / `metricLabel`, including reading a duration as
  `45 m 10 s` rather than `45:10`.
- **The sprint bar**: a fixed 140px track filled from the bottom, which is exactly
  how the stock page draws it. *Its* fill starts at zero and ours does not — see the
  Sprint 8 rule under Visualization conventions; the form is theirs, the statistics
  are ours.

Three places we deliberately do not follow it, all of them noted in the code:

1. **The series palette.** See the palette rule above.
2. **Band contrast.** The site sets that title in `#e6e6e6` on `#ffa400` — 2.1:1,
   under the 3:1 that even large bold text needs. It is our h1, so it is set in the
   app's own near-black instead, which is what the app puts on its amber-ruled cards
   anyway.
3. **Live numerals stay monospaced.** The readout console and the table keep the
   mono stack, because every value in that row is rewritten on each pointer move
   while scrubbing and proportional digits make the whole row jitter as they change
   width. The static tiles, which never change, use the site's own face.

**`src/ui/icons.ts` exists because the site puts a glyph in front of every metric
value.** Hand-authored on a 24-unit grid, stroked in `currentColor`, `aria-hidden`
— the extension ships no assets and makes no request, so an icon font or a sprite
sheet was never available; and every glyph sits beside a text label that already
says the same thing.

**A restyle may not drop a figure.** Rebuilding the top bar quietly lost the workout
id — it had been sitting in an eyebrow nobody thought of as data. It now lives in
the footer's provenance line, where a narrow viewport cannot collapse it away, and
`dashboard.test.ts` asserts every summary figure is still on the page. Add to that
assertion rather than trusting a careful eye.

---

## The export format

The platform offers no export of any kind. The record is otherwise reachable only by
reading `localStorage` by hand in the devtools console — which is exactly how this
repo's fixtures were captured, one field at a time, and the reason an export was on
the TODO list before it was a feature.

`src/export/document.ts` builds the file; `src/ui/download.ts` hands it to the
browser. The builder is pure and DOM-free for the same reason `parse/` and `charts/`
are: what leaves this extension is worth asserting against every fixture, and a test
should not need a browser to do it.

```
{
  format: "full-matrix-workouts/workout",
  formatVersion: 1,
  exportedAt: <ISO 8601 UTC>,
  workout: {
    ...the normalized model, units in the names,
    derived: { heartRate: {...stats, filter}, control: <controlSignature> },
    samples: [ ...Sample, heartRateValid ]
  },
  source: { shape: "camelCase" | "snake_case", record: <the upstream record, verbatim> }
}
```

Four decisions in it, none of them arbitrary:

- **`source.record` carries every field of the upstream record, unaltered**, which is
  what makes the export lossless. The upstream shape is undocumented and can change
  without notice; an export of only the normalized model would silently become the
  smaller of the two records the first time the platform adds a field. It also means
  **capturing a fixture is now one click and one command**:

  ```
  jq '.source.record' matrix-workout-2026-09-03-<id>.json > fixtures/raw-<id>.json
  ```

  Unaltered includes the key style, so an API-shaped record comes back out
  `snake_case` — which is what `raw-6a998daf…` is and what a test asserts it stays.

  **It is not byte-for-byte, and do not claim that it is.** The record goes through
  `JSON.stringify` on the way out, which normalizes number *formatting* — a `28.0`
  on the wire comes back as `28` — and does not promise the key order the server
  sent. Both are the same JSON to every parser, so nothing downstream can tell; it
  matters only if you are diffing an export against a fixture, where it shows up as
  noise that is not a difference in the data. When patching an existing fixture,
  splice in what is missing rather than rewriting the file from an export.
- **Dropouts are flagged, not scrubbed.** Every sample carries `heartRateValid`, and
  `heartRateBpm` still holds whatever the console recorded. Filtering is the
  consumer's decision, and an export that hid the bad readings would be a worse
  account of the ride than the record it came from. `derived.heartRate.filter`
  states in the file itself what the flag means — the same "label the filter" rule
  the charts follow.
- **Both heart-rate summaries travel.** `reported` is the platform's and `derived` is
  ours, side by side, because they disagree and on a badly glitching strap the
  platform's is the better of the two. Picking one for the reader is not this file's
  job.
- **`programType` rides along with `mode`.** The raw console id is always present
  even where we have no name for it; `mode` is `"unknown"` rather than a guess.

`formatVersion` is for breaking changes only — adding an optional field does not
need one.

The filename is `matrix-workout-<YYYY-MM-DD>-<workoutId>.json`, dated from
`workoutTime` in **UTC** rather than a localized rendering, so two machines exporting
the same ride agree on the name.

**The download needs no new permission and that is deliberate.** It is a blob URL on
a detached `<a download>` — never inserted, so the site's DOM stays untouched.
`chrome.downloads` would mean adding `"downloads"` to a manifest whose permission
list is deliberately the shortest it can be. Chrome may show its own "allow multiple
downloads" prompt for the origin; that is the browser asking the user, which is the
right place for the question. The button confirms for itself on success, because
Chrome's download bubble can be dismissed or off-screen and a click that produces
nothing visible reads as broken.

---

## Charting: why no library

Decided after measuring, not by taste. **Do not add a charting library without a
reason that survives all four of these.**

- **Size is not the problem.** The largest fixture is 376 samples; a 96-minute ride
  is ~576. Four panels is four `<path>` elements. Nothing here needs canvas, WebGL,
  decimation or virtualization.
- **Theming.** Colours are CSS custom properties resolved by the browser in both
  themes. Every canvas library (Chart.js, uPlot, ECharts) resolves colour in JS and
  needs a full redraw on a theme flip.
- **The conventions below are the opposite of most libraries' defaults** — libraries
  make dual-axis easy and cross-chart cursor sync hard, default to smoothed curves,
  and impose their own axis "nicing".
- **Accessibility and testability.** SVG is real DOM: focusable, labelable,
  inspectable, and assertable in jsdom. Canvas is a black box.
- **MV3.** Vega/Vega-Lite's expression parser wants `Function()`. React-based chart
  kits (Recharts, Victory, Nivo) would ship a second React into a page that already
  has one.

`src/charts/scale.ts` and `src/charts/series.ts` are the ~150 lines this replaces:
a linear scale, a 1/2/5 tick algorithm, and line/step/area path builders.
`d3-scale` + `d3-shape` (pure, tree-shakeable, ~16 kB) are the sanctioned swap if
that maths ever gets fiddly — but *only* those two. `d3-selection`, `d3-axis` and
`d3-brush` are DOM-coupled and would break the purity rule above. **uPlot remains
the escape hatch**, and the trigger for it is not a long ride: it is a full-history
view (43 workouts x ~400 samples) with live zoom.

## The isolated-world trap — read before touching route detection

**Patching `history.pushState` from a content script does not work.** Content
scripts run in an isolated world with their own wrappers, so a patch applied there
never sees the page's own calls. This contradicts the usual advice and cost real
time to discover; `src/content/route.ts` therefore polls `location.href` (300 ms)
and listens for `popstate`/`hashchange`, using the Navigation API opportunistically
where it exists. The poll is the backstop, not the optimisation — a missed
navigation leaves a stale workout on screen over a different one.

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
  trace says more than the trace alone. **Those bars need a non-zero baseline** —
  scores cluster tightly (1060–1180 on the reference ride), so from zero all eight
  are the same height and the only thing worth seeing, whether the rider faded, is
  invisible. The floor is stated on the panel, as the rule below requires.
- **Lead with the variable the console was holding.** A target-watts ride should put
  power front and centre with the target blocks marked; a target-HR ride should lead
  with heart rate against its target; a fitness test should show the stage staircase.
  Same telemetry, different headline. Implemented in `src/charts/plan.ts`, which
  orders panels off `controlSignature` first and `programType` second, and prints
  the reason it chose in the page's lede so the ordering is never magic.
- **Categorical palette, in fixed slot order** — power `#3987e5`, resistance
  `#d95926`, cadence `#199e70`, heart rate `#d68cb5`. Validated colorblind-safe as a
  set; if you add a series, re-validate rather than picking a hue by eye. Slot 4 is
  Okabe-Ito reddish purple — the first three already sit in that family, so the
  fourth was taken from it rather than eyeballed.

  **One set, not one per theme.** Every mark this project draws sits inside
  `.telemetry`, which wears the site's own graph ground
  (`linear-gradient(135.28deg, #282828, #333333)`) in *both* themes, exactly as the
  stock detail page does. There is no light ground to design a second set against,
  so the lighter light-theme variants this project used to carry
  (`#2a78d6`/`#eb6834`/`#1baf7a`/`#cc79a7`) are gone rather than left as dead
  tokens. If a chart ever lands on the light plane, that pairs with bringing them
  back — do both or neither.

  **The platform's own channel colours were not adopted**, and this is the one place
  the restyle stops. It paints distance `#ff8500`, speed `#3f9c47`, resistance
  `#6b9ccd`, incline `#6ac59f` and heart rate `#db3547` — a green/red pair on the
  same axis, plus two greens. The chrome is theirs; the data is ours.
- **Slots belong to channels, not positions**, so power is blue in every workout
  regardless of which panel leads. Speed and incline reuse slots 1 and 2 because
  they are stand-ins that only appear when the machine reports no power / no
  resistance; a test asserts no workout ever renders two panels in one slot.
- **Do not plot speed beside power on a bike.** The console derives it from power
  and cadence, so it is a third view of the same thing — and it would have to
  borrow power's slot to say it. `src/charts/plan.ts` drops it.
- **Design both themes** via CSS custom properties: bare `:root` for light,
  `@media (prefers-color-scheme: dark)` guarded with `:root:not([data-theme="light"])`,
  and `:root[data-theme="dark"]`. Never define a color only inside a media block.
  The brand chrome — black bar, cardio band, plot ground, brand red — is *not*
  themed: it is the same in both, as it is on the stock page. Only the plane,
  surfaces, ink and rules flip.
- Thin marks (2px lines), hairline **solid** gridlines, no number on every point,
  a table view always available.
- **Label a non-zero axis baseline.** Cadence is legitimately plotted from ~70 rpm
  rather than 0; say so on the panel.
- Charts are keyboard-operable and carry an accessible label.

`reference/prototype-telemetry.html` is the standalone page that motivated this
project. It has now been **ported** into `src/charts/` + `src/ui/` — layout
constants, caption structure, crosshair behaviour and table view all come from it.
Keep it as the reference for *what a panel is*; it is frozen, so when the two
disagree, the code is what ships. It is no longer the reference for how the page
looks: the chrome, the type and the colour now come from the platform itself — see
"Wearing the platform's clothes".

---

## Privacy — non-negotiable

This handles personal health data.

- **No telemetry, no analytics, no external requests** other than to `jfit.co`
  hosts the user is already logged into.
- Never log or persist the bearer token, email, or profile fields. `redact()` in
  `src/api/credentials.ts` exists because a transport error's message can contain the
  request; every error that escapes the client passes through it, and a test asserts
  the token cannot appear in a thrown message. **No fixture in this repo carries a
  real token, and none ever should.**
- Fetched history lives in a module variable for the life of the tab and is never
  written to `chrome.storage`. It is health data and it is one request away.
- `host_permissions` is exactly `https://apollo.jfit.co/*` — nothing else, and no
  `<all_urls>`. The toolbar action uses **`activeTab`**, not a host permission for
  the site: it grants access only to the tab the user just clicked, only while they
  are on it. Do not trade it for a broader grant to save a line of code. The content script reaches `matrixworkouts.jfit.co` through its
  `matches` pattern, which needs no host permission. `orion.jfit.co` answers 403 and
  must not be added.
- No remote code. MV3 forbids it and so do we.
- Anything written to `chrome.storage` must be user-visible and clearable.
- **The JSON export is a local download and must stay one.** No upload, no service,
  no "share" anything. The button's tooltip says so before it is pressed, and a
  failure path must never report an error string that could quote the record it was
  writing — that string is the user's heart rate.

---

## Testing

**Vitest**, unit tests against `fixtures/`. All fixtures are **real captured
records** — do not "clean" them, the mess is the point.

`fixtures/persist-root.json` is a synthetic `localStorage` blob wrapping eight of the
real records in the true double-encoded shape; it is what the parser tests load.
Each `raw-<workoutId>.json` is one record, with a `.csv` of the same series beside
it for eyeballing.

**`raw-6a998daf…` is the odd one out, deliberately.** Every other fixture is the
camelCase localStorage shape; this one was captured from `apollo.jfit.co` and is the
API's own snake_case, which makes it the only honest test input for `src/api/`
(the alternative — converting a camelCase fixture in the test — tests the converter,
not the client). It is therefore **not** in `persist-root.json`, and a test asserts it
stays snake_case so nobody "normalizes" it away.

It also carries the project's only independent ground truth: the rider wore an Apple
Watch for that hour, which recorded a smooth trace averaging **153 bpm over 93–172**.
Use it when changing anything about heart-rate filtering.

| Fixture | Program | Samples | Why it is here |
|---|---|---|---|
| `6aa194a0…` | 46 target HR | 314 | 80 HR dropouts including zeros |
| `6aa04566…` | 46 target HR | 272 | the control: strap clean throughout |
| `6a95b033…` | **18 Sprint 8** | 121 | the only structural variant; sprint scores, 400 W spikes, resistance 23 |
| `6a941332…` | 0 | 61 | unidentified program |
| `6a8336b6…` | 47 | 19 | shortest ride — guards off-by-one on tiny series |
| `6a7cab8c…` | 20 target watts | 277 | the confirmed watt-target ride |
| `6a6368cb…` | 46 | 376 | **recumbent** — the only non-upright ride; strap dead for 215 samples; final sample `duration: 8` |
| `6a5e4fe4…` | 38 | 89 | resistance pinned at 1 while power ramps — breaks the "power follows resistance" assumption |
| `6a998daf…` | 20 target watts | 362 | **snake_case, captured from the API**; strap glitching badly, and the only ride with independent ground truth |

Between them these cover every `programType` in the account (0, 18, 20, 38, 46, 47)
and both bike types.

Treadmill and rower fixtures are deliberately **not** being collected — see Scope
above. If that changes, note that those records populate different fields
(`totalSteps`, `incline`, `totalStrokes`, `peakSpm`) and will break assumptions
built on bikes alone; the machine-type branches in `src/charts/plan.ts` are
reasoned from the field list, never verified against a real record.

Parser tests must cover: the double JSON parse, a missing or malformed `root`, an
empty `workouts` array, unknown `machineType`, the snake_case API shape, a partial
sprint-score set, and a final sample whose duration is not 10.

Chart tests (`src/charts/charts.test.ts`) run the geometry against every fixture and
assert the conventions directly: no `NaN` in any emitted path, one palette slot per
panel, a step path for resistance and a line path for power, every non-zero baseline
labelled, and dropouts nulled rather than zeroed. **Add the assertion when you add
the rule** — a convention nothing checks is a convention that drifts.

Export tests (`src/export/export.test.ts`) run the document builder against every
fixture and assert the format's promises directly: power, resistance and cadence on
every sample of every ride; sample times taken from the parse layer rather than
recomputed as `index * 10`; dropouts flagged without the console's reading being
erased; both heart-rate summaries present; and `source.record` equal to the fixture
it came from, in the shape it came in. Add the assertion when you add the rule.

View tests (`src/ui/dashboard.test.ts`) run under `// @vitest-environment jsdom` and
cover the DOM: accessible labels, arrow-key scrubbing, the dropout readout, the
sprint bars, the table row count. Note that jsdom rebases `import.meta.url` onto the
document URL, so fixtures there must be resolved from `process.cwd()`.

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
