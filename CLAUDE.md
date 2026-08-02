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
| `static/js/ui.js` | `el()` DOM factory, `svg()` twin lives in dashboard.js; STATUSES / PERFORMANCES / TYPES vocab lists with chip colours; `dropdown()`; toasts, dialogs |
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

## Dropdowns

Filter bars use **`dropdown()` from [ui.js](static/js/ui.js), never a native
`<select>`** — a select's option list is drawn by the OS and takes no CSS, so
on this dark theme it opens as a white sheet. `dropdown()` is a button plus a
panel we own (click-outside, Escape, ↑/↓/Enter, aria listbox roles).

⚠ `#view`'s entry animation makes every direct child its own stacking
context, so `.filter-bar` carries `position: relative; z-index: 20` — without
it the open panel paints *behind* the table below it.

Inline table cells still use `selectCell()` (a real `<select>`): there the
popup is a brief native interaction on a chip, not a designed surface.

## App shell (index.html)

**Fixed left sidebar (`.sidebar`, 232px) + scrolling `.shell`.** The sidebar
is the primary nav — seven `.side-link` rows, each an icon tile plus a label,
with `data-route` matching the keys of `LIBRARY_RENDERERS`. The active state
lives on the **icon tile** (it fills with the brand gradient), set by the
router in [app.js](static/js/app.js).

The top row carries a **breadcrumb over a page title** (`#crumb-here`,
`#crumb-title`, both written by the router) plus search and + New — not tabs.
Under 1100px the sidebar becomes a drawer toggled by `#side-toggle`.

There is **no footer element any more**; the disk/media readout moved into
`.side-card` at the bottom of the rail, keeping the ids `#footer-disk` and
`#footer-media` that app.js writes to.

## Design language — "deep-space glass"

Taken from the Vision-UI reference the user supplied (`first css Dashboard
Screen.txt`, a Figma export). Four rules:

- The page is **navy**, painted once by `--page-bg` (a fixed diagonal
  gradient). Nothing else sets a page background.
- **Every panel is one material**: `--glass` (translucent navy gradient) over
  `backdrop-filter: blur(60px)` with a 1px white-at-8% rim. Applied by the
  shared selector list in **section 5, which is last in the file on purpose**
  so it beats the per-component `background` declarations — those remain the
  opaque fallback. Add a new card by adding its class to that list.
- Radii are generous: 20px cards, 15px controls, 12px inner.
- **Blue is the only interactive colour.** `--purple-400` is decoration only
  (brand mark, gradients) — it measures 2.56:1 on the page and must never
  carry data.

Floating surfaces (`.dd-panel`, `.dialog`, `.preview`, `.toast`) override the
recipe with a near-opaque fill: they sit over *content*, and the card's 49%
stop lets the table read straight through.

## The forest ramp — why there are 9 steps, not 6

The user supplied six greens. Measured as an ordinal ramp they have two gaps
that flatten a UI, so three steps were **derived** to fill them:

| gap in the supplied set | ΔL | consequence |
|---|---|---|
| `#051F20 → #0B2B26` | .044 | too close to read as two layers (floor ≈ .06) |
| `#0B2B26 → #163832` | .049 | same |
| `#235347 → #8EB69B` | **.334** | a canyon — no mid-tone exists at all |

The canyon is the expensive one: with nothing in the mids there is no
readable "quiet" colour, so the sage ends up doing *both* muted text and
accent — which is exactly what drains an accent of meaning. `--f-400`
(`#6E9B85`, 4.8:1 on a panel) fixes that, and **`--text-muted` is `--f-400`,
never the sage.**

Surfaces also **skip a rung**: the floor goes straight to `--f-800` for cards
(ΔL .105) rather than stepping through `--f-900` (ΔL .044, invisible). Two
adjacent ramp steps do not make two readable layers.

Measured relationships worth preserving: page→card ΔL .105 · muted text
4.8:1 · faint 3.2:1 · dark ink on sage 8.6:1.

## Colour system ([style.css](static/css/style.css) section 1)

Every hue is a four-step ramp — 50 / 200 / 400 / 900. On this dark theme the
roles invert from light-theme habit: **the 900 step is the fill and the 200
step is the ink on it**. That one rule generates every chip, due badge and
tag. Blue = interactive accent, green = good, amber = attention, red =
failed.

⚠ **Chart fills use `--chart-good/warn/bad`, not the ramp 400s.** The
brights (`#01b574` / `#f6ad55`) are correct as small marks and text but sit
above the safe lightness band as large areas, and that pair loses CVD
separation. The `--chart-*` trio is validated against the navy surface;
legend dots and text keep the brights. Don't retune either casually.

