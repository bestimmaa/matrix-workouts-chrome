# Changelog

All notable changes to this project will be documented in this file.

The version history source of truth is git tags in the format `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Added

- **Excluding a bad ride from records (experimental).** *Exclude from records* on a
  ride's records section, or the × beside any record on the records page, takes the
  whole ride out of every record. The next best effort takes its place. Excluded
  rides are listed on the records page and on the options page, with a way to count
  them again. Stored in `chrome.storage.local`: each ride's id, start time and when
  it was excluded.
- **Records page (experimental).** Per machine type, each duration's best ever next
  to its best in the last 8 weeks, in short, medium and long groups, with one next
  target. Every number links to its ride. The toolbar icon opens it anywhere off a
  ride, where it used to say "Open a workout first". The ride's records section opens
  it with *All records*.
- **Records (experimental).** Each ride shows, under its stat tiles, any new best
  mean power at 30 s, 1, 5, 10, 20 or 60 min against earlier rides on the same
  machine type, with the record it beat and a link to that ride. It also shows a
  first effort at a duration, or the nearest record when nothing was won. Opening a
  ride now fetches the full history in the background, once per tab, to compare
  against. It stays in memory as before. Built on `rideRecords` from
  `matrix-workouts-core`'s `analysis/`.

- The view names a Hills ride (console program 8) "Hills" in its header, where it
  would have read "Program 8". Core knows the mode from 0.6.0.
- **Send to Strava** in the view's header: uploads the ride's FIT file to the
  rider's Strava account with `trainer=1`, so it arrives as an indoor ride, and
  with the program's title as its name. Built on `stravaUpload` from
  `matrix-workouts-core` 0.4.0. Sign-in goes through the rider's own Strava API app,
  entered on a new options page that also shows what is stored and clears it. The
  manifest gains `identity`, `storage` and host access to Strava's upload, activity
  and OAuth endpoints. It asks Strava for `activity:write` and `activity:read_all`.
  The read is used only to tell our own earlier upload from another app's copy when
  Strava calls a ride a duplicate. Another app's copy shows as a conflict, with a
  link to delete it.
- **Share image** in the view's header: save the ride as a PNG to post, as a 9:16
  story or a 4:5 feed post. The card comes from `matrix-workouts-core` 0.3.0's
  `share/`; the extension rasterizes it locally and downloads it. Nothing is uploaded.
- The card's two fonts, Doto and Instrument Sans (Latin subset, SIL OFL), inlined
  into the content script and used only inside the share image.

### Changed

- The parser, API client and export format are now `matrix-workouts-core`, an npm
  package shared with `matrix-workouts-mcp`. The extension consumes it instead of
  holding its own copy. Rendering is unchanged — every fixture's preview output is
  byte-identical across the move.
- `src/layers.test.ts` trades its `mayTakeDependencies` boolean for a `mayDependOn`
  allowlist, so the "no dependency tree" property survives having one dependency.
- Renamed from `full-matrix-workouts`.

### Fixed

- *Load full history* no longer draws the ride it fetched over a different
  workout when the rider navigates away before the answer arrives.
- *Show stock page* no longer leaves the pill behind on a page the extension does
  not handle. The toolbar icon can open the sheet anywhere — off the workout route,
  or on a treadmill ride — and closing it there used to collapse to a pill that
  nothing would remove until the next navigation. It now removes the surface, as
  navigating there would have.
- The options page no longer overwrites a Client ID or Secret the rider is typing
  when the worker writes Strava's tokens — the first upload connecting, or a token
  refresh, in another tab. Only a change to the app itself refills the fields.

### Removed

- `npm run history`. It ships from the core package as `npx matrix-workouts-history`,
  which is also where the passcode is now handled.
