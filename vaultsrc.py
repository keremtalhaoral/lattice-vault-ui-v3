"""Locate the Lattice Vault core checkout (sibling lattice-vault-release, then lattice-vault; override VAULT_SRC)."""
import os, sys

_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT_SRC = os.environ.get("VAULT_SRC") or next(
    (p for p in (os.path.join(_parent, "lattice-vault-release"), os.path.join(_parent, "lattice-vault"))
     if os.path.isfile(os.path.join(p, "event_detail.py"))),
    os.path.join(_parent, "lattice-vault-release"))
if VAULT_SRC not in sys.path:
    sys.path.insert(0, VAULT_SRC)
