# Content Hub — project notes for Claude

Single-user video content calendar: FastAPI + SQLite backend, vanilla-JS SPA
frontend (no build step, no framework). One process serves the API and the
static files.

## Run & test

- Start: `./run.sh` (add `--reload` while editing Python). Serves on
  `http://127.0.0.1:8000`.
- Dependencies are vendored in `./libs`, NOT a venv — this drive is exFAT
  (no symlinks), so `run.sh` sets `PYTHONPATH=$PWD/libs`. Any manual
  `python3` invocation needs the same: `PYTHONPATH=$PWD/libs python3 …`.
- Tests: `PYTHONPATH=$PWD/libs python3 test_backend.py` — it is a
  self-executing script with its own PASS/FAIL runner, **not pytest**
  (pytest chokes on its module-level `sys.exit`).
- Python edits need a server restart; `static/` JS/CSS is served from disk,
  so a browser hard-refresh is enough.
- Config comes from `.env` via [config.py](config.py): `DB_PATH`,
  `MEDIA_ROOT`, `HOST`, `PORT`, upload limits. Point `DB_PATH` at a copy to
  test against scratch data.
- `sqlite3` CLI is not installed on this machine — inspect the DB with
  `python3 -c "import sqlite3; …"`.

## Layout

| Path | What it is |
|---|---|
| `main.py` | FastAPI app assembly, static mount |
| `routers/` | API endpoints (content, weekly, money, media…) |
| `models.py` | Pydantic schemas — **the enums here are the vocabulary source of truth** |
| `database.py` | Schema DDL + connection; enums stored as plain TEXT |
| `storage.py` | Media file storage under `media/{content_id}/{raw|final}/` |
| `static/js/app.js` | Hash router + shared state + top bar |
| `static/js/ui.js` | `el()` DOM factory, `svg()` twin lives in dashboard.js; STATUSES / PERFORMANCES / TYPES vocab lists with chip colours; toasts, dialogs |
| `static/js/views/` | One module per view (library, dashboard, detail, weekly, money…) |
| `static/css/style.css` | All styling; CSS vars at top define the dark theme |
| `content_hub.db` | The live SQLite database (`content_hub.db.bak` = backup from 2026-07-28, pre type-vocabulary rewrite) |

## Select-field vocabularies (the triad)

A select vocabulary lives in **three places that must stay in sync**:

1. Enum in [models.py](models.py) (`Status`, `Performance`, `ContentType`) —
   validates requests AND responses.
2. List in [ui.js](static/js/ui.js) (`STATUSES`, `PERFORMANCES`, `TYPES`) —
   dropdown order + chip colour name.
3. `.chip-<tone>` rules in [style.css](static/css/style.css) (two blocks:
   `.chip-*` and `.cell-select.chip-*`).

The `color` field is a **tone name, not a hue**: `n` (neutral), `t1` (blue),
`t2` (soft green), `t3` (strong green), `warn` (amber), `bad` (red). Six
tones total — adding a vocabulary value means picking one of them, not
inventing a colour.

Current `ContentType`: Story, Celebrity, Theory, Decode, Fact, Lesson,
Hypothetical, Debate, Pitch. `Performance`: Viral / Average / Failed.
`Status`: Idea / Editing / Ready / Posted / Failed.

⚠ The DB stores these as plain TEXT. Removing an enum value makes GET
endpoints crash on old rows (response validation), so migrate or NULL the
old values in `content` when changing a vocabulary.

## Colour system ([style.css](static/css/style.css) section 1)

Every hue is a four-step ramp — 50 / 200 / 400 / 900. On this dark theme the
roles invert from light-theme habit: **the 900 step is the fill and the 200
step is the ink on it**. That one rule generates every chip, due badge and
tag. Blue = interactive accent (also single-series chart marks), green =
good, amber = attention, red = failed.

The 400 steps are the only place three hues sit side by side (the
performance stack, the status edge bars), so they must stay
distinguishable — don't retune them casually.

## Deadlines view ([deadlines.js](static/js/views/deadlines.js))

Card rows (`.deadline-card`), **not a table** — a grid per assignment with a
6px urgency-coloured edge bar, topic + editable date stacked, then assignee,
due badge, status, actions. Each row has a **⬆ Final** button that uploads
the finished cut straight to that entry's `final` media bucket (via
`api.uploadMedia`, progress shown on the button), then **✓ Done** clears the
row. The button label carries the existing final-video count
(`⬆ Final · 2`). Done only sets `done = 1` — it never deletes anything.

## Frontend routing

Hash router in [app.js](static/js/app.js). Valid routes: `#/library`,
`#/library/deadlines`, `#/library/calendar`, `#/library/month`,
`#/library/dashboard`, `#/content/:id`, `#/weekly`, `#/money`.
**The dashboard is `#/library/dashboard`, not `#/dashboard`** — unknown
hashes are reset to `#/library`.

## Dashboard charts ([dashboard.js](static/js/views/dashboard.js))

Card builders, all fed by the one `/api/content` list:

- `barCard` — horizontal label|bar|count rows (Pipeline, Content type).
- `perfStackCard` — Performance by type: one stacked horizontal bar per
  type (Viral|Average|Failed segments), sorted by rated-video count, legend
  below. Status colours `#2fa568` / `#b98d18` / `#bd3454` are
  CVD-validated against the dark surface — don't swap them casually.
- `columnCard` — vertical columns (uploads per week histogram).
- `lineCard` — line/area/spline; renders an explanatory empty state until
  it has ≥ 2 points (a lone dot reads as broken).
- `radarCard` — single-series radar (uploads by weekday).
- `donutCard`, `statTile` — completion ring, headline numbers.

Charts use the accent hue for single-series marks; only the performance
stack is multi-series and carries a legend.

## Environment quirks

- Everything lives on an exFAT external SSD (partition label "SDCARD") —
  no symlinks, no venvs, permissions are faked.
- Chromium is a snap: it cannot read/write `/tmp` and headless CLI
  screenshots drop `#fragment` URLs mid-navigation. To screenshot a route,
  drive it over CDP (`--remote-debugging-port`, `Page.navigate`, wait,
  `Page.captureScreenshot`) and write output under `$HOME`.

Keep this file updated when structure, routes, or vocabularies change.
