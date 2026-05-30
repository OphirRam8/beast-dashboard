#!/usr/bin/env python3
"""Beast Dashboard backend — static files + Notion sync.

Endpoints:
  GET  /api/daily?date=YYYY-MM-DD        → {date, checks: {move: bool}}
  POST /api/daily                        → body {date, checks}
  GET  /api/weekly?week=YYYY-MM-DD       → {week, sessions: [...]}
  POST /api/weekly                       → body {week, sessions}

Notion sync upserts to two databases by data-source ID.
Token must be exported via env (or in ~/.beast-dashboard.env).

Falls back to local data/*.json files if Notion is misconfigured or offline.
"""
import json
import os
import tempfile
import threading
import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
DATA_DIR = ROOT / "data"
DAILY_FILE = DATA_DIR / "daily.json"
WEEKLY_FILE = DATA_DIR / "weekly.json"
PORT = int(os.environ.get("PORT", "4880"))

DATA_DIR.mkdir(parents=True, exist_ok=True)
for f in (DAILY_FILE, WEEKLY_FILE):
    if not f.exists():
        f.write_text("{}")

# ── Notion config ──────────────────────────────
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
ENV_FILE = Path.home() / ".beast-dashboard.env"
if not NOTION_TOKEN and ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("NOTION_TOKEN="):
            NOTION_TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

DAILY_DB_ID = "162397a7-cd1c-4602-b7b7-01df345dec56"
WEEKLY_DB_ID = "3fae1f24-9529-44f6-b50f-609930aac410"
ALPHI_DB_ID = os.environ.get("ALPHI_DB_ID", "").strip() or None  # set once DB exists
NOTION_VERSION = "2022-06-28"

# Read ALPHI_DB_ID from the env file too
if ALPHI_DB_ID is None and ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("ALPHI_DB_ID="):
            ALPHI_DB_ID = line.split("=", 1)[1].strip().strip('"').strip("'") or None
            break

# CORS — allow the GitHub Pages origin for the alphi-training frontend
ALPHI_CORS_ORIGINS = {"https://ophirram8.github.io"}

WRITE_LOCK = threading.Lock()


def notion_request(method, path, body=None):
    """Call Notion API. Returns parsed JSON or None on failure."""
    if not NOTION_TOKEN:
        return None
    url = f"https://api.notion.com/v1{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {NOTION_TOKEN}")
    req.add_header("Notion-Version", NOTION_VERSION)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[notion] HTTP {e.code} on {method} {path}: {e.read().decode('utf-8', errors='ignore')[:300]}")
        return None
    except Exception as e:
        print(f"[notion] {method} {path} failed: {e}")
        return None


# ── Local JSON helpers ─────────────────────────
def load_json(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def save_json(path, data):
    with WRITE_LOCK:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(DATA_DIR), delete=False, suffix=".tmp"
        ) as tmp:
            json.dump(data, tmp, ensure_ascii=False, indent=2)
            tmp_path = tmp.name
        os.replace(tmp_path, path)


# ── Notion upsert helpers ─────────────────────
DAILY_CHECK_PROPS = ["Hip CARs", "90/90", "Spinal Waves", "Bottom Squat", "Passive Hang", "Elephant Walks", "Burpees"]


def upsert_daily_to_notion(date, checks):
    """Find or create a row in Spartan Daily Log for `date`; update checkboxes."""
    if not NOTION_TOKEN:
        return
    # Search for existing page with this date
    q = notion_request(
        "POST",
        f"/databases/{DAILY_DB_ID}/query",
        {"filter": {"property": "Date", "date": {"equals": date}}, "page_size": 1},
    )
    props = {
        "Name": {"title": [{"text": {"content": date}}]},
        "Date": {"date": {"start": date}},
    }
    for k in DAILY_CHECK_PROPS:
        props[k] = {"checkbox": bool(checks.get(k))}

    if q and q.get("results"):
        page_id = q["results"][0]["id"]
        notion_request("PATCH", f"/pages/{page_id}", {"properties": props})
    else:
        notion_request("POST", "/pages", {"parent": {"database_id": DAILY_DB_ID}, "properties": props})


