# matrix-workouts-chrome

[![CI](https://github.com/bestimmaa/matrix-workouts-chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/bestimmaa/matrix-workouts-chrome/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Chrome extension that shows what your exercise bike actually recorded.

The Matrix / Johnson Fitness dashboard at `matrixworkouts.jfit.co` gives you six
tiles per ride: distance, avg incline, avg heart rate, calories, duration, avg speed.

The record behind that page also contains a sample every 10 seconds carrying
**power (watts), console resistance level and cadence (rpm)**. None of the three
appears anywhere in the site's UI. This puts them on screen.

**Scope: indoor bikes only** — upright and recumbent. A treadmill or rower ride is
left alone deliberately, not by accident.

## Install

```bash
npm install
npm run build
```

Then `chrome://extensions` → Developer mode → *Load unpacked* → `dist/`.

Open any ride at `/workouts/:id` and use the pill the extension adds. After a
rebuild, reload the extension card **and** the tab.

## Download your history

The site's own page only holds about the current week, and errors on anything older.
The API has everything, and the client that takes the lot ships separately:

```bash
npx matrix-workouts-history --split
```

See [matrix-workouts-core](https://github.com/bestimmaa/matrix-workouts-core) — it is
the parser, API client and export format this extension is built on, and it handles
the sign-in that happens outside the browser.

## Working on it

```bash
npm test         # vitest
npm run typecheck
npm run build
npm run preview  # render fixtures to HTML, no browser needed
```

All three of the first must pass before committing.

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | how to work on this: decisions, rules, gotchas. **Start here.** |
| [TODO.md](TODO.md) | deferred work |
| [CHANGELOG.md](CHANGELOG.md) | what changed, per tagged version |

## Part of matrix-workouts

| | |
|---|---|
| [matrix-workouts-core](https://github.com/bestimmaa/matrix-workouts-core) | the parser, API client and export format |
| [matrix-workouts-chrome](https://github.com/bestimmaa/matrix-workouts-chrome) | this extension |
| [matrix-workouts-mcp](https://github.com/bestimmaa/matrix-workouts-mcp) | an MCP server, so an AI agent can ask about your rides |

MIT licensed. Unaffiliated with Matrix Fitness or Johnson Health Tech. It reads one
account's own data, locally, and sends it nowhere.
