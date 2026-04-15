#!/usr/bin/env python3
"""
最简 demo bot — 随机动作，用于本地 HTTP 对战测试
环境变量:
  ARENA_BOT_PORT  监听端口，默认 18080
  ARENA_BOT_TEAM  队伍标识，仅用于日志
"""
import json
import os
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("ARENA_BOT_PORT", 18080))
TEAM = os.environ.get("ARENA_BOT_TEAM", "?")
ACTIONS = ["Move(Up)", "Move(Down)", "Move(Left)", "Move(Right)", "Pick", "Drop", "Wait"]

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 静默日志

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _respond(self, code, body=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body or {}).encode())

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok"})
        else:
            self._respond(404)

    def do_POST(self):
        body = self._read_body()
        if self.path == "/init":
            self._respond(200)
        elif self.path == "/act":
            robots = body.get("robots", [])
            actions = {
                str(r["id"]): random.choice(ACTIONS)
                for r in robots
                if r.get("team") == TEAM or True  # demo bot 控制所有机器人
            }
            self._respond(200, {"actions": actions})
        elif self.path == "/finish":
            self._respond(200)
        else:
            self._respond(404)

if __name__ == "__main__":
    print(f"[demo-bot] team={TEAM} port={PORT}")
    HTTPServer(("", PORT), Handler).serve_forever()