## Deadlines view ([deadlines.js](static/js/views/deadlines.js))

Card rows (`.deadline-card`), **not a table** — a grid per assignment with a
6px urgency-coloured edge bar, topic + editable date stacked, then assignee,
due badge, status, actions. Each row has a **⬆ Final** button that uploads
the finished cut straight to that entry's `final` media bucket (via
`api.uploadMedia`, progress shown on the button), then **✓ Done** clears the
row. The button label carries the existing final-video count
(`⬆ Final · 2`). Done only sets `done = 1` — it never deletes anything.

## Library filters & the detail stepper

`state.filters` in [app.js](static/js/app.js) is the single filter object the
table view owns: `status`, `type`, `performance`, `month`, and **`media`**
(`''` | `raw` | `final` | `none` | `unposted`). `media` maps to the API's
`media` query param, which filters on the aggregated counts via `HAVING` (see
[content.py](routers/content.py)); the older boolean `has_media` still works
but `media` wins when both are sent.

**`unposted` = has a final cut but `status <> 'Posted'`** — the edit is
finished but it never went up on the channel. It is the only `media` value
that needs both halves: a WHERE on status *and* a HAVING on `final_count`.

`state.returnTo` (set by the router on every non-detail route) is the hash of
the last list visited. The detail page uses it for three things: the back
link's label and target, which tab stays lit in the top bar, and **which list
the ‹ › stepper walks** — opened from Deadlines it steps through
`deadlineList()`, not the library.

Downloads are named after the entry's **topic**, not the uploaded filename
(see `download_media` in [media.py](routers/media.py)): final → `Topic.mp4`,
raw → `Topic (raw).mp4`, numbered when a bucket holds more than one.

Three things read the filter state from outside the table:

- The dashboard's **⬆ To upload** stat tile (`statTile(…, 'unposted')`) is
  clickable and drills into that filter.

- The detail page's **🎬 All raw / All final** buttons set `filters.media`
  and jump to `#/library`.
- The detail page's **‹ n of m ›** stepper (`siblings()` in
  [detail.js](static/js/views/detail.js)) re-runs the same query the library
  ran, so ← / → walk the *currently filtered* list. If the open entry is not
  in that list it refetches unfiltered so the arrows never go dead.

## Frontend routing

Hash router in [app.js](static/js/app.js). Valid routes: `#/library`,
`#/library/deadlines`, `#/library/calendar`, `#/library/month`,
`#/library/dashboard`, `#/content/:id`, `#/weekly`, `#/money`.
**The dashboard is `#/library/dashboard`, not `#/dashboard`** — unknown
hashes are reset to `#/library`.

## Dashboard charts ([dashboard.js](static/js/views/dashboard.js))

Card builders, all fed by the one `/api/content` list:

- `barCard` — horizontal label|bar|count rows (Pipeline, Content type,
  Uploads by weekday).
- `footageCard` — "Footage bank": the funnel by *material* rather than status
  (Shot-not-cut / Cut-not-posted / Published) plus a line stating how much is
  editable without new filming. Built on `barCard`.
- `perfStackCard` — Performance by type: one stacked horizontal bar per
  type (Viral|Average|Failed segments), sorted by rated-video count, legend
  below. Status colours `#2fa568` / `#b98d18` / `#bd3454` are
  CVD-validated against the dark surface — don't swap them casually.
- `columnCard` — vertical columns (uploads per week histogram).
- `lineCard` — line/area/spline; renders an explanatory empty state until
  it has ≥ 2 points (a lone dot reads as broken).
- `statTile` — headline numbers; passing a `mediaFilter` makes the tile a
  clickable shortcut into the library (⬆ To upload does this).

Charts use the accent hue for single-series marks; only the performance
stack is multi-series and carries a legend.

**A card has to change a decision to stay.** The completion donut and the
weekday radar were removed on that test: a ratio that only ever climbs toward
100% is a status bar, and a radar is the slowest way to read seven numbers
(weekday is now plain bars off a shared baseline).

## Environment quirks

- Everything lives on an exFAT external SSD (partition label "SDCARD") —
  no symlinks, no venvs, permissions are faked.
- Chromium is a snap: it cannot read/write `/tmp` and headless CLI
  screenshots drop `#fragment` URLs mid-navigation. To screenshot a route,
  drive it over CDP (`--remote-debugging-port`, `Page.navigate`, wait,
  `Page.captureScreenshot`) and write output under `$HOME`.

Keep this file updated when structure, routes, or vocabularies change.
