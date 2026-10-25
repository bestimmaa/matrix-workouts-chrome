# Fonts for the share card — and only for it

Two faces, Latin subset, as served by Google Fonts on 25 Oct 2026:

| File | Face | Licence |
|---|---|---|
| `Doto-Black-latin.woff2` | Doto, weight 900 | [OFL-Doto.txt](OFL-Doto.txt) |
| `InstrumentSans-latin.woff2` | Instrument Sans, variable 400–700 | [OFL-InstrumentSans.txt](OFL-InstrumentSans.txt) |

They are inlined into the content script at build time and embedded only in the
offscreen SVG that becomes the share image (`../share.ts`). They are never
registered on the page or in the view's stylesheet, and nothing fetches them.
See "No webfonts of our own" in AGENTS.md for why that boundary matters.
