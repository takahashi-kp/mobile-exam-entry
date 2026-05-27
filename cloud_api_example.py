from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path

DATA_FILE = Path(__file__).with_name("cloud-records.json")
API_KEY = ""


def load_records():
    if not DATA_FILE.exists():
        return []
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def save_records(records):
    DATA_FILE.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if not self.authorized():
            return
        self.send_json(load_records())

    def do_POST(self):
        if not self.authorized():
            return
        length = int(self.headers.get("Content-Length", "0"))
        record = json.loads(self.rfile.read(length).decode("utf-8"))
        records = load_records()
        records = [item for item in records if item.get("id") != record.get("id")]
        records.append(record)
        save_records(records)
        self.send_json({"ok": True})

    def authorized(self):
        if not API_KEY:
            return True
        expected = f"Bearer {API_KEY}"
        if self.headers.get("Authorization") == expected:
            return True
        self.send_response(401)
        self.end_headers()
        return False

    def send_json(self, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8787), Handler)
    print("Cloud sync API: http://localhost:8787")
    server.serve_forever()
