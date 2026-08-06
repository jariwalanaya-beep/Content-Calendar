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

The `color` field is a **tone name, not a hue**. Four of the six are rungs of
the grey ramp, quiet → loud: `n` (track fill), `t1` (tint), `t2` (solid mid),
`t3` (light accent fill with page-dark ink); only `warn` (amber) and `bad`
(red) are coloured. Six tones total — adding a vocabulary value means picking
one of them, not inventing a colour.

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

## Design language — "graphite glass"

The page is a near-black cool grey. Four rules:

- The page is **graphite**, painted once by `--page-bg` (a fixed diagonal
  gradient). Nothing else sets a page background.
- **Every panel is one material**: `--glass` (translucent graphite gradient)
  over `backdrop-filter: blur(60px)` with a 1px cool-white rim at ~9%.
  Applied by the shared selector list in **section 5, which is last in the
  file on purpose** so it beats the per-component `background` declarations —
  those remain the opaque fallback. Add a new card by adding its class to
  that list.
- Radii are generous: 20px cards, 15px controls, 12px inner.
- **The accent is a light grey (`--accent`, `#c3ccd4`), not a hue.** Because
  it is grey it cannot carry "active" on its own — an accent-filled bar and a
  normal bar would read the same — so it is confined to thin focus rings, the
  active nav tile, and single-series chart marks. The **three status colours
  carry every meaningful highlight**, and they are the only real colour on
  the page, which is exactly why the amber "to upload" tile and the red
  "failed" bars land as hard as they do.

Anything filled with the accent takes `--on-accent` (`#0d0f11`, the page
dark) as ink, never white.

Floating surfaces (`.dd-panel`, `.dialog`, `.preview`, `.toast`) override the
recipe with a near-opaque fill: they sit over *content*, and the card's 49%
stop lets the table read straight through.

## The graphite palette ([style.css](static/css/style.css) section 1)

The supplied palette is the **source of truth** at the top of `:root`, under
its own names (`--panel`, `--nested`, `--track`, `--fill`, `--icon-bg`,
`--good`/`--warn-c`/`--bad`…). Everything below it — the `--f-*` ramp, the
surface/text/accent aliases, the glass gradients — is an alias or a mix of
those values, so a re-theme is one block.

Note the two-name collisions kept deliberately: the palette's `--bg` is
`--graphite-bg` (the semantic `--bg` still points at it), its `--border` /
`--border-2` are `--border-1` / `--border-2` (feeding `--border` and
`--border-strong`), and its `--warn` is `--warn-c` (the semantic `--warn`
still points at it). Borders use the `#bec8d217` 8-digit form — the last two
digits are alpha, so that is `rgba(190,200,210,.09)`.

The `--f-*` ramp is the palette laid out as one ordinal ladder, floor
(`--f-950`) → ink (`--f-050`), so chip tones and surface layers index into it
by position. Only `--f-600` (`#272d33`, hover/active fill) is derived: it has
to sit clearly above the track or hover reads as nothing.

Surfaces skip a rung where two steps would be invisibly close — page →
chrome → card, then inputs/tracks cut back *down* to `--f-650` so a field
reads as a hole in the card rather than another card.

Text is three rungs and no more: `--text` `#e6eaee`, `--text-muted`
`#a3adb5`, `--text-faint` `#6b757d`. Nothing quieter carries a word the user
has to read.

Chip tones are four rungs of the same grey ladder, not four hues:
`n` (track fill) → `t1` (tint) → `t2` (`--fill-soft` solid) → `t3` (the light
accent with page-dark ink), plus `warn` and `bad` which are the only coloured
chips.

⚠ **`--good` `#57c98a` / `--warn-c` `#e8b05a` / `--bad` `#e2707f` are fixed
across any theme** and are the only saturated colour in the app. `--chart-*`
are simply aliases of them — on graphite nothing competes with them, so no
separate large-area trio is needed. Never use them decoratively, and never
add a fourth.

## Deadlines view ([deadlines.js](static/js/views/deadlines.js))

Card rows (`.deadline-card`), **not a table** — a grid per assignment with a
6px urgency-coloured edge bar, topic + editable date stacked, then assignee,
due badge, status, actions. Each row has a **⬆ Final** button that uploads
the finished cut straight to that entry's `final` media bucket (via
`api.uploadMedia`, progress shown on the button), then **✓ Done** clears the
row. The button label carries the existing final-video count
(`⬆ Final · 2`). Done only sets `done = 1` — it never deletes anything.

## Money ledger ([money.js](static/js/views/money.js), [money.py](routers/money.py))

One table of Income/Expense rows read as a **business**, not as a list.
Amount is always positive; `direction` signs it into `signed`. Three columns
classify a row, and every figure on the page falls out of that
classification:

| column | values | what it decides |
|---|---|---|
| `bucket` | Business / Personal / Savings | **only Business reaches revenue, cost, net, margin** |
| `category` | `MoneyCategory` in [models.py](models.py) | every breakdown, and cost-per-video |
| `recurring` | bool | the Fixed monthly costs rollup |

**The production pair is `Editor fee` + `Clipper fee`.** They scale with how
much you post, so they alone divide into cost-per-video; every other expense
is *overhead*, owed whether you post or not. `net = revenue − production −
overhead`, over Business rows only.

⚠ The API stores and filters these three columns and **owns none of the
definitions** — revenue, production, overhead, margin, cost-per-video, I owe
/ owed to me are all derived in `metrics()` in
[money.js](static/js/views/money.js). Change a rule there, once.

⚠ **Personal and Savings rows are held out of the business arithmetic**, and
`saving` stays outside it too: no ledger total picks it up, the sum row's
Saving cell is deliberately blank, and it never folds into `signed`. Booking
either as a Business expense was the old workaround and it wrongly dragged
Net down. Picking the `Set aside` or `Personal` category **re-files the row's
bucket automatically** (`CATEGORY_BUCKET`) so that mistake cannot be made by
hand. The Saved and Personal tiles are toned to `--text-muted`
(`.stat-aside-v`) — a figure that feeds no other total should not compete
with one that does.

The goal bar tracks **either** all-time Net profit **or** all-time Saved,
switched by the two `.goal-mode` buttons; they answer different questions, so
the bar names the one it is showing.

Charts spend the colour budget deliberately: revenue `--good`, the production
pair `--bad`, and **overhead is grey** (`--fill-soft`) — a third hue there
would spend the whole page's colour on a legend. The spend donut is *ranked*,
so it shades down the grey ramp (`.donut-0` … `.donut-5`) rather than taking
six hues.

CSV export writes the filtered slice; **import ADDS rows and never clears the
ledger** — a bad file should cost an undo, not the history.

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
  below. Segments use the fixed status trio `--chart-good/warn/bad`
  (`#57c98a` / `#e8b05a` / `#e2707f`) — the only colour on a grey page, so
  don't swap them casually.
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
