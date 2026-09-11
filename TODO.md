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

- [ ] **Export the whole history, not just the open ride.** The per-workout *Export
      JSON* button covers the ride on screen; `fetchWorkoutHistory` already returns all
      43 records and there is no way to get them out in one go. Pairs with the
      cross-ride views below — the same button on a list page would be the natural
      place for it. See "The export format" in AGENTS.md for the shape a multi-workout
      file should extend rather than replace.

- [ ] **Programs 0 and 47 are still unidentified.** Ride each once and read the mode
      off the console, then add a row to the training log so the ride can be matched.
      This is a rider task, not a code task. See "Program modes" in AGENTS.md.

## Views

- [ ] **Use the history the API already returns.** `fetchWorkoutHistory` fetches all 43
      workouts and we render exactly one of them. Nothing cross-ride exists yet: no
      power curve, no sprint-to-sprint comparison, no resistance-vs-power drift over
      months.

- [ ] **Replace the workout list page.** The site caches roughly the current week, so
      its own list cannot reach older rides and errors on them. Ours could, and it
      would make the history a first-class thing the UI holds rather than a one-shot
      fetch behind a button.
