from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from config import PACKAGE_DIR


def markdown(package: dict[str, Any]) -> str:
    p = package
    bullets = lambda xs: "\n".join(f"- {x}" for x in xs) if xs else "- Not stated"
    return f"""# {p['title']}

> {p['one_sentence_summary']}

## Experience

{p['narrative']}

## Context

{p['context']}

## Events

{bullets(p['events'])}

## Skills

{bullets(p['skills'])}

## Self-reported Emotions

{bullets(p['self_reported_emotions'])}

## Decisions

{bullets(p['decisions'])}

## Outcome and Reflection

{p['outcome']}

{p['reflection']}

## Open Space

{bullets(p['unknowns'])}

---

Interpretation boundary: this wisdom pack separates self-report, fact, and model inference. It never uses EEG, EMG, or images to assert emotion, personality, or intent.
"""


def archive(session_id: str, package: dict[str, Any], transcript: list[dict], evidence: list[dict]) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    folder = PACKAGE_DIR / f"WP-{stamp}-{session_id[:6]}"
    folder.mkdir(parents=True, exist_ok=False)
    manifest = {"schema_version":"1.0","session_id":session_id,"created_at":datetime.now().astimezone().isoformat(),
                "privacy":"private","author_confirmed":True,"physiology_interpretation":"descriptive_only",
                "experience":package,"evidence":evidence}
    (folder/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    (folder/"experience.md").write_text(markdown(package),encoding="utf-8")
    (folder/"transcript.json").write_text(json.dumps(transcript,ensure_ascii=False,indent=2),encoding="utf-8")
    (folder/"knowledge_graph.json").write_text(json.dumps(package.get("graph",{}),ensure_ascii=False,indent=2),encoding="utf-8")
    return folder