def fetch_daily_from_notion(date):
    """Return checks dict or None if not found."""
    if not NOTION_TOKEN:
        return None
    q = notion_request(
        "POST",
        f"/databases/{DAILY_DB_ID}/query",
        {"filter": {"property": "Date", "date": {"equals": date}}, "page_size": 1},
    )
    if not q or not q.get("results"):
        return None
    page = q["results"][0]
    props = page.get("properties", {})
    checks = {k: bool(props.get(k, {}).get("checkbox", False)) for k in DAILY_CHECK_PROPS}
    return checks


def sync_weekly_to_notion(week, sessions):
    """Replace all rows for this week with the given list. Simpler than diffing."""
    if not NOTION_TOKEN:
        return
    # Compute week date range
    import datetime as dt
    start = dt.date.fromisoformat(week)
    end = start + dt.timedelta(days=6)

    # Delete existing rows in this week
    q = notion_request(
        "POST",
        f"/databases/{WEEKLY_DB_ID}/query",
        {
            "filter": {
                "and": [
                    {"property": "Date", "date": {"on_or_after": start.isoformat()}},
                    {"property": "Date", "date": {"on_or_before": end.isoformat()}},
                ]
            },
            "page_size": 100,
        },
    )
    if q and q.get("results"):
        for page in q["results"]:
            notion_request("PATCH", f"/pages/{page['id']}", {"archived": True})

    # Create new rows
    for s in sessions:
        title = f"{s.get('date')} / {s.get('session')}"
        props = {
            "Name": {"title": [{"text": {"content": title}}]},
            "Date": {"date": {"start": s.get("date")}},
            "Session": {"select": {"name": s.get("session", "Bonus")}},
            "Tier": {"select": {"name": s.get("tier", "Standard")}},
            "Status": {"select": {"name": s.get("status", "Planned")}},
        }
        if s.get("notes"):
            props["Notes"] = {"rich_text": [{"text": {"content": s["notes"]}}]}
        notion_request("POST", "/pages", {"parent": {"database_id": WEEKLY_DB_ID}, "properties": props})


def upsert_alphi_day_to_notion(date, day_num, journal, exercises, total_reps, notes_text):
    """One row per (date) in the Alphi DB. Upsert by Date."""
    if not NOTION_TOKEN or not ALPHI_DB_ID:
        return False
    q = notion_request(
        "POST",
        f"/databases/{ALPHI_DB_ID}/query",
        {"filter": {"property": "Date", "date": {"equals": date}}, "page_size": 1},
    )
    props = {
        "Name": {"title": [{"text": {"content": f"Day {day_num} — {date}" if day_num else date}}]},
        "Date": {"date": {"start": date}},
    }
    if day_num is not None:
        props["Day #"] = {"number": day_num}
    if journal:
        props["Journal"] = {"rich_text": [{"text": {"content": journal[:1900]}}]}
    if exercises:
        props["Exercises Practiced"] = {"multi_select": [{"name": e[:100]} for e in exercises]}
    if total_reps is not None:
        props["Total Reps"] = {"number": total_reps}
    if notes_text:
        props["Notes"] = {"rich_text": [{"text": {"content": notes_text[:1900]}}]}

    if q and q.get("results"):
        page_id = q["results"][0]["id"]
        notion_request("PATCH", f"/pages/{page_id}", {"properties": props})
    else:
        notion_request("POST", "/pages", {"parent": {"database_id": ALPHI_DB_ID}, "properties": props})
    return True


def fetch_weekly_from_notion(week):
    if not NOTION_TOKEN:
        return None
    import datetime as dt
    start = dt.date.fromisoformat(week)
    end = start + dt.timedelta(days=6)
    q = notion_request(
        "POST",
        f"/databases/{WEEKLY_DB_ID}/query",
        {
            "filter": {
                "and": [
                    {"property": "Date", "date": {"on_or_after": start.isoformat()}},
                    {"property": "Date", "date": {"on_or_before": end.isoformat()}},
                ]
            },
            "sorts": [{"property": "Date", "direction": "ascending"}],
            "page_size": 50,
        },
    )
    if not q:
        return None
    sessions = []
    for page in q.get("results", []):
        props = page.get("properties", {})
        date_prop = props.get("Date", {}).get("date") or {}
        session_prop = (props.get("Session", {}).get("select") or {}).get("name")
        tier_prop = (props.get("Tier", {}).get("select") or {}).get("name", "Standard")
        status_prop = (props.get("Status", {}).get("select") or {}).get("name", "Planned")
        sessions.append({
            "date": date_prop.get("start"),
            "session": session_prop,
            "tier": tier_prop,
            "status": status_prop,
        })
    return sessions


