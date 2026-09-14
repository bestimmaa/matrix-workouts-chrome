# Changelog

All notable changes to this project will be documented in this file.

The version history source of truth is git tags in the format `vMAJOR.MINOR.PATCH`.

## [Unreleased]

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
