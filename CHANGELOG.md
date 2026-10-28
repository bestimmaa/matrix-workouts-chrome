# Changelog

All notable changes to this project will be documented in this file.

The version history source of truth is git tags in the format `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Added

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

### Removed

- `npm run history`. It ships from the core package as `npx matrix-workouts-history`,
  which is also where the passcode is now handled.
