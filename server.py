#!/usr/bin/env python3
"""Lattice Vault UI v3 — salt-okunur yerel arayüz. Python stdlib only.

Usage: python3 server.py --db PATH [--port 8766]   (or VAULT_DB=PATH)
- Binds 127.0.0.1 only. The DB is opened per request with SQLite URI mode=ro (event_detail.open_ro from core);
  vault.connect() is never called (it writes). No write endpoints: every POST/PUT/DELETE -> 405.
- Payloads are NEVER decrypted (same as core `vault show`): encrypted fields -> [encrypted], redacted -> [redacted],
  secret-looking strings -> [filtered:...]. Reuses core event_detail.detail / safe_payload and vault.search.
"""
import argparse, contextlib, json, os, re, sqlite3, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vaultsrc import VAULT_SRC  # noqa: E402,F401
import vault, event_detail  # noqa: E402

STATIC = os.path.join(HERE, "static")
CTYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
MAX_LIMIT = 200
STATUSES = ("proposed", "active", "rejected", "reverted", "redacted")
# Bellekler hides review/meta events and corrections (corrections appear as lineage in the detail pane).
HIDDEN_TYPES = tuple(vault.META_TYPES) + ("event.corrected",)
TYPE_TR = {"preference": "tercih", "decision": "karar", "project": "proje", "goal": "hedef",
           "learning": "öğrenme", "event": "olay", "user": "kullanıcı", "batch": "toplu", "import": "içe aktarım",
           "subject": "konu", "conflict": "çakışma"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE = re.compile(r"^[0-9a-f-]{6,64}$")


class BadRequest(ValueError):
    pass


def open_ro(path):
    return event_detail.open_ro(path)


def short_text(payload, n=160):
    if isinstance(payload, str):
        return payload
    parts = []

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif o is not None:
            parts.append(str(o))
    if isinstance(payload, dict):
        lead = [k for k in ("text", "value", "decision", "title", "new_value") if isinstance(payload.get(k), str)]
        for k in lead:
            parts.append(payload[k])
        walk({k: v for k, v in payload.items() if k not in lead and k != "sources"})
    else:
        walk(payload)
    s = " · ".join(parts)
    return s if len(s) <= n else s[: n - 1] + "…"


def corrected_ids(db):
    """Events superseded by a live (active) successor -> Düzeltildi."""
    return {r[0] for r in db.execute(
        "SELECT p.parent_id FROM event_parents p JOIN proj_status s ON s.event_id=p.event_id "
        "WHERE p.rel='supersedes' AND s.status='active'")}


def label(status, actor, decided_by, corrected):
    """Map core status to the approved Turkish vocabulary. 'Doğrulandı' is never used: approvals are unsigned."""
    if status == "redacted":
        return "redacted", "İmha edildi"
    if status == "rejected":
        return "rejected", "Reddedildi"
    if status == "reverted":
        return "reverted", "Geri alındı"
    if status == "proposed":
        return "proposed", "Önerildi"
    if corrected:
        return "corrected", "Düzeltildi"
    if status == "active":
        if actor.startswith("user:"):
            return "recorded", "Kaydedildi (kullanıcı)"
        if decided_by and decided_by.startswith("user:"):
            return "approved", "Onaylandı (CLI)"
        return "active", "Etkin"
    return "unknown", "Bilinmiyor"


def row_out(r, corr):
    payload = event_detail.safe_payload(r, r["status"])
    key, text = label(r["status"] or "", r["actor"], r["decided_by"], r["id"] in corr)
    return {"id": r["id"], "seq": r["seq"], "type": r["type"], "ts": r["ts"], "subject": r["subject"],
            "key": r["key"], "actor": r["actor"], "trust": r["trust_eff"] or r["trust"], "status": r["status"],
            "label_key": key, "label": text, "text_short": short_text(payload)}


BASE_SQL = ("SELECT e.*, s.status, s.decided_by, s.trust_eff FROM events e "
            "LEFT JOIN proj_status s ON s.event_id = e.id WHERE 1=1")


def _date_bound(v, end=False):
    if not v:
        return None
    if not DATE_RE.match(v):
        raise BadRequest("date must be YYYY-MM-DD")
    # dates are entered in Europe/Istanbul (UTC+3, no DST) -> compare against UTC ts
    import datetime as dt
    d = dt.datetime.strptime(v, "%Y-%m-%d") - dt.timedelta(hours=3)
    if end:
        d += dt.timedelta(days=1)
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def list_memories(db, q="", type_=None, actor=None, status=None, date_from=None, date_to=None, limit=50, offset=0):
    if status and status not in STATUSES + ("corrected",):
        raise BadRequest(f"status must be one of {STATUSES + ('corrected',)}")
    sql, args = BASE_SQL, []
    sql += f" AND e.type NOT IN ({','.join('?' * len(HIDDEN_TYPES))})"
    args += list(HIDDEN_TYPES)
    snippets = {}
    if q.strip():
        hits = vault.search(db, q, limit=1000)
        snippets = {h["id"]: h["snip"] for h in hits}
        if not snippets:
            return {"total": 0, "limit": limit, "offset": offset, "items": [], "q": q}
        sql += f" AND e.id IN ({','.join('?' * len(snippets))})"
        args += list(snippets)
    if type_:
        sql += " AND e.type = ?"; args.append(type_)
    if actor:
        sql += " AND e.actor = ?"; args.append(actor)
    corr = corrected_ids(db)
    if status == "corrected":
        sql += f" AND e.id IN ({','.join('?' * len(corr)) or 'NULL'})"; args += list(corr)
    elif status == "active":
        sql += " AND s.status = 'active'"
        if corr:
            sql += f" AND e.id NOT IN ({','.join('?' * len(corr))})"; args += list(corr)
    elif status:
        sql += " AND s.status = ?"; args.append(status)
    lo, hi = _date_bound(date_from), _date_bound(date_to, end=True)
    if lo:
        sql += " AND e.ts >= ?"; args.append(lo)
    if hi:
        sql += " AND e.ts < ?"; args.append(hi)
    total = db.execute(f"SELECT count(*) FROM ({sql})", args).fetchone()[0]
    sql += " ORDER BY e.hlc DESC, e.id DESC LIMIT ? OFFSET ?"
    items = []
    for r in db.execute(sql, args + [limit, offset]):
        o = row_out(r, corr)
        if r["id"] in snippets:
            o["snippet"] = snippets[r["id"]]
        items.append(o)
    return {"total": total, "limit": limit, "offset": offset, "items": items, "q": q}


def queue(db):
    corr = corrected_ids(db)
    rows = db.execute(BASE_SQL + " AND s.status='proposed' ORDER BY e.hlc, e.id").fetchall()
    items = []
    for r in rows:
        o = row_out(r, corr)
        o["cli_approve"] = f"vault approve {r['id']}"
        o["cli_reject"] = f"vault reject {r['id']} --reason \"...\""
        items.append(o)
    return {"total": len(items), "items": items}


def history(db, limit=50, offset=0):
    corr = corrected_ids(db)
    total = db.execute("SELECT count(*) FROM events").fetchone()[0]
    rows = db.execute(BASE_SQL + " ORDER BY e.seq DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    items = []
    for r in rows:
        o = row_out(r, corr)
        o["targets"] = [x[0] for x in db.execute("SELECT target_id FROM event_targets WHERE event_id=?", (r["id"],))]
        o["supersedes"] = event_detail._sup(db, r["id"], True)
        o["meta"] = r["type"] in vault.META_TYPES
        items.append(o)
    return {"total": total, "limit": limit, "offset": offset, "items": items}


def _kind(t):
    return TYPE_TR.get(t.split(".", 1)[0].split(":", 1)[0], t.split(".", 1)[0].split(":", 1)[0])


def relations(db, e, d):
    """Only links that exist in the data: supersede edges, event_targets edges, shared subject."""
    out = []
    me = _kind(e["type"])

    def ev(i):
        return db.execute("SELECT id, type, subject FROM events WHERE id=?", (i,)).fetchone()
    for p in d["history"]["ancestors"]:
        r = ev(p)
        if r:
            out.append({"rel": f"{me} → düzeltilen {_kind(r['type'])}", "id": r["id"], "type": r["type"]})
    for c in d["history"]["descendants"]:
        r = ev(c)
        if r:
            out.append({"rel": f"{me} ← düzeltme", "id": r["id"], "type": r["type"]})
    for t in db.execute("SELECT target_id FROM event_targets WHERE event_id=?", (e["id"],)):
        r = ev(t[0])
        if r:
            out.append({"rel": f"{me} → hedef {_kind(r['type'])}", "id": r["id"], "type": r["type"]})
    subj_kind, _, subj_id = e["subject"].partition(":")
    if subj_kind and subj_id and subj_kind not in ("event", "batch"):
        n = db.execute(f"SELECT count(*) FROM events WHERE subject=? AND id<>? AND type NOT IN "
                       f"({','.join('?' * len(HIDDEN_TYPES))})", [e["subject"], e["id"], *HIDDEN_TYPES]).fetchone()[0]
        out.append({"rel": f"{me} → {_kind(subj_kind)}: {subj_id}", "subject": e["subject"], "same_subject_count": n})
    return out


def detail(db, ref):
    if not ID_RE.match(ref or ""):
        raise BadRequest("invalid id")
    try:
        d = event_detail.detail(db, ref)
    except ValueError as ex:
        raise LookupError(str(ex))
    e = db.execute("SELECT * FROM events WHERE id=?", (d["id"],)).fetchone()
    corr = corrected_ids(db)
    d["label_key"], d["label"] = label(d["status"] or "", d["actor"], d["decided_by"], d["id"] in corr)
    d["relations"] = relations(db, e, d)
    d["recorded_at"] = e["recorded_at"]
    if isinstance(d["payload"], dict):
        sources = d["payload"].get("sources")
        d["sources"] = sources if isinstance(sources, list) else []
    else:
        d["sources"] = []
    d["cli_show"] = f"vault show {d['id']}"
    return d


def meta(db, db_path):
    corr = corrected_ids(db)
    hidden = list(HIDDEN_TYPES)
    ph = ",".join("?" * len(hidden))
    types = [r[0] for r in db.execute(f"SELECT DISTINCT type FROM events WHERE type NOT IN ({ph}) ORDER BY type", hidden)]
    actors = [r[0] for r in db.execute(f"SELECT DISTINCT actor FROM events WHERE type NOT IN ({ph}) ORDER BY actor", hidden)]
    pending = db.execute("SELECT count(*) FROM proj_status WHERE status='proposed'").fetchone()[0]
    total = db.execute("SELECT count(*) FROM events").fetchone()[0]
    return {"types": types, "actors": actors, "pending": pending, "events_total": total,
            "corrected_total": len(corr), "schema_version": vault.SCHEMA_VERSION,
            "db_file": "…/" + os.path.basename(db_path),  # path redacted: only the file name is shown
            "encryption_available": bool(db.execute("SELECT count(*) FROM events WHERE enc_key_id IS NOT NULL").fetchone()[0]),
            "read_only": True, "bind": "127.0.0.1"}


def _int(qs, k, d, lo, hi):
    try:
        return max(lo, min(hi, int(qs.get(k, [d])[0])))
    except ValueError:
        raise BadRequest(f"{k} must be an integer")


def _s(qs, k, n=200):
    v = (qs.get(k, [""])[0] or "").strip()
    return v[:n] or None


class Handler(BaseHTTPRequestHandler):
    db_path = None
    server_version = "LatticeVaultUI/3"
    sys_version = ""

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _host_ok(self):
        h = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return h in ("127.0.0.1", "localhost")  # DNS-rebinding guard

    def do_GET(self):
        if not self._host_ok():
            return self._send(421, {"error": "host not allowed"})
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        p = u.path
        try:
            if p in ("/", "/index.html"):
                return self._static("index.html")
            if p.startswith("/static/"):
                return self._static(p[len("/static/"):])
            if p.startswith("/api/"):
                with contextlib.closing(open_ro(self.db_path)) as db:  # sqlite3 ctx-manager does not close
                    if p == "/api/meta":
                        return self._send(200, meta(db, self.db_path))
                    if p == "/api/memories":
                        return self._send(200, list_memories(
                            db, _s(qs, "q") or "", _s(qs, "type"), _s(qs, "actor"), _s(qs, "status"),
                            _s(qs, "from"), _s(qs, "to"),
                            _int(qs, "limit", 50, 1, MAX_LIMIT), _int(qs, "offset", 0, 0, 10**9)))
                    if p.startswith("/api/memories/"):
                        return self._send(200, detail(db, p.rsplit("/", 1)[1].lower()))
                    if p == "/api/queue":
                        return self._send(200, queue(db))
                    if p == "/api/history":
                        return self._send(200, history(db, _int(qs, "limit", 50, 1, MAX_LIMIT),
                                                       _int(qs, "offset", 0, 0, 10**9)))
                return self._send(404, {"error": "not found"})
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        except BadRequest as ex:
            return self._send(400, {"error": str(ex)})
        except LookupError as ex:
            return self._send(404, {"error": str(ex)})
        except (sqlite3.Error, vault.TamperError, ValueError) as ex:
            sys.stderr.write(f"error: {type(ex).__name__}: {ex}\n")
            return self._send(500, {"error": "veritabanı okunamadı"})

    do_HEAD = do_GET

    def _readonly(self):
        self._send(405, {"error": "salt-okunur arayüz; değişiklikler yalnızca CLI ile"})
    do_POST = do_PUT = do_DELETE = do_PATCH = _readonly

    def _static(self, name):
        full = os.path.realpath(os.path.join(STATIC, name))
        ext = os.path.splitext(full)[1]
        if not full.startswith(os.path.realpath(STATIC) + os.sep) or ext not in CTYPES or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        with open(full, "rb") as f:
            self._send(200, f.read(), CTYPES[ext])

    def log_message(self, fmt, *a):
        sys.stderr.write("%s\n" % (fmt % a))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Lattice Vault UI v3 (read-only, 127.0.0.1)")
    ap.add_argument("--db", default=os.environ.get("VAULT_DB", "./vault.db"))
    ap.add_argument("--port", type=int, default=8766)
    a = ap.parse_args(argv)
    open_ro(a.db).close()
    Handler.db_path = os.path.abspath(a.db)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Lattice Vault UI v3 (salt-okunur) http://127.0.0.1:{srv.server_address[1]}/", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
