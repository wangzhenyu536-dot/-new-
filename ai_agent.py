from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from config import MAX_QUESTIONS, OPENAI_API_KEY, OPENAI_MODEL
from prompts import PACKAGE_PROMPT, SYSTEM_PROMPT


TURN_SCHEMA = {
    "type":"object", "additionalProperties":False,
    "properties":{
        "action":{"type":"string","enum":["ask","finish","safety_stop"]},
        "reason":{"type":"string"}, "question":{"type":"string"},
        "updated_state":{"type":"object","additionalProperties":False,
          "properties":{
            "summary":{"type":"string"}, "facts":{"type":"array","items":{"type":"string"}},
            "self_reports":{"type":"array","items":{"type":"string"}},
            "inferences":{"type":"array","items":{"type":"string"}},
            "open_questions":{"type":"array","items":{"type":"string"}}
          }, "required":["summary","facts","self_reports","inferences","open_questions"]}
    }, "required":["action","reason","question","updated_state"]
}

PACKAGE_SCHEMA = {
  "type":"object","additionalProperties":False,"properties":{
    "title":{"type":"string"},"one_sentence_summary":{"type":"string"},
    "narrative":{"type":"string"},"context":{"type":"string"},
    "events":{"type":"array","items":{"type":"string"}},
    "skills":{"type":"array","items":{"type":"string"}},
    "self_reported_emotions":{"type":"array","items":{"type":"string"}},
    "decisions":{"type":"array","items":{"type":"string"}},
    "outcome":{"type":"string"},"reflection":{"type":"string"},
    "unknowns":{"type":"array","items":{"type":"string"}},
    "facts":{"type":"array","items":{"type":"string"}},
    "inferences":{"type":"array","items":{"type":"object","additionalProperties":False,
      "properties":{"claim":{"type":"string"},"confidence":{"type":"number"},"basis":{"type":"string"}},
      "required":["claim","confidence","basis"]}},
    "graph":{"type":"object","additionalProperties":False,
      "properties":{"nodes":{"type":"array","items":{"type":"object","additionalProperties":False,
        "properties":{"id":{"type":"string"},"type":{"type":"string"},"label":{"type":"string"}},"required":["id","type","label"]}},
        "relations":{"type":"array","items":{"type":"object","additionalProperties":False,
        "properties":{"from":{"type":"string"},"relation":{"type":"string"},"to":{"type":"string"},"evidence":{"type":"string"}},
        "required":["from","relation","to","evidence"]}},
      "required":["nodes","relations"]}
    }
  },"required":["title","one_sentence_summary","narrative","context","events","skills","self_reported_emotions","decisions","outcome","reflection","unknowns","facts","inferences","graph"]
}


class AIError(RuntimeError): pass


def _call(instructions: str, payload: dict[str, Any], schema: dict[str, Any], name: str) -> dict[str, Any]:
    if not OPENAI_API_KEY:
        raise AIError("No API key is configured")
    body = {
      "model":OPENAI_MODEL, "instructions":instructions,
      "input":json.dumps(payload, ensure_ascii=False),
      "text":{"format":{"type":"json_schema","name":name,"strict":True,"schema":schema}}
    }
    req = urllib.request.Request("https://api.openai.com/v1/responses",
      data=json.dumps(body).encode(), headers={"Authorization":f"Bearer {OPENAI_API_KEY}","Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise AIError(f"The AI service returned error {exc.code}: {detail}") from exc
    except Exception as exc:
        raise AIError(f"Unable to connect to the AI service: {exc}") from exc
    for item in result.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return json.loads(content["text"])
    raise AIError("The AI service returned no usable result")


def decide_turn(session: dict[str, Any]) -> dict[str, Any]:
    if session["questions_used"] >= MAX_QUESTIONS:
        return {"action":"finish","reason":"The three-question limit has been reached","question":"","updated_state":session["state"]}
    payload = {"questions_used":session["questions_used"],"max_questions":MAX_QUESTIONS,
               "messages":session["messages"],"current_state":session["state"],"evidence":session["evidence"]}
    try:
        result = _call(SYSTEM_PROMPT, payload, TURN_SCHEMA, "wisdom_turn")
        if result["action"] == "ask" and session["questions_used"] >= MAX_QUESTIONS:
            result.update(action="finish", question="", reason="The three-question limit has been reached")
        return result
    except AIError:
        return demo_decision(session)


def demo_decision(session: dict[str, Any]) -> dict[str, Any]:
    questions = [
      "What detail from this experience stayed with you most?",
      "What did you do in response, if anything?",
      "Where did this experience leave off for you?"
    ]
    used = session["questions_used"]
    text = " ".join(m["content"] for m in session["messages"] if m["role"] == "user")
    state = {"summary":text[:240],"facts":[text],"self_reports":[],"inferences":[],"open_questions":questions[used:]}
    if used >= MAX_QUESTIONS:
        return {"action":"finish","reason":"The three-question interview is complete","question":"","updated_state":state}
    return {"action":"ask","reason":"The demo follows the gentle three-question structure","question":questions[used],"updated_state":state}


def build_package(session: dict[str, Any]) -> dict[str, Any]:
    payload={"messages":session["messages"],"state":session["state"],"evidence":session["evidence"]}
    try:
        return _call(SYSTEM_PROMPT+"\n"+PACKAGE_PROMPT, payload, PACKAGE_SCHEMA, "wisdom_package")
    except AIError:
        user_text = "\n\n".join(m["content"] for m in session["messages"] if m["role"]=="user")
        return {"title":session["title"],"one_sentence_summary":user_text[:120],"narrative":user_text,
          "context":"Organized from the person's own account","events":[],"skills":[],"self_reported_emotions":[],"decisions":[],
          "outcome":"Not stated","reflection":"Not stated","unknowns":["The demo mode did not perform AI structural analysis"],
          "facts":[user_text],"inferences":[],"graph":{"nodes":[],"relations":[]}}
