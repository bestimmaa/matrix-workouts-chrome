# TODO

Deferred work, with enough context to pick up cold. Anything here that is a *decision*
rather than a task belongs in AGENTS.md instead.

## Display

- [ ] **Show the platform's reported heart-rate average beside the filtered one.**
      The readout console currently shows only the mean of the samples that survive
      dropout filtering. On the 03 Sep ride the platform's reported 153 bpm matches
      the rider's Apple Watch exactly while the filtered series gives 151 — the
      console appears to average in real time, ahead of the dropouts the interval
      series preserves. So on a badly glitching strap the reported figure is the
      *better* one, and showing only ours is quietly misleading. Show both, labelled.
      See the "Reported summaries" gotcha in AGENTS.md.

- [ ] **Decide what `totalSteps` is on a bike, then show it or document why not.**
      It is populated on every ride and displayed nowhere — not by us, not by the
      stock page. Monotonic and cumulative, ending at 15,297 on the 03 Sep ride. It is
      *not* crank revolutions: cadence integrates to 6,445 over the same ride. It works
      out to ~1.94 m per unit against the recorded distance, which suggests the console
      derives it from distance with a fixed stride rather than counting anything real.
      If that is what it is, it carries no information and the right move is a line in
      AGENTS.md saying so.

- [ ] **Per-sample `distance` is parsed but never surfaced.** The table shows
      cumulative distance only. Probably right — the delta is quantized to 16.09 m
      (0.01 mile) and reads as noise — but it is currently an unstated omission.

## Data

- [ ] **Export the whole history from inside the extension.** Done outside it:
      `npm run history -- --split` writes every ride as an export document, and
      `src/cli/history.ts` signs in on its own. What is still missing is a way to do it
      *in the browser*, where the token is already there and no passcode is involved —
      the per-workout *Export JSON* button still covers only the ride on screen. Pairs
      with the cross-ride views below; the same button on a list page is the natural
      place for it. See "The export format" in AGENTS.md for the shape a multi-workout
      file should extend rather than replace.

- [ ] **Program 0 is still unidentified.** Ride it once and read the mode off the
      console, then add a row to the training log so the ride can be matched. This is
      a rider task, not a code task. Program 47 was closed this way on 13 Sep 2026 —
      it is Virtual Active. See "Program modes" in AGENTS.md.

## Views

- [ ] **Use the history the API already returns.** `fetchWorkoutHistory` fetches every
      ride on the account and we render exactly one of them. Nothing cross-ride exists
      yet: no power curve, no sprint-to-sprint comparison, no resistance-vs-power drift
      over months. `npm run history` now puts the whole set on disk, so this can be
      prototyped against real files before any of it goes near the extension.

- [ ] **Replace the workout list page.** The site caches roughly the current week, so
      its own list cannot reach older rides and errors on them. Ours could, and it
      would make the history a first-class thing the UI holds rather than a one-shot
      fetch behind a button.
