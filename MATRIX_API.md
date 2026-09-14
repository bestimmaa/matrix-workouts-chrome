# MATRIX_API.md — the jfit HTTP API

Reference for the undocumented API behind `matrixworkouts.jfit.co` (Matrix / Johnson
Fitness). Written while building the standalone client in `scripts/history.ts`.

**Everything here was read out of the site's own JavaScript bundle or confirmed
against the live API on 14 Sep 2026.** Each endpoint below is marked *verified* (a
request was actually made and the response observed) or *from the bundle* (the call
site was read, but never exercised). Do not promote the second kind to the first by
assuming — this API is undocumented, unversioned, and **its record shape has already
changed at least once** (see AGENTS.md, "The upstream shape has changed").

---

## Hosts

| Host | Use |
|---|---|
| `https://apollo.jfit.co` | **The one that works.** Sign-in and workout history. |
| `https://orion.jfit.co` | Configured in the bundle as `exerciserApi`, answers **403**. Do not use. |

The bundle sets both up in one function:

```js
e.apolloBackend.setup({ baseUrl: `https://apollo.jfit.co` });
e.exerciserApi.setup({ baseUrl: `https://orion.jfit.co` });
```

The Apollo client is created with `headers: { Accept: "application/json" }` and no
authentication of its own; the bearer token is attached per request.

---

## Authentication

Two independent token systems appear in the bundle. Only the first matters here.

**Apollo (what we use).** `POST /exerciser/login` returns a profile with a `token`
field. Send it as `Authorization: Bearer <token>` on subsequent requests.

**Orion `jumpToken`.** A separate async request transform attaches
`Bearer ${token.accessToken}` from `authStore.jumpToken`. Irrelevant while Orion
answers 403.

Inside the browser there is no need to sign in at all: the site leaves the token in
the redux-persist blob at `userStore.exerciserProfile.token`, which is what
`readCredentials` (`src/api/credentials.ts`) reads. **Prefer that.** It handles no
passcode, needs no network, and cannot be rate-limited. Signing in with an xid is
only for the standalone client, which has no browser session to borrow.

---

## `POST /exerciser/login` — *verified*

Exchange a member number (xid) and numeric passcode for a bearer token.

The request shape is not guessed; it is the site's own, from the bundle:

```js
async loginWithXid(e, t, n = `xid`, r = 0) {
  let i = { username: e, password: t, type: n, club_id: r };
  return apisauce.post(`/exerciser/login`, i);
}
```

**Request** — `Content-Type: application/json`

| Field | Value |
|---|---|
| `username` | the xid (member number). **Not** an email. |
| `password` | the numeric passcode |
| `type` | `"xid"`. The bundle's other value is `"apollo"`, used by `loginWithNpUUID` for SSO with an empty password. |
| `club_id` | `0` in every call the site makes |

**Response** `200` — a flat profile object:

```
first_name  last_name  email  units  gender  height  weight
birthday  age  pictureUrl  aliases  identities  id  token
```

Only two fields matter: **`id`** is the exerciser id for the workouts path, and
**`token`** is the bearer token. `src/api/login.ts` deliberately returns only those
two — the rest is PII that no later call needs.

A wrong xid or passcode answers `401`.

> **Rate limiting is unmeasured.** Nothing in the bundle suggests a lockout, and none
> was hit in testing, but that is not evidence of absence. Do not loop this endpoint.

---

## `GET /exerciser/{id}/workouts` — *verified*

**The whole point.** Returns complete workout records *including every interval* —
one request gets the entire history.

**Request** — `Authorization: Bearer <token>`, `Accept: application/json`

The site always sends a date window:

```js
apisauce.get(`/exerciser/${e}/workouts`, {
  startdate: Math.floor(t.getTime() / 1e3),   // unix seconds
  enddate:   Math.floor(n.getTime() / 1e3),
});
```

**Omitting both returns the full history**, which is what this project does. Confirmed
live: 47 records spanning 2026-01-10 to 2026-09-13 in a single 1.8 MB response.

**Response** `200` — `{ workouts, messages, paging }`

```json
{ "paging": { "returned": 47, "total": 47, "page": 1 } }
```

`paging` has come back complete (`returned === total`) on every account seen.
**Paging is deliberately not followed** — inventing page parameters against an
undocumented API is a good way to silently truncate someone's history — so a `total`
larger than what arrived surfaces as `truncated` instead. See `src/api/client.ts`.

### Record fields (snake_case)

`workout_id`, `id`, `model_id`, `machine_id`, `machine_type`, `exercise_title`,
`workout_type`, `workout_source`, `workout_time`, `duration`, `distance`, `calories`,
`average_heart_rate`, `max_heart_rate`, `min_heart_rate`, `program_type`,
`program_id`, `program_level`, `watts_kg`, `workout_originator`,
`integration_metadata`, `archived`, `intervals`.

Units: `duration` seconds, `distance` **meters** (the UI renders km), heart rate bpm,
`workout_time` ISO 8601 UTC.

### Interval fields — the reason this project exists

Each entry in `intervals` is one ~10-second sample:

| Field | Notes |
|---|---|
| `duration` | seconds this sample covers; the last one is usually short |
| `distance` | meters in this sample |
| `average_distance` | cumulative meters — **not** an average, despite the name |
| `speed` | km/h |
| `rpm` | **cadence** |
| `power` | **watts** |
| `resistance` | **console resistance level** |
| `heart_rate` | bpm, `0` on a chest-strap dropout |
| `incline` | always `0` on bikes |
| `total_steps` | populated on bikes too |

**`rpm`, `power` and `resistance` appear nowhere in the stock UI.** The stock detail
page shows six tiles: distance, avg incline, avg heart rate, calories, duration, avg
speed. That is the entire gap this project closes.

---

## Two shapes for the same data

**The API returns `snake_case`; the browser's persisted blob returns `camelCase`** —
including inside `intervals` (`average_distance` vs `averageDistance`). Always go
through `camelizeWorkout()` rather than reading raw keys.

The API also carries four fields the cached blob does not: `program_id`,
`program_level`, `workout_originator`, `integration_metadata`.

---

## Endpoints that do not work

| Endpoint | Result |
|---|---|
| `GET /workouts/{id}` | **404.** In the bundle, but dead. Fetch the list and filter. |
| anything on `orion.jfit.co` | **403** |

---

## The rest of the surface — *from the bundle, unverified*

Present in the JavaScript, never exercised. Listed so nobody has to re-read a 1.8 MB
bundle to find them; **treat every shape here as unconfirmed.**

| Endpoint | Bundle payload |
|---|---|
| `POST /exerciser/reset_password` | `{ xid }` |
| `POST /exerciser/register` | the profile, `decamelizeKeys`'d |
| `POST /exerciser/validate` | — |
| `POST /exerciser/exchange_token_for_exerciser` | `{ token, vendor: "upace" }` |
| `GET /exerciser` | — |
| `PUT /exerciser/{id}` | profile update |
| `POST /dapi/login`, `POST /dapi/addUser`, `POST /dapi/unlinkUser` | the "dapi" account system |
| `POST /dapi/dapi-exchange` | `{ token }` |
| `GET /dapi/user` | `{ user_id }`, headers `session` and `user-uuid` |
| `GET /dapi/machine`, `GET /dapi/usermachine` | — |
| `POST /brand/graphql` | branding/CMS |
| `POST /wallet/pass` | Apple/Google wallet pass |

`reset_password` and the `dapi` write endpoints change account state. **Do not probe
them.**

---

## Using it

From this repo:

```bash
cp .env.example .env    # fill in MATRIX_XID and MATRIX_PIN
npm run history         # full history -> history/
```

See `scripts/history.ts`. Credentials live in `.env` (gitignored), are used for the
single sign-in request, and are never written to output or logged. The `history/`
directory is gitignored: those files are the rider's resting heart rate.
