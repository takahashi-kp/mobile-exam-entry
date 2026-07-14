import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb
from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from psycopg.rows import dict_row

from roster_export import build_roster

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
        # Keep the original sync_records table untouched as a migration backup.
        # Version 2 uses a composite key because different entity types may
        # legitimately share the same client id.
        conn.execute(
            """
            create table if not exists sync_records_v2 (
              id text not null,
              entity_type text not null,
              payload jsonb not null,
              updated_at timestamptz not null default now(),
              primary key (entity_type, id)
            )
            """
        )
        conn.execute("create index if not exists sync_records_v2_entity_type_idx on sync_records_v2(entity_type)")
        conn.execute(
            """
            create table if not exists sync_record_history (
              history_id bigserial primary key,
              id text not null,
              entity_type text not null,
              payload jsonb not null,
              received_at timestamptz not null default now()
            )
            """
        )
        conn.execute("create index if not exists sync_record_history_record_idx on sync_record_history(entity_type, id)")
        legacy_exists = conn.execute("select to_regclass('public.sync_records') as table_name").fetchone()
        if legacy_exists and legacy_exists["table_name"]:
            conn.execute(
                """
                insert into sync_records_v2 (id, entity_type, payload, updated_at)
                select id, entity_type, payload, updated_at from sync_records
                on conflict (entity_type, id) do nothing
                """
            )
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
        rows = conn.execute("select payload from sync_records_v2 order by updated_at asc").fetchall()
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
            "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (f"{entity_type}::{record_id}",),
        )
        existing = conn.execute(
            "select payload from sync_records_v2 where entity_type = %s and id = %s for update",
            (entity_type, record_id),
        ).fetchone()
        merged_record = merge_payload(existing["payload"] if existing else {}, record)
        conn.execute(
            "insert into sync_record_history (id, entity_type, payload) values (%s, %s, %s)",
            (record_id, entity_type, Jsonb(record)),
        )
        conn.execute(
            """
            insert into sync_records_v2 (id, entity_type, payload, updated_at)
            values (%s, %s, %s, now())
            on conflict (entity_type, id) do update set
              payload = excluded.payload,
              updated_at = now()
            """,
            (record_id, entity_type, Jsonb(merged_record)),
        )
    return json_response({"ok": True})


def has_value(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def merge_payload(existing, incoming):
    """Merge without allowing an empty offline value to erase measured data.

    Every raw POST is retained in sync_record_history before this merged view is
    updated, so an operator can recover earlier measurements if necessary.
    """
    if not isinstance(existing, dict):
        existing = {}
    merged = dict(existing)
    for key, value in incoming.items():
        old_value = merged.get(key)
        if isinstance(old_value, dict) and isinstance(value, dict):
            merged[key] = merge_payload(old_value, value)
        elif has_value(value) or not has_value(old_value):
            merged[key] = value
    return merged


@app.route("/healthz")
def healthz():
    return json_response({"ok": True, "databaseConfigured": bool(DATABASE_URL), "syncSchema": 2})


@app.route("/api/roster-export", methods=["POST"])
def export_roster():
    if not check_auth():
        return json_response({"error": "Unauthorized"}, 401)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return json_response({"error": "JSON object is required"}, 400)
    kind = str(payload.get("kind") or "")
    rows = payload.get("rows")
    if kind not in {"chest", "stomach"}:
        return json_response({"error": "kind must be chest or stomach"}, 400)
    try:
        output = build_roster(kind, payload.get("customerName"), payload.get("examDate"), rows)
    except ValueError as error:
        return json_response({"error": str(error)}, 400)
    label = "胸部XP" if kind == "chest" else "胃部XP"
    return send_file(
        output,
        as_attachment=True,
        download_name=f"【{label}】巡回照射録.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


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
