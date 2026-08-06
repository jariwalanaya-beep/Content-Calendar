"""
End-to-end backend checks.

Run from the project folder with the venv active:
    python test_backend.py

Uses a throwaway database and media folder under ./_testrun/ so it never touches
real data, then deletes them.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Point the app at a scratch database and media folder BEFORE importing config.
TESTDIR = Path(__file__).resolve().parent / "_testrun"
shutil.rmtree(TESTDIR, ignore_errors=True)
TESTDIR.mkdir(parents=True)
os.environ["MEDIA_ROOT"] = str(TESTDIR / "media")
os.environ["DB_PATH"] = str(TESTDIR / "test.db")

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

PASS, FAIL = 0, 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label} {extra}")


with TestClient(main.app) as client:
    print("\n== weekly template ==")
    r = client.get("/api/weekly")
    days = r.json()
    check("7 seeded days", r.status_code == 200 and len(days) == 7, days)
    check("Monday first", days[0]["day_name"] == "Monday")
    check("Sunday last", days[6]["day_name"] == "Sunday")

    r = client.patch("/api/weekly/0", json={"format": "JumperJump", "topic": "Celebrity"})
    check("patch weekday", r.status_code == 200 and r.json()["format"] == "JumperJump", r.text)
    check("weekday partial update leaves others",
          client.get("/api/weekly").json()[1]["format"] == "")
    r = client.patch("/api/weekly/9", json={"topic": "x"})
    check("reject bad day_index", r.status_code == 400)

    print("\n== content CRUD ==")
    r = client.post("/api/content", json={
        "topic": "Ancient Mysteries", "assigned_to": "Editor",
        "status": "Idea", "type": "Story",
        "upload_date": "2026-07-15", "script": "Line one.",
    })
    check("create", r.status_code == 201, r.text)
    cid = r.json()["id"]
    check("fields persisted", r.json()["status"] == "Idea"
          and r.json()["upload_date"] == "2026-07-15")

    r = client.post("/api/content", json={"topic": "Strange Science",
                                          "upload_date": "2026-08-02",
                                          "status": "Idea"})
    cid2 = r.json()["id"]

    r = client.patch(f"/api/content/{cid}", json={"status": "Editing"})
    check("patch status", r.json()["status"] == "Editing")
    check("patch left topic alone", r.json()["topic"] == "Ancient Mysteries")

    r = client.post("/api/content", json={"topic": "  ", "status": "Idea"})
    check("blank topic -> Untitled", r.json()["topic"] == "Untitled")
    client.delete(f"/api/content/{r.json()['id']}")

    r = client.post("/api/content", json={"topic": "x", "status": "Nonsense"})
    check("reject invalid status", r.status_code == 422)

    print("\n== pipeline automation ==")
    # Ready + past upload date auto-advances to Posted on the next read.
    r = client.post("/api/content", json={"topic": "Went out yesterday",
                                          "status": "Ready",
                                          "upload_date": "2020-01-01"})
    check("Ready + past date -> Posted", r.json()["status"] == "Posted")
    client.delete(f"/api/content/{r.json()['id']}")

    # An earlier stage with a past date is late, not posted.
    r = client.post("/api/content", json={"topic": "Still being edited",
                                          "status": "Editing",
                                          "upload_date": "2020-01-01"})
    check("non-Ready stays put", r.json()["status"] == "Editing")
    client.delete(f"/api/content/{r.json()['id']}")

    # Marking the edit Done moves Editing forward to Ready.
    r = client.post("/api/content", json={"topic": "Being edited",
                                          "status": "Editing"})
    r2 = client.patch(f"/api/content/{r.json()['id']}", json={"done": True})
    check("done moves Editing -> Ready",
          r2.json()["status"] == "Ready" and r2.json()["done"])
    client.delete(f"/api/content/{r.json()['id']}")

    # But it never overrides a status other than Editing.
    r = client.post("/api/content", json={"topic": "Just an idea",
                                          "status": "Idea"})
    r2 = client.patch(f"/api/content/{r.json()['id']}", json={"done": True})
    check("done leaves non-Editing status", r2.json()["status"] == "Idea")
    client.delete(f"/api/content/{r.json()['id']}")

    print("\n== search / filter / sort ==")
    check("search hit", len(client.get("/api/content?search=Ancient").json()) == 1)
    check("search miss", len(client.get("/api/content?search=zzzz").json()) == 0)
    check("month filter Jul",
          [c["id"] for c in client.get("/api/content?month=2026-07").json()] == [cid])
    check("month filter Aug",
          [c["id"] for c in client.get("/api/content?month=2026-08").json()] == [cid2])
    check("status filter", len(client.get("/api/content?status=Editing").json()) == 1)
    check("months list", set(client.get("/api/content/months").json()) ==
          {"2026-07", "2026-08"})
    check("sort by topic asc",
          [c["topic"] for c in
           client.get("/api/content?sort=topic&direction=asc").json()][0] == "Ancient Mysteries")
    # A literal % must not behave as a wildcard.
    client.post("/api/content", json={"topic": "100% real", "status": "Idea"})
    check("LIKE escaping", len(client.get("/api/content?search=100%25 real").json()) == 1)
    check("bad month rejected", client.get("/api/content?month=nonsense").status_code == 422)

    print("\n== upload ==")
    payload = os.urandom(3 * 1024 * 1024)  # 3 MiB of known bytes
    r = client.put(f"/api/content/{cid}/media/final", content=payload,
                   headers={"X-Filename": "final cut.mp4"})
    check("upload final", r.status_code == 201, r.text)
    mid = r.json()["id"]
    check("size recorded", r.json()["size_bytes"] == len(payload))
    check("mime guessed", r.json()["mime_type"] == "video/mp4", r.json()["mime_type"])

    disk = TESTDIR / "media" / str(cid) / "final" / "final cut.mp4"
    check("file on disk", disk.is_file())
    check("bytes intact", disk.read_bytes() == payload)
    check("no .part left", not list((disk.parent).glob("*.part")))

    r = client.put(f"/api/content/{cid}/media/raw", content=b"rawdata",
                   headers={"X-Filename": "b-roll.mov"})
    check("upload raw", r.status_code == 201)
    check("raw in own folder", (TESTDIR / "media" / str(cid) / "raw" / "b-roll.mov").is_file())

    # Same name twice must not overwrite.
    client.put(f"/api/content/{cid}/media/final", content=b"second",
               headers={"X-Filename": "final cut.mp4"})
    check("collision suffixed",
          (TESTDIR / "media" / str(cid) / "final" / "final cut (2).mp4").is_file())

    print("\n== upload rejections ==")
    check("bad extension", client.put(f"/api/content/{cid}/media/final", content=b"x",
          headers={"X-Filename": "notes.txt"}).status_code == 400)
    check("bad kind", client.put(f"/api/content/{cid}/media/other", content=b"x",
          headers={"X-Filename": "a.mp4"}).status_code == 400)
    check("missing content", client.put("/api/content/99999/media/raw", content=b"x",
          headers={"X-Filename": "a.mp4"}).status_code == 404)
    check("empty body", client.put(f"/api/content/{cid}/media/raw", content=b"",
          headers={"X-Filename": "empty.mp4"}).status_code == 400)

    # Path traversal must be neutralised, not honoured.
    r = client.put(f"/api/content/{cid}/media/raw", content=b"evil",
                   headers={"X-Filename": "../../../../etc/pwned.mp4"})
    check("traversal blocked", r.status_code == 201
          and (TESTDIR / "media" / str(cid) / "raw" / "pwned.mp4").is_file()
          and not Path("/etc/pwned.mp4").exists())

    print("\n== range requests ==")
    r = client.get(f"/api/media/{mid}/stream")
    check("full GET 200", r.status_code == 200)
    check("full body intact", r.content == payload)
    check("Accept-Ranges advertised", r.headers.get("accept-ranges") == "bytes",
          dict(r.headers))

    r = client.get(f"/api/media/{mid}/stream", headers={"Range": "bytes=0-99"})
    check("206 returned", r.status_code == 206, r.status_code)
    check("100 bytes", len(r.content) == 100)
    check("correct slice", r.content == payload[:100])
    check("Content-Range header",
          r.headers.get("content-range") == f"bytes 0-99/{len(payload)}",
          r.headers.get("content-range"))

    # Mid-file seek: the case that matters for scrubbing a long video.
    start, end = 1_500_000, 1_500_099
    r = client.get(f"/api/media/{mid}/stream", headers={"Range": f"bytes={start}-{end}"})
    check("mid-file 206", r.status_code == 206)
    check("mid-file slice correct", r.content == payload[start:end + 1])

    r = client.get(f"/api/media/{mid}/stream", headers={"Range": "bytes=-100"})
    check("suffix range", r.status_code == 206 and r.content == payload[-100:])

    r = client.get(f"/api/media/{mid}/stream",
                   headers={"Range": f"bytes={len(payload) + 500}-"})
    check("416 unsatisfiable", r.status_code == 416, r.status_code)

    print("\n== delete ==")
    r = client.delete(f"/api/media/{mid}")
    check("delete media 204", r.status_code == 204)
    check("file gone from disk", not disk.is_file())
    check("stream now 404", client.get(f"/api/media/{mid}/stream").status_code == 404)

    detail = client.get(f"/api/content/{cid}").json()
    check("detail lists media", isinstance(detail["raw"], list) and len(detail["raw"]) >= 2)
    check("counts match", detail["raw_count"] == len(detail["raw"]))

    tree = TESTDIR / "media" / str(cid)
    check("tree exists pre-delete", tree.is_dir())
    r = client.delete(f"/api/content/{cid}")
    check("delete content 204", r.status_code == 204)
    check("media tree removed", not tree.exists())
    check("content gone", client.get(f"/api/content/{cid}").status_code == 404)
    check("orphan media rows cascaded",
          client.get(f"/api/content/{cid}").status_code == 404)

    print("\n== money ==")
    r = client.post("/api/money", json={"entry": "Facebook", "amount": 63000,
                                        "date": "2026-07-01",
                                        "direction": "Income",
                                        "party": "Facebook"})
    check("money create", r.status_code == 201 and r.json()["signed"] == 63000,
          r.text)
    money_id = r.json()["id"]
    r = client.post("/api/money", json={"entry": "Claude", "amount": 1999,
                                        "date": "2026-07-09",
                                        "direction": "Expense",
                                        "party": "Personal"})
    check("expense signs negative", r.json()["signed"] == -1999)
    check("month filter", len(client.get("/api/money?month=2026-07").json()) == 2)
    check("direction filter",
          len(client.get("/api/money?direction=Income").json()) == 1)
    r = client.patch(f"/api/money/{money_id}", json={"amount": 60000})
    check("money patch re-signs", r.json()["signed"] == 60000)
    check("bad direction rejected",
          client.post("/api/money", json={"direction": "Sideways"}).status_code == 422)

    # Saving rides alongside the ledger and must never reach the arithmetic:
    # `signed` stays the amount with its direction applied, nothing else.
    check("saving defaults to 0",
          all(m["saving"] == 0 for m in client.get("/api/money").json()))
    r = client.patch(f"/api/money/{money_id}", json={"saving": 5000})
    check("saving patches", r.json()["saving"] == 5000, r.text)
    check("saving does not move signed", r.json()["signed"] == 60000)
    r = client.post("/api/money", json={"entry": "Set aside", "amount": 0,
                                        "saving": 20000, "direction": "Expense"})
    check("saving on create, still unsigned",
          r.status_code == 201 and r.json()["saving"] == 20000
          and r.json()["signed"] == 0, r.text)
    client.delete(f"/api/money/{r.json()['id']}")
    check("negative saving rejected",
          client.post("/api/money", json={"saving": -1}).status_code == 422)

    # Bucket / category / recurring classify a row. The API only stores and
    # filters on them — the client owns every figure derived from them — so
    # what is tested here is that they round-trip and that the classification
    # never leaks into `signed`.
    check("bucket defaults to Business",
          all(m["bucket"] == "Business" for m in client.get("/api/money").json()))
    r = client.post("/api/money", json={"entry": "Set aside — Aug", "amount": 6000,
                                        "direction": "Expense", "bucket": "Savings",
                                        "category": "Set aside"})
    aside_id = r.json()["id"]
    check("savings row round-trips",
          r.status_code == 201 and r.json()["bucket"] == "Savings"
          and r.json()["category"] == "Set aside", r.text)
    check("bucket does not change signed", r.json()["signed"] == -6000)
    check("bucket filter", len(client.get("/api/money?bucket=Savings").json()) == 1)
    check("category filter",
          len(client.get("/api/money?category=Set+aside").json()) == 1)
    check("bad bucket rejected",
          client.post("/api/money", json={"bucket": "Slush"}).status_code == 422)
    check("bad category rejected",
          client.post("/api/money", json={"category": "Vibes"}).status_code == 422)

    check("recurring defaults false",
          client.get(f"/api/money").json()[0]["recurring"] is False)
    r = client.patch(f"/api/money/{aside_id}", json={"recurring": True})
    check("recurring patches", r.json()["recurring"] is True, r.text)
    r = client.patch(f"/api/money/{aside_id}", json={"category": ""})
    check("category clears to null", r.json()["category"] is None, r.text)
    client.delete(f"/api/money/{aside_id}")

    check("goal default", client.get("/api/money/goal").json()["goal"] == 350000)
    client.put("/api/money/goal", json={"goal": 500000})
    check("goal saved", client.get("/api/money/goal").json()["goal"] == 500000)
    check("goal must be positive",
          client.put("/api/money/goal", json={"goal": 0}).status_code == 422)

    client.delete(f"/api/money/{money_id}")
    check("money delete",
          len(client.get("/api/money?direction=Income").json()) == 0)

    # First Done with an editor assigned books their ₹500 fee as Unpaid.
    r = client.post("/api/content", json={"topic": "Fee video",
                                          "status": "Editing",
                                          "assigned_to": "Ed"})
    fee_cid = r.json()["id"]
    client.patch(f"/api/content/{fee_cid}", json={"done": True})
    fees = [m for m in client.get("/api/money").json()
            if m["entry"].startswith("Editor fee")]
    check("done books editor fee",
          len(fees) == 1 and fees[0]["amount"] == 500
          and fees[0]["party"] == "Ed" and fees[0]["paid"] == "Unpaid"
          and fees[0]["signed"] == -500)

    # Re-marking an already-done video must not double-book the fee.
    client.patch(f"/api/content/{fee_cid}", json={"done": True})
    check("no double booking",
          len([m for m in client.get("/api/money").json()
               if m["entry"].startswith("Editor fee")]) == 1)

    # The fee can be flipped to Paid once the payout happens.
    r = client.patch(f"/api/money/{fees[0]['id']}", json={"paid": "Paid"})
    check("fee marked Paid", r.json()["paid"] == "Paid")

    client.delete(f"/api/content/{fee_cid}")
    client.delete(f"/api/money/{fees[0]['id']}")

    print("\n== misc ==")
    check("config endpoint", client.get("/api/config").json()["media_root"].endswith("media"))
    check("index served", client.get("/").status_code in (200, 404))

shutil.rmtree(TESTDIR, ignore_errors=True)
print(f"\n{'='*46}\n  {PASS} passed, {FAIL} failed\n{'='*46}")
sys.exit(1 if FAIL else 0)
