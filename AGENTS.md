# AGENTS.md — matrix-workouts-chrome

A Chrome extension (Manifest V3) that replaces the stock Matrix / Johnson Fitness
workout dashboard at `matrixworkouts.jfit.co` with visualizations of **everything
the platform actually records** — not just the six summary tiles the default page
shows.

The stock workout detail page displays: distance, avg incline, avg heart rate,
calories, duration, avg speed. The underlying record additionally contains a
**per-10-second interval series** including **power (watts), console resistance
level, and cadence (rpm)** — none of which appear anywhere in the stock UI. Those
three are the reason this project exists.

That paragraph is the argument. README.md makes it to a person; this file is for
whoever has to work on the thing.

**The parser, API client and export format are not here.** They are
[`matrix-workouts-core`](https://github.com/bestimmaa/matrix-workouts-core), a package
this extension depends on and shares with an MCP server. Anything about the record
shape, the upstream API, program modes, heart-rate filtering or the export document
belongs in that repo's AGENTS.md and MATRIX_API.md — not here. This file covers the
extension: the view, the chart geometry, and everything about living inside someone
else's page.

---

## What belongs in this file

Four documents, one job each. Putting something in the wrong one is how it rots.

| File | Holds |
|---|---|
| `README.md` | what this is, why, and how to run it. For someone arriving cold. |
| `AGENTS.md` | how to work on it — decisions, rules, and gotchas that already cost a bug. |
| `TODO.md` | deferred work, with enough context to pick up cold. |
| `CHANGELOG.md` | what changed, per tagged version. |
| [core's `MATRIX_API.md`](https://github.com/bestimmaa/matrix-workouts-core/blob/main/MATRIX_API.md) | the upstream API: endpoints, wire shapes, units, what is verified. Another repo owns it. |

**Write it here if it is:**

- a **decision** and the reason behind it — especially one whose reason is not
  visible in the code ("no charting library, and here is what would change that")
- a **rule** stated with the failure it prevents ("never read `raw` to dodge the
  normalized model")
- a **gotcha someone already hit** — the two-ids bug, the isolated-world trap. The
  bug is the evidence; keep it.
- a **measurement**, dated, where it is evidence for a claim ("localStorage had 2
  workouts while the API had 43, 10 Sep 2026")
- a **boundary** — what this project is not for, and what not to build

**Do not write it here if it is:**

- **something the code already says.** Type definitions, signatures, file listings.
  Anything true only until the next refactor belongs next to the code, where it gets
  refactored too.
- **the upstream wire shape, or anything about parsing it.** Field names, key styles,
  units, program modes, the two-ids bug, the export format → the core repo. Crossing
  that boundary with a note is how two repos start disagreeing.
- **a task.** → TODO.md. A *decision* about a task still belongs here.
- **onboarding.** How to install, load and run → README.md.
- **a log.** No changelogs, session notes, dated progress, ticket trails or "as of
  this commit". Git holds that, and it holds it better.
- **a number that will quietly go stale.** Exact counts drift. Either date it as a
  measurement, or write the shape of the claim instead ("every ride on the account",
  not "43 workouts").

**Say it once.** A fact in two files is one fact and one future lie. Cross-link
instead — and when the two disagree, the file that owns the subject wins.

**Keep the argument, cut the recital.** This file is long because the reasoning is
load-bearing. It is not a place to be exhaustive for its own sake: if a section does
not change what someone would *do*, it does not need to be here.

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

To work on the core and the extension together, `npm link` the sibling checkout —
`npm link` in `matrix-workouts-core`, then `npm link matrix-workouts-core` here — and
`npm install matrix-workouts-core` to go back to the published copy. Note **`npm
unlink` is an alias for `npm uninstall`**: it strips the dependency out of
`package.json` rather than just dropping the symlink, and the next install then
quietly omits the one package that matters.

Load the extension via `chrome://extensions` → Developer mode → *Load unpacked* →
`dist/`. After a rebuild, reload the extension card **and** the target tab —
content-script changes are not hot-swapped. `npm run dev` rebuilds on save; the
reload is still manual.

```
npm run preview                 # every fixture -> preview/<id>.html
npm run preview -- <workoutId>  # just one
THEME=light npm run preview     # force the light theme
```

Downloading a whole history now lives in the core package — `npx matrix-workouts-history`,
which is where the passcode is handled and where `.env` is read. Nothing in this repo
does that any more.

`npm run preview` renders a fixture to a standalone HTML file through jsdom — the
same DOM the content script mounts, with the stylesheet inlined. Use it to iterate
on the design without loading the extension or having a workout in the cache. The
crosshair is inert there; it needs the live listeners.

## Status

Built, the suite green: the chart geometry layer (`src/charts/`), the view
(`src/ui/`), and the MV3 content script (`src/content/`). The extension loads, puts
its pill on `/workouts/:id`, and renders every fixture in both themes once that pill
is used.

Also built: the service worker that carries the one cross-origin request, so a
workout outside the cached week can be fetched on demand — the detail view offers a
**Load full history** button instead of an error. The client itself is
`matrix-workouts-core`; `src/content/history.ts` implements its `FetchLike` over
`chrome.runtime.sendMessage`.

Also built: **JSON export**. The view's header carries an *Export JSON* button that
writes the whole record — normalized telemetry plus the upstream record verbatim — to
a file. The document builder is in the core package; this repo only hands the result
to the browser (`src/ui/download.ts`).

Not built: anything that uses history in aggregate (trends across rides, a power
curve, sprint-to-sprint comparison). The client returns the whole list; only the one
requested workout is currently rendered from it. `npx matrix-workouts-history` puts
that whole list on disk, and the MCP server is where cross-ride analysis is going
first — see TODO.md.

**Scope: the indoor bike only, and this is now enforced rather than merely
intended.** Both bike types (upright and recumbent) are covered by fixtures and are
what this is designed and verified against. Treadmill and rower are explicitly *not*
a goal right now — do not build for them, and do not go capturing fixtures for them.
`isSupportedMachine` in the core package holds the list and `src/content/main.ts`
acts on it: a
treadmill or rower ride gets no pill and no takeover, and the toolbar icon explains
itself there instead of drawing panels about channels the machine may not report.
See "Deciding what to take over" below. The parse layer stays machine-agnostic
because that costs nothing and the upstream shape is shared, and `src/charts/plan.ts`
keeps its
speed/incline fallbacks (guarded, tested as inert on bikes) so a non-bike record
degrades into something readable rather than an exception. Neither is a promise
that those machines are supported.

**The charting framework question is settled: there isn't one.** See
"Charting: why no library" below.

---

## Architecture

Three layers. Which layer a directory belongs to decides what it may touch, and
`src/layers.test.ts` enforces it — see below.

```
matrix-workouts-core       the package underneath all of it: parse, api, export
src/
  charts — no platform underneath it at all
    charts/      chart geometry (data + scale -> path strings, ticks)
  view — DOM, and nothing more
    ui/          layout, readout console, stat tiles, icons, table view
  extension — DOM + chrome.* + the network
    content/     content script — detects the route, reads localStorage, mounts UI
    background/  MV3 service worker: carries the one cross-origin request
scripts/       dev tooling, not shipped and not a layer (see `npm run preview`)
fixtures/      real captured workout records — see below
```

Decisions taken up front (revisit deliberately, don't drift):

- **TypeScript + Vite**, MV3.
- **Take over the stock detail view in place** rather than adding a side panel —
  the point is to replace the limited dashboard, not sit next to it. *In place*, but
  **only when asked**: see the default-collapsed rule below.
- **Hand-authored SVG charts, no runtime charting library.** See below.
- **One dependency, and it is ours.** `matrix-workouts-core` has no dependencies of
  its own, so the bundle is still one IIFE that makes no network request of any kind.
  `src/layers.test.ts` holds an allowlist rather than a yes/no, so a second package
  cannot arrive without someone deciding it should.
- **The core stays pure and platform-free** so it is unit-testable against fixtures
  without a browser — and so anything else can consume it, which is now literally
  true. Concretely: `charts/` emits *geometry* — path `d` strings, tick positions,
  scales — and `ui/` turns that into elements. Nothing in `charts/` may name
  `document`, `chrome`, `fetch` or a `node:` module. This is a **test, not a
  convention**: see "The layering" below.
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


### The layering, and why part of it left

The three layers above are a real boundary, and `src/layers.test.ts` fails the build
on a crossing: a platform global a layer is not allowed to name, an import that points
the wrong way up the stack, a package import that is not on the allowlist, or a new
directory under `src/` that no layer claims.

**This file used to argue against splitting the core into a package**, and the
argument was right for as long as its own conditions held. It named them:

> a second JavaScript consumer appears that cannot live in this repo; there is an
> actual reason to publish to npm.

Both arrived together in Sep 2026 — an MCP server, in its own repo, published so
agents can `npx` it — so `parse/`, `api/` and `export/` are now
[`matrix-workouts-core`](https://github.com/bestimmaa/matrix-workouts-core). The
decision was not overturned; its stated trigger fired. What the old argument feared
has not happened and must not: there is still **one** manifest here, **one**
dependency, and no workspace.

The awkward part the old note predicted turned out to be the easy part.
`scripts/preview.ts` renders the real dashboard under jsdom, so `ui/` could never
join the shared package — and it did not need to. The cut ran below `charts/`
instead, which is exactly where the platform boundary already was.

**Two rules survive the move and are what the test now defends:**

- `charts/` stands on nothing. A chart reaching for `document` is untestable against
  fixtures without a browser, which is the only reason the chart tests are quick.
- `mayDependOn` is an allowlist. One package, deliberately chosen, shared with the
  MCP server. The IIFE bundle and the no-network promise in README depend on that
  list staying at one entry.

**A consumer that is not JavaScript does not want a package anyway.** A phone app
writing rides into HealthKit cannot import any of this. What it consumes is the export
document, so *that* is the interface it depends on, and it is pinned by a contract
test in the core repo.

**`scripts/` is not a layer and never was.** `scripts/preview.ts` is a development aid
that renders fixtures to HTML, and it is the one thing allowed to reach into `ui/` —
which it does, on purpose, and which is exactly why it lives outside `src/`.

---

## Deciding what to take over

The project's scope has always been the indoor bike. Until this was written, that was
a statement about what the code had been *tested* against, not about what it would
*render* — a treadmill ride would have got a dashboard leading with power, resistance
and cadence, three channels that machine may not report at all.

`isSupportedMachine` in the core package is the whole rule, and there are three
decisions inside it worth keeping:

- **Both bike types, not just the upright one.** The obvious narrowing is wrong: this
  account contains a recumbent ride (24 Jul, `raw-6a6368cb…`), it is a committed
  fixture, and it renders correctly. A test asserts every fixture in the repo stays
  in scope, so narrowing the list fails the suite with the reason attached.
- **`"unknown"` passes.** That is `toWorkout`'s own sentinel for a record carrying no
  `machineType` at all, which is *not knowing* rather than knowing it is out of
  scope. The parse layer's standing rule is tolerance of an undocumented upstream
  shape, and a record missing one field still has a full interval series worth
  drawing.
- **`null` from `cachedMachineType` is "cannot tell", and never grounds for hiding.**
  The cache holds about a week; most of the history is outside it. Removing the pill
  because a ride is old would strand the user on the stock page's own error for
  exactly the rides this extension exists to rescue. So the pill stays whenever the
  type is unreadable, and the check runs again in `renderWorkout` once the record is
  actually in hand — which is also where a ride fetched from the API gets caught.

`cachedMachineType` deliberately does not go through `toWorkout`: it reads one key off
the raw record rather than mapping every interval into a `Sample`. The expensive half
of parsing stays where the design put it — on open, not on navigation.

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
view (every ride on the account x ~400 samples) with live zoom.

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
  the core package exists because a transport error's message can contain the
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

`fixtures/persist-root.json` is a synthetic `localStorage` blob wrapping ten of the
real records in the true double-encoded shape. Each `raw-<workoutId>.json` is one
record, with a `.csv` of the same series beside it for eyeballing.

**The canonical set lives in the core repo**, where the parser they exist to test now
lives. This copy is the one the chart and view tests run against. They are immutable
captures, so two copies do not drift — but new captures land in
[matrix-workouts-core](https://github.com/bestimmaa/matrix-workouts-core) first, and
get copied here only when a view test needs one.

**`raw-6a998daf…` is the odd one out, deliberately.** Every other fixture is the
camelCase localStorage shape; this one was captured from `apollo.jfit.co` and is the
API's own snake_case, which makes it the only honest test input for the API client
(the alternative — converting a camelCase fixture in the test — tests the converter,
not the client). It is therefore **not** in `persist-root.json`, and a test in the
core repo asserts it stays snake_case so nobody "normalizes" it away.

It also carries the project's only independent ground truth: the rider wore an Apple
Watch for that hour, which recorded a smooth trace averaging **153 bpm over 93–172**.
Use it when changing anything about heart-rate filtering.

| Fixture | Program | Samples | Why it is here |
|---|---|---|---|
| `6aa194a0…` | 46 target HR | 314 | 80 HR dropouts including zeros |
| `6aa04566…` | 46 target HR | 272 | the control: strap clean throughout |
| `6a95b033…` | **18 Sprint 8** | 121 | the only structural variant; sprint scores, 400 W spikes, resistance 23 |
| `6aa2d8a8…` | **18 Sprint 8** | 121 | **the post-change shape**: `sprintScores` and `totalSweatScore`, but *neither* level field. The only fixture exercising `sprint8ProgramLevel ?? programLevel` with both absent — which is now the only case that occurs |
| `6a941332…` | 0 | 61 | unidentified program |
| `6a8336b6…` | **47 Virtual Active** | 19 | shortest ride — guards off-by-one on tiny series |
| `6aa67d33…` | **47 Virtual Active** | 241 | the ride that *named* program 47. 40 min of terrain-driven resistance — long plateaus, 22 changes, mean step 1.73 — which is the counter-example the resistance-step section argues from |
| `6a7cab8c…` | 20 target watts | 277 | the confirmed watt-target ride |
| `6a6368cb…` | 46 | 376 | **recumbent** — the only non-upright ride; strap dead for 215 samples; final sample `duration: 8` |
| `6a5e4fe4…` | 38 | 89 | resistance pinned at 1 while power ramps — breaks the "power follows resistance" assumption |
| `6a998daf…` | 20 target watts | 362 | **snake_case, captured from the API**; strap glitching badly, and the only ride with independent ground truth |

Between them these cover every `programType` in the account (0, 18, 20, 38, 46, 47),
both bike types, and both sides of the upstream shape change.

**`6aa67d33…` was captured by reading `localStorage` directly**, not through the
export, and the record is byte-identical to what was in the blob — verified by
length and two independent checksums computed on both sides before it was written.
Worth knowing for the next capture: `root.userStore` was the *already-parsed object*
shape that time, so `JSON.stringify`-ing it to pull the record out would have
silently normalized any whole-number float. Extract from the `localStorage` string
itself. This record happens to carry no `.0` values — checked, not assumed — so the
pretty-printed fixture round-trips back to those exact bytes.

**`6aa2d8a8…` was captured through the extension's own export**, which is what that
feature was for — but note the capture route matters and the file records which one
was used. An export round-trips through `JSON.stringify`, so a `28.0` on the wire
would come back as `28`; that record happens to contain no whole-number floats, so
its bytes are identical either way (checked against the raw `localStorage` text
before it was committed). Six older fixtures *do* carry `.0` values. If you capture a
fixture from an export and it has them, pull the raw text out of `localStorage`
instead rather than committing the normalized numbers.

Treadmill and rower fixtures are deliberately **not** being collected — see Scope
above. If that changes, note that those records populate different fields
(`totalSteps`, `incline`, `totalStrokes`, `peakSpm`) and will break assumptions
built on bikes alone; the machine-type branches in `src/charts/plan.ts` are
reasoned from the field list, never verified against a real record.

Chart tests (`src/charts/charts.test.ts`) run the geometry against every fixture and
assert the conventions directly: no `NaN` in any emitted path, one palette slot per
panel, a step path for resistance and a line path for power, every non-zero baseline
labelled, and dropouts nulled rather than zeroed. **Add the assertion when you add
the rule** — a convention nothing checks is a convention that drifts.

View tests (`src/ui/dashboard.test.ts`) run under `// @vitest-environment jsdom` and
cover the DOM: accessible labels, arrow-key scrubbing, the dropout readout, the
sprint bars, the table row count. Note that jsdom rebases `import.meta.url` onto the
document URL, so fixtures there must be resolved from `process.cwd()`.

`src/layers.test.ts` asserts **structure rather than behaviour**, and fails on a
change no other test would notice — see "The layering" above. It parses every source
file with the TypeScript compiler rather than grepping, because a mention of
`localStorage`, `chrome` or `fetch` inside a comment or a string is not a use of it,
and a scan that cannot tell the difference gets switched off within the week and
protects nothing.

The parser, export and API tests moved out with the code they cover. If a change here
turns out to need one of them, it is a change to the core package, and it belongs in
that repo with its own release.

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
