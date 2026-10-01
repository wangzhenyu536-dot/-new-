from __future__ import annotations

import cgi
import json
import mimetypes
import re
import shutil
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import database
from ai_agent import build_package, decide_turn
from config import HOST, MAX_QUESTIONS, MAX_UPLOAD_BYTES, OPENAI_API_KEY, PORT, STATIC_DIR, UPLOAD_DIR
from package_builder import archive


def safe_name(name: str) -> str:
    name = Path(name).name
    return re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", name)[:120] or "file"


class Handler(BaseHTTPRequestHandler):
    server_version = "WisdomPack/0.2"

    def json_response(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000: raise ValueError("The request is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/health":
                return self.json_response({"ok":True,"ai_mode":"openai" if OPENAI_API_KEY else "demo","max_questions":MAX_QUESTIONS})
            if path == "/api/sessions": return self.json_response(database.list_sessions())
            match = re.fullmatch(r"/api/sessions/([a-z0-9]+)", path)
            if match: return self.json_response(database.get_session(match.group(1)))
            self.serve_static(path)
        except KeyError as exc: self.json_response({"error":str(exc)},404)
        except Exception as exc: self.json_response({"error":str(exc)},500)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/sessions":
                body=self.read_json(); story=body.get("story","").strip()
                if not story: return self.json_response({"error":"Please share an experience first"},400)
                session=database.create_session(story,body.get("title") or "My Experience Record")
                return self.advance(session)
            match=re.fullmatch(r"/api/sessions/([a-z0-9]+)/(answer|skip|finish|package|confirm|upload)",path)
            if not match: return self.json_response({"error":"Endpoint not found"},404)
            session_id, action=match.groups()
            if action=="upload": return self.upload(session_id)
            session=database.get_session(session_id)
            if action=="answer":
                answer=self.read_json().get("answer","").strip()
                if not answer:return self.json_response({"error":"Please enter a response"},400)
                database.add_message(session_id,"user",answer)
                session=database.get_session(session_id); return self.advance(session)
            if action=="skip":
                database.add_message(session_id,"user","I would like to leave this part open.")
                session=database.get_session(session_id); return self.advance(session)
            if action=="finish":
                database.update_session(session_id,state=session["state"],status="ready",questions_used=session["questions_used"])
                return self.json_response(database.get_session(session_id))
            if action=="package":
                package=build_package(session)
                state=session["state"]|{"package":package,"archive_folder":None}
                database.update_session(session_id,state=state,status="ready_for_review",questions_used=session["questions_used"],title=package["title"])
                return self.json_response(database.get_session(session_id))
            if action=="confirm":
                package=session["state"].get("package")
                if not package:return self.json_response({"error":"Please generate a wisdom pack draft first"},400)
                folder=archive(session_id,package,session["messages"],session["evidence"])
                state=session["state"]|{"archive_folder":str(folder),"author_confirmed":True}
                database.update_session(session_id,state=state,status="archived",questions_used=session["questions_used"],title=package["title"])
                return self.json_response(database.get_session(session_id))
        except (ValueError,KeyError) as exc:self.json_response({"error":str(exc)},400)
        except Exception as exc:self.json_response({"error":str(exc)},500)

    def advance(self, session):
        result=decide_turn(session); used=session["questions_used"]
        status="ready"
        if result["action"]=="ask":
            used+=1; database.add_message(session["id"],"agent",result["question"]); status="collecting"
        elif result["action"]=="safety_stop":
            database.add_message(session["id"],"agent",result["question"]); status="safety_stop"
        database.update_session(session["id"],state=result["updated_state"],status=status,questions_used=used)
        return self.json_response(database.get_session(session["id"]))

    def upload(self, session_id):
        database.get_session(session_id)
        length=int(self.headers.get("Content-Length","0"))
        if length>MAX_UPLOAD_BYTES:return self.json_response({"error":"A single upload cannot exceed 25 MB"},413)
        form=cgi.FieldStorage(fp=self.rfile,headers=self.headers,environ={"REQUEST_METHOD":"POST","CONTENT_TYPE":self.headers.get("Content-Type","")})
        field=form["file"] if "file" in form else None
        if field is None or not field.filename:return self.json_response({"error":"No file was received"},400)
        original=safe_name(field.filename); stored=f"{uuid.uuid4().hex}_{original}"
        folder=UPLOAD_DIR/session_id; folder.mkdir(parents=True,exist_ok=True)
        with (folder/stored).open("wb") as out: shutil.copyfileobj(field.file,out)
        size=(folder/stored).stat().st_size; media=field.type or mimetypes.guess_type(original)[0] or "application/octet-stream"
        item=database.add_evidence(session_id,original,stored,media,size)
        return self.json_response(item,201)

    def serve_static(self,path):
        relative="index.html" if path=="/" else unquote(path).lstrip("/")
        file=(STATIC_DIR/relative).resolve()
        if STATIC_DIR.resolve() not in file.parents and file!=STATIC_DIR.resolve():return self.send_error(403)
        if not file.is_file():return self.send_error(404)
        raw=file.read_bytes(); self.send_response(200)
        self.send_header("Content-Type",mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def log_message(self,format,*args): pass


def main():
    database.init_db(); url=f"http://{HOST}:{PORT}"
    print(f"EVERTRACE Agent is running at {url}")
    print("Press Control+C to stop.")
    webbrowser.open(url)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()


if __name__=="__main__": main()
