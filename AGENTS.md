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
npm run dev         # Vite watch build into dist/, load unpacked from there
npm run build       # production build into dist/
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
```

Load the extension: `chrome://extensions` → Developer mode → *Load unpacked* →
select `dist/`. After a `npm run dev` rebuild, hit reload on the extension card
and then reload the target tab — content-script changes are not hot-swapped.

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

### The HTTP API (fallback only)

Hosts `https://orion.jfit.co` and `https://apollo.jfit.co`. Routes observed in the
app bundle:

```
POST /exerciser/login
GET  /exerciser/{id}/workouts        <- deeper history than the cache holds
GET  /workouts/{id}
POST /exerciser/exchange_token_for_exerciser
POST /exerciser/register
POST /exerciser/validate
GET  /exerciser/{id}
```

Bearer token sits at `userStore.exerciserProfile.token`. `userStore.workoutTimeFrame`
is the app's own history filter and is often empty, which is why the local cache may
hold only the last day or two.

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

### Interval sample (one per 10 s)

| Field | Unit | Notes |
|---|---|---|
| `power` | watts | **not in the stock UI** |
| `resistance` | console level (1–9 on the bike) | **not in the stock UI** — discrete, changes in steps |
| `rpm` | cadence | **not in the stock UI** |
| `speed` | km/h | |
| `heartRate` | bpm | see dropouts below |
| `incline` | % | treadmill-relevant; `0` on a bike |
| `averageDistance` | meters | **cumulative** distance, despite the name |
| `distance` | meters | per-sample delta |
| `duration` | seconds | `10` for every sample except the last, which is `0` |
| `totalSteps` | count | treadmill-relevant |

Sample count × 10 s ≈ `duration`. Field presence is machine-type dependent — never
assume a field is meaningful just because it is present and zero.

### Data-quality gotchas

- **Heart-rate dropouts.** Chest-strap glitches show up as implausibly low values,
  including literal `0`, `14`, `15`, `30`. In the reference fixture 40 of 314
  samples read below 80 bpm. **Filter before charting or averaging**, and label
  the filter. Note the platform's own `averageHeartRate` (142) does not match a
  naive filtered mean (~134) — do not assume you can reproduce their summary.
- `averageDistance` is cumulative, `distance` is the delta. The names lie.
- The last interval has `duration: 0`.
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
  that jumps; interpolating between levels misstates the data.
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

- **Vitest**, unit tests against `fixtures/`.
- `fixtures/upright_bike-2026-09-09.json` is a **real captured record**: 314
  intervals, a 52:16 upright-bike session, with the HR dropouts intact. It is the
  primary parser and chart fixture — do not "clean" it, the mess is the point.
  The `.csv` alongside it is the same session flattened, for eyeballing.
- Add a fixture per machine type as they are captured. Treadmill and rower records
  populate different fields and will break assumptions built on the bike alone.
- Parser tests must cover: the double JSON parse, a missing or malformed `root`, an
  empty `workouts` array, and unknown `machineType`.

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
