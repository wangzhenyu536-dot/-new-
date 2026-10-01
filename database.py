from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from config import DB_PATH


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_db() -> None:
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
            questions_used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
            role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS session_state (
            session_id TEXT PRIMARY KEY, state_json TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS evidence (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, filename TEXT NOT NULL,
            stored_name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        """)


def create_session(initial_story: str, title: str = "An Untitled Experience") -> dict[str, Any]:
    session_id = uuid.uuid4().hex[:12]
    timestamp = now()
    state = empty_state()
    with connect() as db:
        db.execute("INSERT INTO sessions VALUES (?, ?, 'collecting', 0, ?, ?)", (session_id, title, timestamp, timestamp))
        db.execute("INSERT INTO messages(session_id,role,content,created_at) VALUES (?, 'user', ?, ?)", (session_id, initial_story, timestamp))
        db.execute("INSERT INTO session_state VALUES (?, ?)", (session_id, json.dumps(state, ensure_ascii=False)))
    return get_session(session_id)


def empty_state() -> dict[str, Any]:
    return {"summary":"", "facts":[], "self_reports":[], "inferences":[], "open_questions":[], "package":None}


def get_session(session_id: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            raise KeyError("The collection session could not be found")
        messages = [dict(x) for x in db.execute("SELECT role,content,created_at FROM messages WHERE session_id=? ORDER BY id", (session_id,))]
        state_row = db.execute("SELECT state_json FROM session_state WHERE session_id=?", (session_id,)).fetchone()
        files = [dict(x) for x in db.execute("SELECT id,filename,media_type,size,created_at FROM evidence WHERE session_id=?", (session_id,))]
    result = dict(row)
    result["messages"] = messages
    result["state"] = json.loads(state_row[0]) if state_row else empty_state()
    result["evidence"] = files
    return result


def list_sessions() -> list[dict[str, Any]]:
    with connect() as db:
        return [dict(x) for x in db.execute("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 50")]


def add_message(session_id: str, role: str, content: str) -> None:
    timestamp = now()
    with connect() as db:
        db.execute("INSERT INTO messages(session_id,role,content,created_at) VALUES (?,?,?,?)", (session_id, role, content, timestamp))
        db.execute("UPDATE sessions SET updated_at=? WHERE id=?", (timestamp, session_id))


def update_session(session_id: str, *, state: dict[str, Any], status: str, questions_used: int, title: str | None = None) -> None:
    timestamp = now()
    with connect() as db:
        db.execute("UPDATE session_state SET state_json=? WHERE session_id=?", (json.dumps(state, ensure_ascii=False), session_id))
        if title:
            db.execute("UPDATE sessions SET status=?,questions_used=?,title=?,updated_at=? WHERE id=?", (status, questions_used, title, timestamp, session_id))
        else:
            db.execute("UPDATE sessions SET status=?,questions_used=?,updated_at=? WHERE id=?", (status, questions_used, timestamp, session_id))


def add_evidence(session_id: str, filename: str, stored_name: str, media_type: str, size: int) -> dict[str, Any]:
    item = {"id":uuid.uuid4().hex[:12], "session_id":session_id, "filename":filename, "stored_name":stored_name,
            "media_type":media_type, "size":size, "created_at":now()}
    with connect() as db:
        db.execute("INSERT INTO evidence VALUES (:id,:session_id,:filename,:stored_name,:media_type,:size,:created_at)", item)
    return item
