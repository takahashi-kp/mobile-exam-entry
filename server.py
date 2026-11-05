import json
import os
import base64
import re
import threading
import time
import urllib.error
import urllib.request
import hashlib
import io
import secrets
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb
from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from psycopg.rows import dict_row

from roster_export import build_roster
import qrcode
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
DATABASE_URL = os.environ.get("DATABASE_URL", "")
API_KEY = os.environ.get("SYNC_API_KEY", "")
VISION_API_KEY = os.environ.get("GOOGLE_CLOUD_VISION_API_KEY", "")

VISION_MAX_IMAGES = 3
VISION_MAX_IMAGE_BYTES = 2 * 1024 * 1024
VISION_RATE_LIMIT = 30
VISION_RATE_WINDOW_SECONDS = 60
vision_requests = defaultdict(deque)
vision_requests_lock = threading.Lock()
questionnaire_verifications = defaultdict(deque)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024


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


def normalize_ocr_text(value):
    value = str(value or "").translate(str.maketrans({
        "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
        "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
        "．": ".", "，": ".", ",": ".", "ｃ": "c", "ｍ": "m",
        "ｋ": "k", "ｇ": "g",
    }))
    return re.sub(r"[ \t]+", " ", value)


def parse_decimal_token(token, kind):
    token = re.sub(r"\s+", "", str(token or ""))
    token = token.translate(str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1"}))
    if not re.fullmatch(r"\d{2,4}(?:\.\d)?", token):
        return None
    try:
        number = float(token)
    except ValueError:
        return None
    if "." not in token:
        if kind == "height" and number > 210:
            number /= 10
        elif kind == "weight" and number > 200:
            number /= 10
    valid = 100 <= number <= 210 if kind == "height" else 20 <= number <= 200
    return round(number, 1) if valid else None


def parse_measurement_text(text):
    """Extract an AD-6351-style height/weight pair from OCR text."""
    normalized = normalize_ocr_text(text)
    height = None
    weight = None
    number = r"([0-9OoIl|](?:\s*[0-9OoIl|]){1,3}(?:\s*[.]\s*[0-9OoIl|])?)"
    height_match = re.search(number + r"\s*(?:cm|センチ)", normalized, re.IGNORECASE)
    weight_match = re.search(number + r"\s*(?:kg|k9|キロ)", normalized, re.IGNORECASE)
    if not height_match:
        height_match = re.search(r"height\s*[:=-]?\s*" + number, normalized, re.IGNORECASE)
    if not weight_match:
        weight_match = re.search(r"weight\s*[:=-]?\s*" + number, normalized, re.IGNORECASE)
    if height_match:
        height = parse_decimal_token(height_match.group(1), "height")
    if weight_match:
        weight = parse_decimal_token(weight_match.group(1), "weight")

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    tokens = []
    for line in lines:
        for match in re.finditer(number, line, re.IGNORECASE):
            tokens.append(match.group(1))
    if height is None:
        for token in tokens:
            height = parse_decimal_token(token, "height")
            if height is not None:
                break
    if weight is None:
        start = 1 if height is not None and len(tokens) > 1 else 0
        for token in tokens[start:]:
            candidate = parse_decimal_token(token, "weight")
            if candidate is not None and candidate != height:
                weight = candidate
                break
    if height is None or weight is None:
        return None
    return {"height": f"{height:.1f}", "weight": f"{weight:.1f}"}


def vision_rate_limited(client_ip):
    now = time.monotonic()
    with vision_requests_lock:
        recent = vision_requests[client_ip]
        while recent and now - recent[0] > VISION_RATE_WINDOW_SECONDS:
            recent.popleft()
        if len(recent) >= VISION_RATE_LIMIT:
            return True
        recent.append(now)
        return False


def call_cloud_vision(images):
    requests = [{
        "image": {"content": image},
        "features": [{"type": "TEXT_DETECTION", "maxResults": 20}],
        "imageContext": {"languageHints": ["en"]},
    } for image in images]
    body = json.dumps({"requests": requests}).encode("utf-8")
    cloud_request = urllib.request.Request(
        "https://vision.googleapis.com/v1/images:annotate?key=" + VISION_API_KEY,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(cloud_request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.path.startswith("/api/public-questionnaire/") or request.path.startswith("/questionnaire/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
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
        conn.execute(
            """
            create table if not exists questionnaire_invitations (
              token_hash text primary key,
              group_id text not null,
              patient_code text not null,
              status text not null default 'not_started',
              answers jsonb not null default '{}'::jsonb,
              verified_at timestamptz,
              first_saved_at timestamptz,
              submitted_at timestamptz,
              updated_at timestamptz not null default now(),
              expires_at timestamptz,
              unique (group_id, patient_code)
            )
            """
        )
        conn.execute("create index if not exists questionnaire_inv_group_idx on questionnaire_invitations(group_id, status)")
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


def token_hash(token):
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def normalize_birth_digits(value):
    return re.sub(r"\D", "", str(value or ""))


def birth_month_day(value):
    digits = normalize_birth_digits(value)
    return digits[-4:] if len(digits) >= 4 else ""


def birth_value_matches(expected_birth, supplied_birth):
    expected = normalize_birth_digits(expected_birth)
    supplied = normalize_birth_digits(supplied_birth)
    if len(expected) < 8:
        return False
    expected = expected[-8:]
    if len(supplied) == 4:
        return secrets.compare_digest(expected[-4:], supplied)
    if len(supplied) == 6:
        return secrets.compare_digest(expected[:6], supplied)
    if len(supplied) == 8:
        return secrets.compare_digest(expected, supplied)
    return False


def schedule_group_and_patients(conn, group_id):
    group_row = conn.execute(
        "select payload from sync_records_v2 where entity_type = 'schedule_group' and id = %s",
        (group_id,),
    ).fetchone()
    patients = conn.execute(
        """
        select payload from sync_records_v2
        where entity_type = 'schedule_patient' and payload->>'groupId' = %s
        order by payload->>'受診者コード'
        """,
        (group_id,),
    ).fetchall()
    return (group_row["payload"] if group_row else None, [row["payload"] for row in patients])


def questionnaire_invitation(conn, token):
    row = conn.execute(
        "select * from questionnaire_invitations where token_hash = %s",
        (token_hash(token),),
    ).fetchone()
    if not row:
        return None, None, None
    group, patients = schedule_group_and_patients(conn, row["group_id"])
    patient = next((item for item in patients if str(item.get("受診者コード") or "") == row["patient_code"]), None)
    return row, group, patient


def questionnaire_verified(row, patient, supplied_birth):
    if not row or not patient:
        return False
    if row.get("expires_at") and row["expires_at"] < utc_now():
        return False
    return birth_value_matches(patient.get("生年月日"), supplied_birth)


def questionnaire_verification_key(token):
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    return f"{client_ip}:{token_hash(token)[:16]}"


def questionnaire_verification_limited(token):
    key = questionnaire_verification_key(token)
    now = time.monotonic()
    with vision_requests_lock:
        recent = questionnaire_verifications[key]
        while recent and now - recent[0] > 600:
            recent.popleft()
        return len(recent) >= 10


def record_questionnaire_verification_failure(token):
    key = questionnaire_verification_key(token)
    with vision_requests_lock:
        questionnaire_verifications[key].append(time.monotonic())


def clear_questionnaire_verification_failures(token):
    key = questionnaire_verification_key(token)
    with vision_requests_lock:
        questionnaire_verifications.pop(key, None)


def valid_questionnaire_answers(answers):
    if not isinstance(answers, dict) or len(answers) > 250:
        return False
    for key, value in answers.items():
        if len(str(key)) > 150:
            return False
        values = value if isinstance(value, list) else [value]
        if len(values) > 10 or any(not isinstance(item, str) or len(item) > 500 for item in values):
            return False
    return True


@app.route("/api/questionnaire/groups/<group_id>/status", methods=["GET"])
def questionnaire_group_status(group_id):
    if not check_auth():
        return json_response({"error": "Unauthorized"}, 401)
    db_error = ensure_schema()
    if db_error:
        return db_error
    with connect() as conn:
        group, patients = schedule_group_and_patients(conn, group_id)
        if not group:
            return json_response({"error": "Schedule group not found"}, 404)
        counts = conn.execute(
            "select status, count(*) as count from questionnaire_invitations where group_id = %s group by status",
            (group_id,),
        ).fetchall()
    summary = {"not_started": 0, "in_progress": 0, "submitted": 0}
    summary.update({row["status"]: row["count"] for row in counts})
    return json_response({"groupId": group_id, "total": len(patients), "counts": summary})


@app.route("/api/questionnaire/groups/<group_id>/packets.pdf", methods=["POST"])
def questionnaire_packets(group_id):
    if not check_auth():
        return json_response({"error": "Unauthorized"}, 401)
    db_error = ensure_schema()
    if db_error:
        return db_error
    base_url = request.host_url.rstrip("/")
    with connect() as conn:
        group, patients = schedule_group_and_patients(conn, group_id)
        if not group:
            return json_response({"error": "Schedule group not found"}, 404)
        if not patients:
            return json_response({"error": "No scheduled patients"}, 400)
        invitations = []
        for patient in patients:
            code = str(patient.get("受診者コード") or "")
            token = secrets.token_urlsafe(32)
            conn.execute(
                """
                insert into questionnaire_invitations
                  (token_hash, group_id, patient_code, status, answers, expires_at)
                values (%s, %s, %s, 'not_started', '{}'::jsonb, now() + interval '90 days')
                on conflict (group_id, patient_code) do update set
                  token_hash = excluded.token_hash,
                  expires_at = excluded.expires_at,
                  updated_at = now()
                """,
                (token_hash(token), group_id, code),
            )
            invitations.append((patient, f"{base_url}/questionnaire/{token}"))

    output = io.BytesIO()
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    pdf = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    for patient, url in invitations:
        pdf.setFont("HeiseiKakuGo-W5", 17)
        pdf.drawString(22 * mm, height - 28 * mm, "健康診断 問診入力のご案内")
        pdf.setFont("HeiseiKakuGo-W5", 10)
        pdf.drawString(22 * mm, height - 42 * mm, f"健診名: {group.get('name') or ''}")
        pdf.drawString(22 * mm, height - 49 * mm, f"受診予定日: {group.get('scheduledDate') or '未定'}")
        pdf.drawString(22 * mm, height - 56 * mm, f"受診者: {patient.get('氏名') or ''} 様")
        qr = qrcode.make(url)
        qr_buffer = io.BytesIO()
        qr.save(qr_buffer, format="PNG")
        qr_buffer.seek(0)
        from reportlab.lib.utils import ImageReader
        pdf.drawImage(ImageReader(qr_buffer), 58 * mm, height - 132 * mm, 74 * mm, 74 * mm, preserveAspectRatio=True)
        pdf.setFont("HeiseiKakuGo-W5", 11)
        pdf.drawCentredString(width / 2, height - 142 * mm, "QRコードをスマートフォンで読み取ってください。")
        pdf.setFont("HeiseiKakuGo-W5", 9)
        lines = [
            "本人確認では生年月日を数字で入力します（例: 1980年4月5日 → 19800405）。",
            "健診当日までに送信してください。途中で中断しても同じQRコードから再開できます。",
            "スマートフォンをお持ちでない場合は、健診会場のタブレットで回答できます。",
            "この用紙には個人専用URLが含まれます。第三者へ渡さないでください。",
        ]
        y = height - 160 * mm
        for line in lines:
            pdf.drawString(22 * mm, y, line)
            y -= 7 * mm
        pdf.showPage()
    pdf.save()
    output.seek(0)
    safe_name = re.sub(r"[^0-9A-Za-z_-]+", "_", str(group.get("name") or "questionnaire"))
    return send_file(output, as_attachment=True, download_name=f"問診案内_{safe_name}.pdf", mimetype="application/pdf")


@app.route("/api/public-questionnaire/<token>", methods=["GET", "POST"])
def public_questionnaire(token):
    db_error = ensure_schema()
    if db_error:
        return db_error
    payload = request.get_json(silent=True) if request.method == "POST" else None
    birth = (payload or {}).get("birth") if isinstance(payload, dict) else request.args.get("birth", "")
    with connect() as conn:
        row, group, patient = questionnaire_invitation(conn, token)
        if not row:
            return json_response({"error": "このURLは無効です。"}, 404)
        if request.method == "GET" and not birth:
            return json_response({"ok": True, "requiresVerification": True, "status": row["status"]})
        if questionnaire_verification_limited(token):
            return json_response({"error": "確認回数が上限に達しました。しばらく待ってからお試しください。"}, 429)
        if not questionnaire_verified(row, patient, birth):
            record_questionnaire_verification_failure(token)
            return json_response({"error": "生年月日が一致しません。入力内容をご確認ください。"}, 403)
        clear_questionnaire_verification_failures(token)
        if request.method == "GET":
            conn.execute("update questionnaire_invitations set verified_at = coalesce(verified_at, now()), updated_at = now() where token_hash = %s", (token_hash(token),))
            return json_response({
                "ok": True,
                "patient": {"code": patient.get("受診者コード"), "name": patient.get("氏名"), "kana": patient.get("カナ氏名"), "sex": patient.get("性別名称")},
                "group": {"name": group.get("name"), "scheduledDate": group.get("scheduledDate")},
                "answers": row["answers"] or {},
                "status": row["status"],
            })
        answers = payload.get("answers")
        action = payload.get("action")
        if not valid_questionnaire_answers(answers) or action not in {"save", "submit"}:
            return json_response({"error": "Invalid questionnaire payload"}, 400)
        if action == "submit" and (answers.get("問診_同意") != "同意する" or not str(answers.get("問診_署名") or "").strip()):
            return json_response({"error": "同意と署名を確認してください。"}, 400)
        status = "submitted" if action == "submit" else "in_progress"
        conn.execute(
            """
            update questionnaire_invitations set answers = %s, status = %s,
              first_saved_at = coalesce(first_saved_at, now()),
              submitted_at = case when %s = 'submitted' then now() else submitted_at end,
              updated_at = now() where token_hash = %s
            """,
            (Jsonb(answers), status, status, token_hash(token)),
        )
        questionnaire_id = f"{row['group_id']}::{row['patient_code']}::questionnaire"
        questionnaire_record = {
            "id": questionnaire_id,
            "entityType": "questionnaire_response",
            "scheduleGroupId": row["group_id"],
            "scheduleGroupName": group.get("name") or "",
            "patientCode": row["patient_code"],
            "patientKey": f"{row['group_id']}::{row['patient_code']}",
            "answers": answers,
            "status": status,
            "source": "public_questionnaire",
            "updatedAt": utc_now().isoformat(),
        }
        conn.execute(
            """
            insert into sync_records_v2 (id, entity_type, payload, updated_at)
            values (%s, 'questionnaire_response', %s, now())
            on conflict (entity_type, id) do update set payload = excluded.payload, updated_at = now()
            """,
            (questionnaire_id, Jsonb(questionnaire_record)),
        )
    return json_response({"ok": True, "status": status})


@app.route("/questionnaire/<token>")
def public_questionnaire_page(token):
    return send_from_directory(ROOT, "public-questionnaire.html")


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
    original_existing = dict(existing)
    merged = dict(existing)
    for key, value in incoming.items():
        old_value = merged.get(key)
        if isinstance(old_value, dict) and isinstance(value, dict):
            merged[key] = merge_payload(old_value, value)
        elif has_value(value) or not has_value(old_value):
            merged[key] = value
    if incoming.get("entityType") == "schedule_group":
        for field in ("customerName", "scheduledDate", "archivedAt"):
            if field in incoming:
                merged[field] = incoming[field]
    if incoming.get("entityType") == "exam_group_value":
        verification_fields = ("verificationStatus", "verificationUpdatedAt", "registeredAt", "confirmedAt")
        incoming_stamp = str(incoming.get("verificationUpdatedAt") or "")
        existing_stamp = str(original_existing.get("verificationUpdatedAt") or "")
        use_incoming = "verificationStatus" in incoming and (not existing_stamp or not incoming_stamp or incoming_stamp >= existing_stamp)
        source = incoming if use_incoming else original_existing
        for field in verification_fields:
            if field in source:
                merged[field] = source[field]
    return merged


@app.route("/healthz")
def healthz():
    return json_response({
        "ok": True,
        "databaseConfigured": bool(DATABASE_URL),
        "visionConfigured": bool(VISION_API_KEY),
        "syncSchema": 2,
    })


@app.route("/api/vision/measurement", methods=["POST"])
def recognize_measurement():
    if not VISION_API_KEY:
        return json_response({"error": "Cloud Vision is not configured"}, 503)
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    if vision_rate_limited(client_ip):
        return json_response({"error": "Too many OCR requests"}, 429)
    payload = request.get_json(silent=True)
    images = payload.get("images") if isinstance(payload, dict) else None
    if not isinstance(images, list) or not 1 <= len(images) <= VISION_MAX_IMAGES:
        return json_response({"error": "1 to 3 images are required"}, 400)
    for image in images:
        if not isinstance(image, str):
            return json_response({"error": "Invalid image"}, 400)
        try:
            decoded = base64.b64decode(image, validate=True)
        except (ValueError, TypeError):
            return json_response({"error": "Invalid base64 image"}, 400)
        if not decoded.startswith(b"\xff\xd8\xff") or len(decoded) > VISION_MAX_IMAGE_BYTES:
            return json_response({"error": "Only JPEG images up to 2 MB are accepted"}, 400)
    try:
        result = call_cloud_vision(images)
    except urllib.error.HTTPError as error:
        app.logger.warning("Cloud Vision returned HTTP %s", error.code)
        return json_response({"error": "Cloud Vision request failed"}, 502)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        app.logger.warning("Cloud Vision unavailable: %s", type(error).__name__)
        return json_response({"error": "Cloud Vision is unavailable"}, 502)

    candidates = []
    texts = []
    for response in result.get("responses", []):
        text = (response.get("fullTextAnnotation") or {}).get("text", "")
        if not text:
            annotations = response.get("textAnnotations") or []
            text = annotations[0].get("description", "") if annotations else ""
        texts.append(text[:500])
        measurement = parse_measurement_text(text)
        if measurement:
            candidates.append(measurement)
    if not candidates:
        return json_response({"ok": False, "recognized": False, "texts": texts})

    best = max(candidates, key=lambda item: sum(other == item for other in candidates))
    agreement = sum(item == best for item in candidates)
    labels = []
    for candidate in candidates:
        label = f'{candidate["height"]}cm / {candidate["weight"]}kg'
        if label not in labels:
            labels.append(label)
    return json_response({
        "ok": True,
        "recognized": True,
        "height": best["height"],
        "weight": best["weight"],
        "requiresReview": len(images) > 1 and agreement < 2,
        "agreement": agreement,
        "candidates": labels,
    })


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