# ── HTTP handler ──────────────────────────────
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass  # quiet; launchd captures stdout/stderr

    def _cors_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in ALPHI_CORS_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 1_000_000:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/daily":
            qs = urllib.parse.parse_qs(parsed.query)
            date = (qs.get("date") or [""])[0]
            if not date:
                self.send_error(400, "missing date")
                return
            # Try Notion first; fall back to local
            checks = fetch_daily_from_notion(date)
            if checks is None:
                local = load_json(DAILY_FILE)
                checks = local.get(date, {})
            self._send_json(200, {"date": date, "checks": checks})
            return
        if parsed.path == "/api/weekly":
            qs = urllib.parse.parse_qs(parsed.query)
            week = (qs.get("week") or [""])[0]
            if not week:
                self.send_error(400, "missing week")
                return
            sessions = fetch_weekly_from_notion(week)
            if sessions is None:
                local = load_json(WEEKLY_FILE)
                sessions = local.get(week, [])
            self._send_json(200, {"week": week, "sessions": sessions})
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/daily":
            body = self._read_json()
            if not body or "date" not in body:
                self.send_error(400, "bad body")
                return
            date = body["date"]
            checks = body.get("checks", {})
            # Save local
            local = load_json(DAILY_FILE)
            local[date] = checks
            save_json(DAILY_FILE, local)
            # Sync to Notion (best-effort, non-blocking is too risky for a tiny server; do inline)
            threading.Thread(target=upsert_daily_to_notion, args=(date, checks), daemon=True).start()
            self.send_response(204)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if self.path == "/api/weekly":
            body = self._read_json()
            if not body or "week" not in body:
                self.send_error(400, "bad body")
                return
            week = body["week"]
            sessions = body.get("sessions", [])
            local = load_json(WEEKLY_FILE)
            local[week] = sessions
            save_json(WEEKLY_FILE, local)
            threading.Thread(target=sync_weekly_to_notion, args=(week, sessions), daemon=True).start()
            self.send_response(204)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if self.path == "/api/alphi/sync":
            body = self._read_json()
            if not body:
                self.send_error(400, "bad body")
                return
            if not ALPHI_DB_ID:
                self._send_json(503, {"ok": False, "error": "ALPHI_DB_ID not configured"})
                return
            state = body.get("state") or {}
            labels = body.get("exerciseLabels") or {}
            start_date = state.get("startDate")
            logs = state.get("logs") or {}
            # Synchronous sync so the frontend gets an accurate count + errors surfaced
            synced = 0
            errors = 0
            for date in sorted(logs.keys()):
                log = logs[date] or {}
                counts = log.get("counts") or {}
                day_notes = log.get("notes") or {}
                journal = log.get("journal") or ""
                # Compute day number (1-indexed from startDate)
                day_num = None
                if start_date:
                    try:
                        import datetime as dt
                        delta = (dt.date.fromisoformat(date) - dt.date.fromisoformat(start_date)).days
                        day_num = delta + 1 if delta >= 0 else None
                    except Exception:
                        day_num = None
                exercises = [labels.get(eid, eid) for eid, c in counts.items() if (c or 0) > 0]
                total_reps = sum(int(c or 0) for c in counts.values())
                notes_parts = []
                for eid, n in day_notes.items():
                    if n and str(n).strip():
                        notes_parts.append(f"{labels.get(eid, eid)}: {str(n).strip()}")
                notes_text = " · ".join(notes_parts)
                if not (journal or exercises or total_reps or notes_text):
                    continue  # skip empty days
                try:
                    if upsert_alphi_day_to_notion(date, day_num, journal, exercises, total_reps, notes_text):
                        synced += 1
                    else:
                        errors += 1
                except Exception as e:
                    print(f"[alphi] sync failed for {date}: {e}")
                    errors += 1
            self._send_json(200, {"ok": True, "synced": synced, "errors": errors})
            return
        self.send_error(404, "Not Found")


if __name__ == "__main__":
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"beast-dashboard server on 127.0.0.1:{PORT}, NOTION_TOKEN set: {bool(NOTION_TOKEN)}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
