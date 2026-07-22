# Content Hub

A local, single-user content calendar and video library. Replaces the storage half
of Notion: your scripts, pipeline metadata **and the actual video files** live
together, with no 15MB upload cap.

Built for 200MB–1GB video files. Uploads stream straight to disk in constant
memory, and playback uses HTTP range requests so you can scrub a 500MB video
instantly instead of waiting for it to download.

---

## ⚠️ Read this first

### Linux only — Windows is not supported

This was built and tested **only on Ubuntu (26.04, Python 3.14)**. It has never been
run on Windows and is not expected to work there without changes:

- The launcher `run.sh` is a bash script. Windows has no equivalent out of the box.
- Paths, the mount layout, and the storage assumptions below are Linux-shaped.
- `ffprobe` is expected on `PATH` for video duration (optional, but assumed present).

The Python itself uses `pathlib` and is mostly portable, so a determined person
could adapt it — but **no Windows support is offered, and none of it is tested.**
macOS is equally untested.

### It expects a second drive

This app is designed to keep the database and your video files together on a
**separate storage drive**, not your system drive. The project folder is meant to
live on that drive, so `media/` and `content_hub.db` sit beside the code.

Specifically, this was developed against:

- A **256 GB SATA SSD in a USB enclosure**, formatted **exFAT**, auto-mounted by
  udisks at `/run/media/$USER/<LABEL>/`.

You do not need that exact setup — point `MEDIA_ROOT` anywhere via `.env` — but be
aware of two consequences of running from an exFAT drive:

1. **No virtualenv is possible.** exFAT has no symlinks, and `python -m venv` must
   create a `lib64 → lib` symlink. It fails partway and leaves a venv with no
   `bin/` directory. That is why dependencies install into `./libs` and `run.sh`
   sets `PYTHONPATH` instead. On ext4 you can use a normal venv.
2. **exFAT has no journal.** If the drive is unplugged mid-write, SQLite has weaker
   protection than it would on ext4. **Eject the drive properly.** If you can
   dedicate the drive to Linux, ext4 is the safer filesystem.

### No authentication

There is no login. The server binds to `127.0.0.1` only and is meant to be reached
from the machine it runs on. **Do not expose it to a network or the internet** —
anyone who can reach it can read, edit and delete everything, and download your
video files.

### Back up your own data

