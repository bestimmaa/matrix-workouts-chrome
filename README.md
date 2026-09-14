# full-matrix-workouts

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
The API has everything, so there is a standalone client that signs in and takes the
lot:

```bash
cp .env.example .env     # your xid and passcode
npm run history          # -> history/
npm run history -- --split   # plus one JSON document per ride
```

Credentials stay in `.env`, which is gitignored, and are used for one sign-in request.
`history/` is gitignored too — those files are your heart rate.

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
| [MATRIX_API.md](MATRIX_API.md) | the undocumented API this talks to |
| [TODO.md](TODO.md) | deferred work |

Unaffiliated with Matrix Fitness or Johnson Health Tech. It reads one account's own
data, locally, and sends it nowhere.
