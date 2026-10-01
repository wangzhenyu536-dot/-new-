from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
PACKAGE_DIR = DATA_DIR / "packages"
DB_PATH = DATA_DIR / "wisdom.db"
STATIC_DIR = ROOT / "frontend"


def load_env() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-nano")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8765"))
MAX_QUESTIONS = 3
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

for directory in (DATA_DIR, UPLOAD_DIR, PACKAGE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