`media/` and `content_hub.db` are **not** in version control (see `.gitignore`),
which is deliberate — your videos and content plans do not belong in a Git repo.
That also means cloning this repo backs up **none of your actual content**. See
[Backups](#backups).

---

## Quick start

Everything is already installed. Just run:

```bash
cd "/run/media/shivam-karlspace/SDCARD/Content Calendar"
./run.sh
```

Open **http://127.0.0.1:8000**

The database and `media/` folder are created automatically on first run. There is
no login — the server binds to loopback only and is reachable from this machine alone.

To stop it: `Ctrl+C`. While editing the code: `./run.sh --reload`.
On a different port: `PORT=8001 ./run.sh`.

### Reinstalling dependencies

```bash
python3 -m pip install --target ./libs -r requirements.txt
```

**Why `./libs` and not a `.venv`:** this drive is exFAT, which has no symlink
support, and `python -m venv` must create a `lib64 → lib` symlink — it fails
partway and leaves a venv with no `bin/` directory. Installing to a plain folder
and pointing `PYTHONPATH` at it (which `run.sh` does) gives the same isolation
from system packages with no symlinks involved. It also sidesteps PEP 668, which
blocks installing into Ubuntu's system Python.

If you ever reformat this drive to ext4, a normal `python3 -m venv .venv` will
work and you can delete `libs/`. Formatting **erases the whole drive**, so copy
this folder somewhere else first.

---

## Configuration

All settings live in `.env` (copy it from `.env.example`). Relative paths resolve
against the project folder, **not** your shell's working directory, so
`uvicorn main:app` behaves the same no matter where you launch it from.

| Variable | Default | What it does |
|---|---|---|
| `MEDIA_ROOT` | `media` | Where video files are stored |
| `DB_PATH` | `content_hub.db` | SQLite database file |
| `HOST` | `127.0.0.1` | Bind address — leave on loopback, there is no auth |
| `PORT` | `8000` | Port |
| `UPLOAD_CHUNK_SIZE` | `1048576` | Bytes read per write (1 MiB) |
| `MAX_UPLOAD_BYTES` | `5368709120` | Max upload size (5 GB). `0` disables the limit |

### Pointing media at a different drive

Because the project folder already lives on your storage SSD, the default
`MEDIA_ROOT=media` puts videos on that drive with no absolute path to maintain.
To store them elsewhere, use an absolute path:

```ini
MEDIA_ROOT=/mnt/otherdrive/content-media
```

Only the path **relative** to `MEDIA_ROOT` is stored in the database, so you can
move the media folder later and just update this one setting — nothing breaks.

---

## The two sections

### Weekly Template
A fixed Monday-to-Sunday production format: Day, Format, Content Idea, Topic,
Assigned to, Editor deadline. Seven rows, always — it is a repeating pattern, not
a dated schedule, so rows are never added or removed. Today's row is highlighted.
Every cell edits in place and saves when you leave it. The Format and Content Idea
fields offer your usual values as suggestions but accept any text.

### Content Library
Every piece of content. Note the two name fields:

- **Topic** — your internal working name, shown as the big heading. This is what
  you scan the table by.
- **Title** — the published/video title, kept separate so you can write the real
  headline without losing the working name. Search matches both.

Four views in a tab bar:

- **Table** (default) — all entries, sortable by any column, fully inline-editable.
- **Board** — kanban grouped by Status. Drag a card to another column to change it.
- **Calendar** — month grid placing entries on their Upload date. Opens on the
  current month and follows the real date automatically; `‹ › Today` to navigate.
- **This Month** — the same entries as a filtered list, also defaulting to the
  current month, with a picker to jump to any other.

Search from the top bar — it matches both Topic and Title. Press `/` to focus it,
`Esc` to clear.

### Colour coding
Matches Notion: Idea grey · Scripting yellow · Editing orange · Ready blue ·
Posted green · Failed red. Performance: Viral green · Average orange · Failed red.

---

## Detail page

Click any entry to open it. Every field is editable, the script gets a full-height
text area, and both video buckets get real players.

- **Uploads** — click Upload or drag files onto the drop zone. A progress bar shows
  percentage and MB transferred, and each upload can be cancelled mid-flight.
- **Playback** — videos stream with range support, so seeking is instant.
- **Delete a video** — removes the file from the media folder *and* the database row.
- **Delete an entry** — asks for confirmation naming how many video files will go,
  then removes the entry and its whole `media/{id}/` folder.

Text fields save when you click away. `Ctrl+S` also saves while in a text area.

---

## How files are organised

```
media/
└── 12/                          <- content entry id
    ├── raw/
    │   ├── b-roll.mp4
    │   └── b-roll (2).mp4       <- same name uploaded twice, never overwritten
    └── final/
        └── final cut.mp4
```

Uploading the same filename twice suffixes it rather than clobbering the original.
Filenames are sanitised, and a second independent check confirms the resolved path
stays inside `MEDIA_ROOT`, so a crafted filename cannot write outside the media folder.

---

## Why some choices were made

**Uploads use the raw request body, not `multipart/form-data`.** FastAPI's
`UploadFile` is backed by a `SpooledTemporaryFile` that rolls over into the system
temp directory. On this machine `/tmp` is **tmpfs (RAM-backed)**, so a 1GB upload
would have consumed 1GB of RAM and then been copied a second time onto the SSD.
Streaming `request.stream()` writes directly to the destination in 1 MiB chunks.
Measured on a 500MB upload: server memory grew **0 MB**, `/tmp` grew **0 MB**, and
the stored file's SHA-256 matched the source exactly.

**Uploads land in a `.part` file and are renamed on completion.** A rename is
atomic, so an interrupted transfer cannot leave a truncated file that looks
playable — which matters when a bad 500MB file is otherwise indistinguishable
from a good one.

**Playback uses Starlette's `FileResponse`**, which implements range requests
natively (206, `Content-Range`, 416) and serves via `sendfile()`. Seeking to byte
524,188,000 of a 500MB file measured **7ms**.

**The frontend uses `XMLHttpRequest` for uploads** even though `fetch()` is used
everywhere else, because `fetch` has no upload-progress event — a 500MB upload
would otherwise sit at 0% with no feedback until it finished.

**Plain `sqlite3`, no ORM.** Three tables do not justify SQLAlchemy, and raw SQL
means no hidden behaviour when you extend the schema.

---

## Project layout

```
main.py           FastAPI app, startup, static mount, SPA fallback
config.py         .env loading and path resolution
database.py       schema, connection pragmas, weekday seeding
models.py         Pydantic schemas — the select-field vocabularies live here
storage.py        all filesystem rules: sanitising, containment, deletion
routers/
  weekly.py       weekly template
  content.py      library CRUD, search, month filter, sorting
  media.py        streaming upload, range playback, delete
static/
  index.html      the whole page shell
  css/style.css   design tokens at the top; chip colours in section 3
  js/api.js       every network call
  js/ui.js        DOM helpers, formatting, chips, toasts, dialogs
  js/app.js       hash router and shared state
  js/views/*.js   one module per view
test_backend.py   end-to-end API tests
```

---

## Extending it

**Add a Status value:** add it to `STATUSES` in `models.py`, to `STATUSES` in
`static/js/ui.js`, and give it a `.chip-<colour>` rule in `style.css`. No database
migration needed — statuses are stored as plain text and validated in Pydantic.

**Add a field to content:** add the column to the `content` table in `database.py`,
add it to `ContentCreate`/`ContentUpdate`/`Content` in `models.py`, then render it
in `static/js/views/detail.js`. For an existing database, bump `SCHEMA_VERSION` and
add an `ALTER TABLE` in `_migrate()`.

**Interactive API docs** are at http://127.0.0.1:8000/docs while the app runs.

---

## Tests

```bash
source .venv/bin/activate
python test_backend.py
```

Runs 58 checks against a throwaway database and media folder (created and deleted
under `_testrun/`, never touching real data): CRUD, search and `LIKE` escaping,
month filtering, uploads, filename collisions, path-traversal rejection, range
requests including mid-file and suffix ranges, 416 handling, and cascade deletion.

---

## Backups

The database is a single file. To back it up while the app is running, use SQLite's
online backup rather than copying the file directly:

```bash
sqlite3 content_hub.db ".backup 'content_hub-backup.db'"
```

Your videos are ordinary files under `media/` — copy that folder however you like.

---

## Troubleshooting

**`externally-managed-environment` from pip** — you are outside the venv. Run
`source .venv/bin/activate` first.

**Port already in use** — `PORT=8001 uvicorn main:app`, or find the offender with
`ss -ltnp 'sport = :8000'`.

**A video shows "File missing from disk"** — the file was moved or deleted outside
the app. Delete the entry's video row and re-upload.

**Video will not play** — the browser may not support the codec even though the
file uploaded fine. `.mp4` (H.264) is the safest bet; `.mkv` often will not play in
Chrome. The Download button always gives you the original file.

**Upload rejected as unsupported** — extend `ALLOWED_VIDEO_EXTENSIONS` in `config.py`.
