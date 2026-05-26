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

DAILY_DB_ID = "a1fa0026-8926-4110-ae76-637230f45023"
WEEKLY_DB_ID = "8aa0a203-2768-4331-a30c-e9fc6a118598"
NOTION_VERSION = "2022-06-28"

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
DAILY_CHECK_PROPS = ["Hip CARs", "90/90", "Spinal Waves", "Bottom Squat", "Passive Hang", "Elephant Walks"]


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

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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
        self.send_error(404, "Not Found")


if __name__ == "__main__":
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"beast-dashboard server on 127.0.0.1:{PORT}, NOTION_TOKEN set: {bool(NOTION_TOKEN)}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
