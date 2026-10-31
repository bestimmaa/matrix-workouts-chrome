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
      See the "Reported summaries" gotcha in the core repo's AGENTS.md.

- [ ] **Decide what `totalSteps` is on a bike, then show it or document why not.**
      It is populated on every ride and displayed nowhere — not by us, not by the
      stock page. Monotonic and cumulative, ending at 15,297 on the 03 Sep ride. It is
      *not* crank revolutions: cadence integrates to 6,445 over the same ride. It works
      out to ~1.94 m per unit against the recorded distance, which suggests the console
      derives it from distance with a fixed stride rather than counting anything real.
      If that is what it is, it carries no information and the right move is a line in
      the core repo's AGENTS.md saying so.

- [ ] **Per-sample `distance` is parsed but never surfaced.** The table shows
      cumulative distance only. Probably right — the delta is quantized to 16.09 m
      (0.01 mile) and reads as noise — but it is currently an unstated omission.

## Data

- [ ] **Export the whole history from inside the extension.** Done outside it:
      `npx matrix-workouts-history --split` writes every ride as an export document and
      signs in on its own. What is still missing is a way to do it *in the browser*,
      where the token is already there and no passcode is involved — the per-workout
      *Export JSON* button still covers only the ride on screen. Pairs with the
      cross-ride views below; the same button on a list page is the natural place for
      it. See "The export format" in the core repo's AGENTS.md for the shape a
      multi-workout file should extend rather than replace.

- [ ] **Program 0 is still unidentified.** Ride it once and read the mode off the
      console, then add a row to the training log so the ride can be matched. This is
      a rider task, not a code task. Program 47 was closed this way on 13 Sep 2026 —
      it is Virtual Active. The mapping itself lives in the core repo now; see
      "Program modes" in its AGENTS.md, and land the parser change there.

## Views

- [ ] **Use the history the API already returns.** `fetchWorkoutHistory` fetches every
      ride on the account and we render exactly one of them. Nothing cross-ride exists
      yet: no power curve, no sprint-to-sprint comparison, no resistance-vs-power drift
      over months. **`matrix-workouts-mcp` is getting this first**, in its `analysis/`
      directory, against the files `matrix-workouts-history` puts on disk. If the view
      wants a power curve later, promote that code into the core package rather than
      writing a second one here.

- [ ] **Replace the workout list page.** The site caches roughly the current week, so
      its own list cannot reach older rides and errors on them. Ours could, and it
      would make the history a first-class thing the UI holds rather than a one-shot
      fetch behind a button.

## Strava

- [ ] **Send the whole history to Strava, replacing the Apple Watch copies.** The
      button sends one ride. A backfill of every ride was done once by hand on 28 Oct
      2026 (63 rides up, 46 watch copies deleted), so this is for the next time, and
      for a history that keeps growing. The design that run supports:

      - **Runs in the content script, one upload per worker message.** Only the
        content script can read the jfit token in the site's `localStorage`, and
        "Load full history" already puts every ride in memory. Loop over the
        selected rides and send the existing `stravaUpload` message for each. Every
        upload is a short worker task, so the service worker's idle limit never
        matters. The tab must stay open. Nothing new is stored: the history stays
        in memory, and Strava itself is the record of what is done.
      - **Match against Strava first.** List the athlete's activities for the date
        range. `activity:read_all` is already asked for (the single-ride button
        uses it to read the activity a "duplicate" names), but the manifest's host
        permission covers only `/api/v3/activities/*`, so the athlete's activity
        list is a new path to grant. A Matrix ride matches a Strava activity when
        they overlap in time, with about 2 minutes of slack. Then each ride is one
        of:
        - already ours (named by `workoutTitle`, no device): skip;
        - covered by an Apple Watch ride: upload, then list the watch copy;
        - on Strava with nothing: upload.
      - **Expect many-to-one and none-to-one.** One watch ride can cover several
        Matrix rides when the console split a session (16 Oct, 21 Sep 2026). There
        are watch rides with no Matrix ride: Apple Fitness+ Cycling, hour-long rides
        in early August. Leave those alone. Weight training overlapping a ride is
        not a duplicate; only `Ride` activities count.
      - **Weak heart rate keeps the watch copy.** Where under 60 % of the Matrix
        samples survive `flagHeartRateDropouts`, the watch's trace is the better
        record. Default to not uploading those days and keeping the watch ride (4
        of 50 days on 28 Oct: 22 Oct, 20 Oct, 10 Sep, 19 Aug).
      - **Skip rides under 5 minutes by default.** They are aborted starts, some
        with 1–2 samples.
      - **The UI.** A "Send history to Strava" panel offers the matched list with
        checkboxes, short and weak-heart-rate rides unticked. Then it shows progress,
        and at the end a review list: each upload next to its watch copy, linked.

- [ ] **Strava may reject an upload as a duplicate of the watch ride.** On 28 Oct
      2026, 6 of 46 uploads of a ride with an overlapping Apple Watch copy came back
      as "duplicate of activity <watch id>". The other 40 were accepted alongside
      their watch copy. No rule for which was found. Deleting the watch copy and
      uploading again worked every time, so a deleted activity no longer blocks.
      The single-ride button already tells the two apart: it reads the named
      activity's `external_id` and calls another app's copy a conflict (see
      AGENTS.md). What is left for the batch: delete-then-retry cannot be automated
      (no delete in the API), so a conflict goes on the review list. The rider
      deletes the watch copy there and the batch retries those rides.

- [ ] **Deleting the watch copies stays with the rider.** The Strava API has no
      delete endpoint. On 28 Oct they were deleted through the logged-in web session:
      the activity page's form, after checking the page's device line reads "Apple
      Watch…". That is not the API, breaks whenever Strava changes its site, and is
      outside its API terms. Fine once, under supervision; not something to ship. The
      batch lists the watch copies with links instead. `hide_from_home` (allowed by
      `activity:write`) could mute them meanwhile, off by default.

- [ ] **Pace by Strava's own counters, and make the run resumable.** Uploading 61
      rides took about 2.5 minutes. Each ride is one upload plus 1–2 status polls, so
      a full history fits in the default 200 requests per 15 minutes and 2,000 per
      day. Still read `x-ratelimit-usage` and `x-ratelimit-limit` on every response,
      and wait for the next quarter hour when close or on a 429. Keep a per-ride
      result for the run (done, activity id, error), so an interrupted run can
      continue.
