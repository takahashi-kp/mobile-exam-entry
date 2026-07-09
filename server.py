import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb
from flask import Flask, Response, jsonify, request, send_from_directory
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent
DATABASE_URL = os.environ.get("DATABASE_URL", "")
API_KEY = os.environ.get("SYNC_API_KEY", "")

app = Flask(__name__, static_folder=None)


def utc_now():
    return datetime.now(timezone.utc)


def check_auth():
    if not API_KEY:
        return True
    return request.headers.get("Authorization") == f"Bearer {API_KEY}"


def json_response(value, status=200):
    response = jsonify(value)
    response.status_code = status
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


def require_database_url():
    if DATABASE_URL:
        return None
    return json_response({"error": "DATABASE_URL is not configured"}, 503)


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def ensure_schema():
    db_error = require_database_url()
    if db_error:
        return db_error
    with connect() as conn:
        conn.execute(
            """
            create table if not exists sync_records (
              id text primary key,
              entity_type text not null,
              payload jsonb not null,
              updated_at timestamptz not null default now()
            )
            """
        )
        conn.execute("create index if not exists sync_records_entity_type_idx on sync_records(entity_type)")
    return None


@app.route("/api/exam-records", methods=["OPTIONS"])
def exam_records_options():
    return json_response({}, 204)


@app.route("/api/exam-records", methods=["GET"])
def get_exam_records():
    if not check_auth():
        return json_response({"error": "Unauthorized"}, 401)
    db_error = ensure_schema()
    if db_error:
        return db_error
    with connect() as conn:
        rows = conn.execute("select payload from sync_records order by updated_at asc").fetchall()
    return json_response([row["payload"] for row in rows])


@app.route("/api/exam-records", methods=["POST"])
def post_exam_record():
    if not check_auth():
        return json_response({"error": "Unauthorized"}, 401)
    db_error = ensure_schema()
    if db_error:
        return db_error
    record = request.get_json(silent=True)
    if not isinstance(record, dict):
        return json_response({"error": "JSON object is required"}, 400)
    record_id = str(record.get("id") or "").strip()
    if not record_id:
        return json_response({"error": "id is required"}, 400)
    entity_type = str(record.get("entityType") or "record_header")
    record["updatedAt"] = record.get("updatedAt") or utc_now().isoformat()
    with connect() as conn:
        conn.execute(
            """
            insert into sync_records (id, entity_type, payload, updated_at)
            values (%s, %s, %s, now())
            on conflict (id) do update set
              entity_type = excluded.entity_type,
              payload = excluded.payload,
              updated_at = now()
            """,
            (record_id, entity_type, Jsonb(record)),
        )
    return json_response({"ok": True})


@app.route("/healthz")
def healthz():
    return json_response({"ok": True, "databaseConfigured": bool(DATABASE_URL)})


@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/<path:path>")
def static_files(path):
    target = ROOT / path
    if target.is_file():
        return send_from_directory(ROOT, path)
    return send_from_directory(ROOT, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
