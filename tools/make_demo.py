#!/usr/bin/env python3
"""Sentetik demo kasası üretir (kurgusal kullanıcı "Ada"; gerçek kişisel veri YOK).

Çekirdek Lattice Vault API'lerini kullanır: examples/seed.py + agent_api.propose_event + vault.review.
Usage: python3 tools/make_demo.py OUT_DIR   (OUT_DIR must not exist)
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from vaultsrc import VAULT_SRC  # noqa: E402


def main(out):
    out = os.path.abspath(out)
    env = {k: v for k, v in os.environ.items() if k not in ("VAULT_DB", "VAULT_AGENTS", "VAULT_LOG")}
    subprocess.run([sys.executable, os.path.join(VAULT_SRC, "examples", "seed.py"), out],
                   check=True, capture_output=True, env=env)
    os.environ["VAULT_DB"] = os.path.join(out, "vault.db")
    os.environ["VAULT_AGENTS"] = os.path.join(out, "agents.json")
    os.environ["VAULT_LOG"] = os.path.join(out, "vault-ops.jsonl")
    sys.path.insert(0, VAULT_SRC)
    import vault, agent_api
    tok = agent_api.add_agent("demo-arastirmaci", rate_limit=100)
    ids = []
    for i, (t, s, p) in enumerate([
        ("learning.captured", "user:ada", {"text": "Ada çalışırken şarkı sözü olmayan müzik dinliyor."}),
        ("learning.captured", "project:garden", {"text": "Fesleğen ışığı sever; balkon güneydoğuya bakıyor."}),
        ("preference.set", "user:ada", {"value": "Türkçe yanıtlar, kısa özet"}),
        ("learning.captured", "project:bike", {"text": "Bisiklet zinciri her 500 km'de yağlanmalı."}),
    ]):
        r = agent_api.propose_event(tok, {"type": t, "subject": s, "payload": p, "idempotency_key": f"tr-{i}"})
        ids.append(r["event_id"] if isinstance(r, dict) else r)
    db = vault.connect(os.environ["VAULT_DB"]); vault.rebuild(db)
    vault.review(db, ids[1], "approve", reason="demo: doğru")
    vault.review(db, ids[3], "reject", reason="demo: kaynak yok")
    db.close()
    return os.environ["VAULT_DB"]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(main(sys.argv[1]))
