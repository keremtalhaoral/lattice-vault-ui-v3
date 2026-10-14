"""API tests for Lattice Vault UI v3. Synthetic demo DB generated with core vault APIs (tools/make_demo.py)."""
import json, os, shutil, sqlite3, tempfile, threading, unittest, urllib.error, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer

import server
from tools import make_demo


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        saved = {k: os.environ.get(k) for k in ("VAULT_DB", "VAULT_AGENTS", "VAULT_LOG")}
        make_demo.main(os.path.join(cls.tmp, "v"))
        for k, v in saved.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        cls.db = os.path.join(cls.tmp, "v", "vault.db")
        server.Handler.db_path = cls.db
        server.Handler.log_message = lambda *a: None
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.srv.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def req(self, path, method="GET", headers=None):
        r = urllib.request.Request(self.base + urllib.parse.quote(path, safe="/?=&:%"), method=method, headers=headers or {},
                                   data=b"{}" if method in ("POST", "PUT", "PATCH") else None)
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def get(self, path):
        code, _, body = self.req(path)
        self.assertEqual(code, 200, body)
        return json.loads(body)

    # --- Bellekler ---
    def test_memories_list_hides_meta(self):
        d = self.get("/api/memories")
        self.assertGreater(d["total"], 8)
        types = {i["type"] for i in d["items"]}
        self.assertFalse(types & {"event.approved", "event.rejected", "event.corrected"})
        for k in ("id", "type", "ts", "actor", "status", "label", "label_key", "text_short"):
            self.assertIn(k, d["items"][0])

    def test_status_vocabulary(self):
        labels = {i["label"] for i in self.get("/api/memories?limit=200")["items"]}
        self.assertTrue({"Önerildi", "Onaylandı (CLI)", "Düzeltildi", "Reddedildi"} <= labels, labels)
        self.assertNotIn("Doğrulandı", labels)  # approvals are unsigned

    def test_filters(self):
        self.assertTrue(all(i["status"] == "proposed" for i in self.get("/api/memories?status=proposed")["items"]))
        c = self.get("/api/memories?status=corrected")
        self.assertEqual([i["label"] for i in c["items"]], ["Düzeltildi"])
        a = self.get("/api/memories?actor=agent:demo-arastirmaci")
        self.assertEqual(a["total"], 4)
        t = self.get("/api/memories?type=decision.made")
        self.assertTrue(t["items"] and all(i["type"] == "decision.made" for i in t["items"]))
        self.assertEqual(self.get("/api/memories?from=2000-01-01&to=2000-01-02")["total"], 0)
        self.assertGreater(self.get("/api/memories?from=2000-01-01")["total"], 0)
        self.assertEqual(len(self.get("/api/memories?limit=2&offset=1")["items"]), 2)

    def test_bad_params(self):
        for q in ("status=bogus", "from=14-10-2026", "limit=x"):
            self.assertEqual(self.req(f"/api/memories?{q}")[0], 400, q)

    def test_turkish_fts(self):
        d = self.get("/api/memories?q=Fesleğen")
        self.assertEqual(d["total"], 1)
        self.assertIn("[", d["items"][0]["snippet"])
        self.assertEqual(self.get("/api/memories?q=FESLEGEN")["total"], 1)   # diacritics/case-insensitive
        self.assertEqual(self.get("/api/memories?q=şarkı")["total"], 1)
        self.assertEqual(self.get("/api/memories?q=zzzyokzzz")["total"], 0)

    def test_detail(self):
        corr = self.get("/api/memories?status=corrected")["items"][0]
        d = self.get(f"/api/memories/{corr['id']}")
        self.assertEqual(d["label"], "Düzeltildi")
        self.assertTrue(d["chain_verification"]["ok"])
        self.assertEqual(len(d["history"]["descendants"]), 1)
        rels = [r["rel"] for r in d["relations"]]
        self.assertIn("tercih ← düzeltme", rels)
        self.assertIn("tercih → kullanıcı: ada", rels)
        prop = [i for i in self.get("/api/memories?actor=agent:demo-assistant")["items"]][0]
        p = self.get(f"/api/memories/{prop['id']}")
        self.assertEqual(p["sources"], ["https://example.com/ada-running-log"])
        self.assertEqual(self.req("/api/memories/0000000000000000")[0], 404)
        self.assertEqual(self.req("/api/memories/..%2f..%2fetc")[0], 400)

    # --- Kuyruk / Geçmiş / meta ---
    def test_queue(self):
        q = self.get("/api/queue")
        self.assertEqual(q["total"], 3)
        it = q["items"][0]
        self.assertEqual(it["cli_approve"], f"vault approve {it['id']}")
        self.assertTrue(it["cli_reject"].startswith(f"vault reject {it['id']}"))

    def test_history_pagination(self):
        h = self.get("/api/history?limit=5")
        self.assertEqual(len(h["items"]), 5)
        seqs = [i["seq"] for i in h["items"]]
        self.assertEqual(seqs, sorted(seqs, reverse=True))
        h2 = self.get("/api/history?limit=5&offset=5")
        self.assertLess(h2["items"][0]["seq"], seqs[-1])
        self.assertTrue(any(i["meta"] and i["targets"] for i in h["items"]))

    def test_meta_redacts_path(self):
        m = self.get("/api/meta")
        self.assertEqual(m["db_file"], "…/vault.db")
        self.assertNotIn(self.tmp, json.dumps(m))
        self.assertEqual(m["pending"], 3)

    # --- security ---
    def test_headers_and_static(self):
        code, hdr, body = self.req("/")
        self.assertEqual(code, 200)
        self.assertIn("default-src 'self'", hdr["Content-Security-Policy"])
        self.assertNotIn("http", hdr["Content-Security-Policy"])
        self.assertEqual(hdr["X-Content-Type-Options"], "nosniff")
        self.assertIn(b'lang="tr"', body)
        self.assertEqual(self.req("/static/fonts/ibm-plex-mono-latin-400-normal.woff2")[1]["Content-Type"], "font/woff2")
        self.assertEqual(self.req("/static/../server.py")[0], 404)
        self.assertEqual(self.req("/static/%2e%2e/server.py")[0], 404)

    def test_host_guard(self):
        self.assertEqual(self.req("/api/meta", headers={"Host": "evil.example:80"})[0], 421)

    def test_read_only(self):
        for m in ("POST", "PUT", "DELETE", "PATCH"):
            self.assertEqual(self.req("/api/memories", method=m)[0], 405, m)
        db = server.open_ro(self.db)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                db.execute("CREATE TABLE x(a)")
        finally:
            db.close()

    def test_no_external_urls_in_static(self):
        for root, _, files in os.walk(server.STATIC):
            for f in files:
                if f.endswith((".html", ".css", ".js")):
                    with open(os.path.join(root, f), encoding="utf-8") as fh:
                        s = fh.read()
                    self.assertNotIn("https://", s, f)
                    self.assertNotIn(".innerHTML", s, f); self.assertNotIn("insertAdjacentHTML", s, f)

    def test_missing_db_is_500_not_crash(self):
        old = server.Handler.db_path
        server.Handler.db_path = os.path.join(self.tmp, "nope.db")
        try:
            code, _, body = self.req("/api/meta")
            self.assertEqual(code, 500)
            self.assertNotIn(self.tmp, body.decode())
        finally:
            server.Handler.db_path = old


if __name__ == "__main__":
    unittest.main()
